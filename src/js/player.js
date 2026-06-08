/**
 * smart-clip — 播放器与预览控件模块
 *
 * 封装 <video> / <img> 元素，对外暴露统一接口。
 * 外层不需要知道内部实现，以后换成 Canvas + WebGL 渲染也只需改此模块。
 *
 * 事件订阅：
 *   player:seek(time)        → 跳转到指定时间
 *   player:source(path,type) → 加载媒体源
 *
 * 事件发布：
 *   playback:changed(bool) → 播放状态变更
 *   player:duration(sec)   → 媒体时长就绪
 */

// ========================================
// 播放器
// ========================================
const Player = {
  video: document.getElementById('preview-player'),
  image: document.getElementById('preview-image'),
  placeholder: document.getElementById('preview-placeholder'),
  source: null,
  sourceType: null, // 'video' | 'image'

  _hideAll() {
    this.video.classList.remove('active');
    this.image.classList.remove('active');
  },

  _showVideo() {
    this._hideAll();
    this.video.classList.add('active');
    this.placeholder.style.display = 'none';
  },

  _showImage() {
    this._hideAll();
    this.image.classList.add('active');
    this.placeholder.style.display = 'none';
  },

  init() {
    this.video.addEventListener('timeupdate', () => {
      if (Timeline._playerLocked) return;
      Project.updateCurrentTime(this.video.currentTime);
    });

    this.video.addEventListener('play', () => {
      Project.isPlaying = true;
      EventBus.emit('playback:changed', true);
    });

    this.video.addEventListener('pause', () => {
      Project.isPlaying = false;
      EventBus.emit('playback:changed', false);
    });

    this.video.addEventListener('ended', () => {
      Project.isPlaying = false;
      this.video.currentTime = 0;
      EventBus.emit('playback:changed', false);
    });

    EventBus.on('player:seek', (time) => this.seek(time));
    EventBus.on('player:source', (filePath, type) => this.loadSource(filePath, type));
  },

  /**
   * 加载媒体源（自动检测视频/图片）
   * @param {string} filePath - 文件路径
   * @param {string} [type] - 强制类型 'video' | 'image'
   */
  loadSource(filePath, type) {
    this.source = filePath;
    const ext = (filePath || '').split('.').pop().toLowerCase();
    const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'];

    if (type === 'image' || imageExts.includes(ext)) {
      this.sourceType = 'image';
      this.image.src = window.isNW
        ? 'file:///' + filePath.replace(/\\/g, '/')
        : filePath;
      this._showImage();
      setStatus(`已加载图片: ${filePath.split(/[/\\]/).pop()}`);
    } else {
      this.sourceType = 'video';
      this.video.src = window.isNW
        ? 'file:///' + filePath.replace(/\\/g, '/')
        : filePath;
      this._showVideo();

      // 使用具名函数 + {once:true} 避免监听器累积
      const onMeta = () => {
        const dur = this.video.duration;
        EventBus.emit('player:duration', dur);
        setStatus(`已加载: ${filePath.split(/[/\\]/).pop()} (${dur.toFixed(1)}s)`);
      };
      this.video.addEventListener('loadedmetadata', onMeta, { once: true });
    }
  },

  play() { if (this.sourceType === 'video') this.video.play().catch(() => {}); },
  pause() { if (this.sourceType === 'video') this.video.pause(); },
  toggle() {
    if (this.sourceType === 'video') {
      this.video.paused ? this.play() : this.pause();
    }
  },

  /**
   * 跳转到指定时间
   * @param {number} time - 秒数
   */
  seek(time) {
    if (this.sourceType === 'video') {
      this.video.currentTime = Math.max(0, Math.min(time, this.video.duration || 0));
    }
  }
};

// ========================================
// 预览控件
// ========================================
const PreviewControls = {
  btnPlay: document.getElementById('btn-play'),
  ctrlCurrent: document.getElementById('ctrl-current-time'),
  ctrlTotal: document.getElementById('ctrl-total-time'),
  progressBar: document.getElementById('ctrl-progress-bar'),
  progressFill: document.getElementById('ctrl-progress-fill'),
  progressThumb: document.getElementById('ctrl-progress-thumb'),
  btnFit: document.getElementById('btn-fit-mode'),
  controls: document.getElementById('player-controls'),
  isDraggingProgress: false,
  fitMode: 'contain',

  init() {
    const video = Player.video;

    // 播放/暂停按钮
    this.btnPlay.addEventListener('click', () => Player.toggle());
    EventBus.on('playback:changed', (playing) => {
      this.btnPlay.textContent = playing ? '⏸' : '▶';
      if (playing) {
        this.controls.classList.add('visible');
      }
    });

    // 视频加载完成时显示总时长
    video.addEventListener('loadedmetadata', () => {
      this.ctrlTotal.textContent = formatTime(video.duration);
    });
    EventBus.on('player:duration', (dur) => {
      this.ctrlTotal.textContent = formatTime(dur);
    });

    // 时间更新 → 进度条 + 时间显示
    video.addEventListener('timeupdate', () => {
      if (!this.isDraggingProgress) {
        this._updateProgress(video.currentTime, video.duration);
      }
      this.ctrlCurrent.textContent = formatTime(video.currentTime);
    });

    // 进度条点击/拖拽
    this.progressBar.addEventListener('mousedown', (e) => {
      this.isDraggingProgress = true;
      this._seekFromEvent(e);
      document.addEventListener('mousemove', this._onProgressDrag);
      document.addEventListener('mouseup', this._onProgressUp);
    });

    // 画面尺寸切换
    this.btnFit.addEventListener('click', () => {
      this.fitMode = this.fitMode === 'contain' ? 'cover' : 'contain';
      video.style.objectFit = this.fitMode;
      this.btnFit.textContent = this.fitMode === 'contain' ? '🔲' : '⬛';
      this.btnFit.title = this.fitMode === 'contain' ? '适应画面' : '填充画面';
    });
  },

  _updateProgress(current, duration) {
    if (!duration) return;
    const pct = (current / duration) * 100;
    this.progressFill.style.width = pct + '%';
    this.progressThumb.style.left = pct + '%';
  },

  _seekFromEvent(e) {
    const rect = this.progressBar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const time = pct * (Player.video.duration || 0);
    Player.seek(time);
    this._updateProgress(time, Player.video.duration);
    this.ctrlCurrent.textContent = formatTime(time);
  },

  _onProgressDrag: (e) => {
    PreviewControls._seekFromEvent(e);
  },

  _onProgressUp: () => {
    PreviewControls.isDraggingProgress = false;
    document.removeEventListener('mousemove', PreviewControls._onProgressDrag);
    document.removeEventListener('mouseup', PreviewControls._onProgressUp);
  }
};
