/**
 * smart-clip 核心应用逻辑
 *
 * 关键架构概念：
 * ————
 * 1. NW.js 允许页面直接 require Node.js 模块，无需 preload/IPC
 * 2. 应用采用 "发布-订阅" 模式：事件中心协调各模块
 * 3. 时间轴使用独立的数据模型，与播放器通过事件通信
 */

// NW.js 环境下可直接使用 Node.js API
let fs, path, childProcess;
if (window.isNW) {
  fs = require('fs');
  path = require('path');
  childProcess = require('child_process');
}

// ========================================
// 一、事件中心（发布-订阅模式）
// 关键点：解耦模块间的通信
// ————
// Player 更新时间 → emit('timeupdate', time)
// Timeline 监听 → on('timeupdate', fn)
// ========================================
const EventBus = {
  _events: {},
  on(event, fn) {
    (this._events[event] ||= []).push(fn);
  },
  off(event, fn) {
    const list = this._events[event];
    if (list) this._events[event] = list.filter(f => f !== fn);
  },
  emit(event, ...args) {
    (this._events[event] || []).forEach(fn => fn(...args));
  }
};

// ========================================
// 二、项目数据模型
// 关键点：单一数据源 —— 所有状态集中在这里
// ————
// 这是软件构建中最重要的概念之一：
// UI 只负责渲染，数据只在一处修改，避免状态不一致
// ========================================
const Project = {
  name: '未命名项目',
  fps: 30,
  media: [],        // 导入的素材 [{id, name, path, type, duration, width, height}]
  tracks: [         // 时间轴轨道
    { id: 'video1', type: 'video', name: '视频轨', clips: [] },
    { id: 'audio1', type: 'audio', name: '音频轨', clips: [] }
  ],
  currentTime: 0,
  isPlaying: false,

  addMedia(mediaItem) {
    const item = {
      id: 'media_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      ...mediaItem
    };
    this.media.push(item);
    EventBus.emit('media:changed', this.media);
    return item;  // 返回创建的素材对象，方便后续操作
  },

  addClipToTrack(trackId, clipData) {
    const track = this.tracks.find(t => t.id === trackId);
    if (!track) return;
    UndoManager.saveState();  // FIX #13
    const clip = {
      id: 'clip_' + Date.now(),
      mediaId: clipData.mediaId,
      name: clipData.name,
      path: clipData.path,
      startTime: clipData.startTime || 0,   // 在时间轴上的起始位置(秒)
      duration: clipData.duration || 5,
      trimStart: 0,                          // 裁剪起点
      trimEnd: clipData.duration || 5        // 裁剪终点
    };
    track.clips.push(clip);
    EventBus.emit('timeline:changed', this.tracks);
  },

  removeClip(trackId, clipId) {
    const track = this.tracks.find(t => t.id === trackId);
    if (!track) return;
    UndoManager.saveState();  // FIX #13
    track.clips = track.clips.filter(c => c.id !== clipId);
    EventBus.emit('timeline:changed', this.tracks);
  },

  updateCurrentTime(time) {
    this.currentTime = time;
    EventBus.emit('time:changed', time);
  }
};

// ========================================
// 三、播放器模块
// 关键点：封装 <video> 元素，对外暴露统一接口
// ————
// 外层不需要知道内部是 HTMLVideoElement，
// 以后换成 Canvas + WebGL 渲染也只需改这个模块
// ========================================
const Player = {
  video: document.getElementById('preview-player'),
  image: document.getElementById('preview-image'),
  placeholder: document.getElementById('preview-placeholder'),
  source: null,
  sourceType: null, // 'video' | 'image'

  _hideAll() {
    this.video.classList.remove('active');
    this.video.style.display = 'none';
    this.image.classList.remove('active');
    this.image.style.display = 'none';
  },

  _showVideo() {
    this._hideAll();
    this.video.style.display = 'block';
    this.video.classList.add('active');
    this.placeholder.style.display = 'none';
  },

  _showImage() {
    this._hideAll();
    this.image.style.display = 'block';
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
    EventBus.on('player:source', (filePath) => this.loadSource(filePath));
  },

  loadSource(filePath, type) {
    this.source = filePath;
    const ext = (filePath || '').split('.').pop().toLowerCase();
    const imageExts = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'svg'];

    if (type === 'image' || imageExts.includes(ext)) {
      // 图片预览
      this.sourceType = 'image';
      this.image.src = window.isNW
        ? 'file:///' + filePath.replace(/\\/g, '/')
        : filePath;
      this._showImage();
      setStatus(`已加载图片: ${filePath.split(/[/\\]/).pop()}`);
    } else {
      // 视频/音频预览
      this.sourceType = 'video';
      this.video.src = window.isNW
        ? 'file:///' + filePath.replace(/\\/g, '/')
        : filePath;
      this._showVideo();

      this.video.addEventListener('loadedmetadata', () => {
        const dur = this.video.duration;
        EventBus.emit('player:duration', dur);
        setStatus(`已加载: ${filePath.split(/[/\\]/).pop()} (${dur.toFixed(1)}s)`);
      }, { once: true });
    }
  },

  play() { if (this.sourceType === 'video') this.video.play().catch(() => {}); },
  pause() { if (this.sourceType === 'video') this.video.pause(); },
  toggle() {
    if (this.sourceType === 'video') {
      this.video.paused ? this.play() : this.pause();
    }
  },

  seek(time) {
    if (this.sourceType === 'video') {
      this.video.currentTime = Math.max(0, Math.min(time, this.video.duration || 0));
    }
  }
};

// ========================================
// 三-B、预览控件模块 FIX #6 #7
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
  fitMode: 'contain', // 'contain' | 'cover'  FIX #7

  init() {
    const video = Player.video;

    // FIX #6: 播放/暂停按钮
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

    // FIX #6: 进度条点击/拖拽
    this.progressBar.addEventListener('mousedown', (e) => {
      this.isDraggingProgress = true;
      this._seekFromEvent(e);
      document.addEventListener('mousemove', this._onProgressDrag);
      document.addEventListener('mouseup', this._onProgressUp);
    });

    // FIX #7: 画面尺寸切换
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

// ========================================
// 四、时间轴渲染模块
// 关键点：数据驱动渲染 —— 每次数据变就清空重绘
// ————
// 这是"声明式 UI"的朴素实现：
// state → render(state) → 用户看到的结果
// ========================================
// 时间格式化辅助函数 FIX #1
function formatTime(seconds) {
  const s = seconds || 0;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return String(m).padStart(2, '0') + ':' + sec.toFixed(2).padStart(5, '0');
}

const Timeline = {
  container: document.getElementById('timeline-tracks'),
  ruler: document.getElementById('time-ruler'),
  timeLabel: document.querySelector('.time-label'),
  pixelsPerSecond: 50,     // 缩放比例 FIX #3#4
  totalDuration: 60,       // 时间轴总时长(秒)
  selectedClipId: null,    // 当前选中的片段ID FIX #5
  dragState: null,         // 拖拽状态 { clip, trackId, startX, origLeft }
  _scrubbing: false,       // 播放头擦洗中
  _playerLocked: false,    // 播放器锁定（擦洗时忽略 timeupdate）

  init() {
    EventBus.on('timeline:changed', () => this.render());
    EventBus.on('time:changed', (time) => {
      this.updatePlayhead(time);
      this.updateTimeLabel(time);  // FIX #2
    });

    // 时间轴点击：跳转播放位置
    this.container.addEventListener('click', (e) => {
      if (this.dragState) return; // 拖拽中不处理点击
      const rect = this.container.getBoundingClientRect();
      const x = e.clientX - rect.left; // 标签已移至外部 div，无需偏移
      if (x < 0) return;
      const time = x / this.pixelsPerSecond;
      EventBus.emit('player:seek', time);
    });

    // FIX #4: 缩放按钮
    document.getElementById('btn-zoom-in').addEventListener('click', () => this.zoom(1.3));
    document.getElementById('btn-zoom-out').addEventListener('click', () => this.zoom(0.77));

    // 缩放滑块
    const zoomSlider = document.getElementById('zoom-slider');
    if (zoomSlider) {
      zoomSlider.addEventListener('input', () => {
        this.pixelsPerSecond = parseInt(zoomSlider.value);
        this.render();
        this._updateZoomLabel();
      });
    }

    // 时间轴工具栏 — 分割工具按钮
    const btnSplit = document.getElementById('btn-split-tool');
    if (btnSplit) {
      btnSplit.addEventListener('click', () => this.splitClipAtPlayhead());
    }

    // 时间轴工具栏 — 吸附切换
    this._snapEnabled = true;
    const btnSnap = document.querySelector('.timeline-toolbar .btn-tt[title="吸附"]');
    if (btnSnap) {
      btnSnap.addEventListener('click', () => {
        this._snapEnabled = !this._snapEnabled;
        btnSnap.classList.toggle('active', this._snapEnabled);
        setStatus(this._snapEnabled ? '吸附: 开' : '吸附: 关');
      });
    }

    // 时间轴工具栏 — 撤销/重做
    const ttUndoBtn = document.querySelector('.timeline-toolbar .btn-tt[title="撤销"]');
    const ttRedoBtn = document.querySelector('.timeline-toolbar .btn-tt[title="重做"]');
    if (ttUndoBtn) ttUndoBtn.addEventListener('click', () => UndoManager.undo());
    if (ttRedoBtn) ttRedoBtn.addEventListener('click', () => UndoManager.redo());

    // 更新时间轴时间显示
    EventBus.on('time:changed', (time) => {
      const disp = document.getElementById('timeline-time-display');
      if (disp) disp.textContent = formatTime(time);
    });

    // 轨道滚动时同步标尺
    this.container.addEventListener('scroll', () => {
      this.ruler.scrollLeft = this.container.scrollLeft;
    });
    // 标尺滚动时同步轨道
    this.ruler.addEventListener('scroll', () => {
      this.container.scrollLeft = this.ruler.scrollLeft;
    });

    // 标尺交互（点击/拖拽擦洗）
    this._initRulerInteraction();

    // FIX #5: 拖拽结束/取消时确保清理
    document.addEventListener('mouseup', () => {
      if (this.dragState) this._endDrag();
    });

    this.render();
  },

  // 缩放标签更新
  _updateZoomLabel() {
    const label = document.getElementById('zoom-label');
    if (label) label.textContent = Math.round(this.pixelsPerSecond / 50 * 100) + '%';
    const slider = document.getElementById('zoom-slider');
    if (slider) slider.value = this.pixelsPerSecond;
  },

  // FIX #4: 缩放
  zoom(factor) {
    this.pixelsPerSecond = Math.max(20, Math.min(200, Math.round(this.pixelsPerSecond * factor)));
    this._updateZoomLabel();
    this.render();
    setStatus(`缩放: ${Math.round(this.pixelsPerSecond / 50 * 100)}%`);
  },

  // FIX #3: 动态计算时间轴总时长
  _calcTotalDuration() {
    let maxEnd = 30;
    Project.tracks.forEach(track => {
      track.clips.forEach(clip => {
        const end = clip.startTime + clip.duration;
        if (end > maxEnd) maxEnd = end;
      });
    });
    return Math.max(30, Math.ceil(maxEnd * 1.3 / 5) * 5);
  },

  // FIX #1: 渲染时间标尺刻度
  renderRuler() {
    this.ruler.innerHTML = '';

    // 内部撑宽容器（使 ruler 可水平滚动）
    const rulerInner = document.createElement('div');
    rulerInner.className = 'ruler-inner';
    const width = this.totalDuration * this.pixelsPerSecond;
    rulerInner.style.cssText = `position:relative;width:${width}px;min-width:${width}px;height:100%;`;

    // 根据缩放级别调整刻度间隔
    let minorInterval = 0.5;
    let majorInterval = 2;
    if (this.pixelsPerSecond >= 100) { minorInterval = 0.25; majorInterval = 1; }
    else if (this.pixelsPerSecond >= 60) { minorInterval = 0.5; majorInterval = 2; }
    else { minorInterval = 1; majorInterval = 5; }

    for (let t = 0; t <= this.totalDuration; t += minorInterval) {
      const tick = document.createElement('div');
      tick.className = 'ruler-tick';
      tick.style.left = (t * this.pixelsPerSecond) + 'px';

      const isMajor = Math.abs(t % majorInterval) < 0.001 || t === 0;
      if (isMajor) {
        tick.classList.add('major');
        tick.textContent = formatTime(t);
      }
      rulerInner.appendChild(tick);
    }
    this.ruler.appendChild(rulerInner);

    // 重建播放头组件（被 innerHTML 清掉了）
    this._playheadCreated = false;
    this._createPlayhead();
    // 恢复播放头位置
    this.updatePlayhead(Project.currentTime);
  },

  // FIX #2: 更新时间标签
  updateTimeLabel(time) {
    if (this.timeLabel) {
      this.timeLabel.textContent = formatTime(time);
    }
  },

  render() {
    // FIX #3: 动态计算总时长
    this.totalDuration = this._calcTotalDuration();

    // 先清空轨道区（在 renderRuler 创建播放头之前，否则会被清掉）
    this.container.innerHTML = '';
    this.renderRuler();  // FIX #1

    Project.tracks.forEach(track => {
      const trackEl = document.createElement('div');
      trackEl.className = 'track';
      trackEl.dataset.trackId = track.id;

      // 轨道标签已移至外部 #track-labels，此处仅渲染内容区
      const content = document.createElement('div');
      content.className = 'track-content';
      content.style.width = (this.totalDuration * this.pixelsPerSecond) + 'px';

      // 渲染片段 FIX #16 #18
      track.clips.forEach(clip => {
        const clipEl = document.createElement('div');
        clipEl.className = 'track-clip' + (track.type === 'audio' ? ' audio' : '');
        if (clip.id === this.selectedClipId) clipEl.classList.add('selected');

        // 有效片段范围
        const effectiveStart = clip.trimStart || 0;
        const effectiveEnd = clip.trimEnd || clip.duration;
        const effectiveDuration = effectiveEnd - effectiveStart;

        clipEl.style.left = ((clip.startTime) * this.pixelsPerSecond) + 'px';
        clipEl.style.width = (effectiveDuration * this.pixelsPerSecond) + 'px';
        clipEl.textContent = clip.name;
        clipEl.title = `${clip.name}\n起始: ${clip.startTime.toFixed(1)}s\n时长: ${clip.duration.toFixed(1)}s\n裁剪: ${effectiveStart.toFixed(1)}s ~ ${effectiveEnd.toFixed(1)}s`;
        clipEl.dataset.clipId = clip.id;
        clipEl.dataset.trackId = track.id;

        // FIX #16: 裁剪手柄 — 左侧
        const trimLeft = document.createElement('div');
        trimLeft.className = 'trim-handle trim-handle-left';
        trimLeft.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this._onTrimStart(e, clip, clipEl, 'left');
        });

        // FIX #16: 裁剪手柄 — 右侧
        const trimRight = document.createElement('div');
        trimRight.className = 'trim-handle trim-handle-right';
        trimRight.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this._onTrimStart(e, clip, clipEl, 'right');
        });

        clipEl.appendChild(trimLeft);
        clipEl.appendChild(trimRight);

        // FIX #5: 自定义拖拽（替代 HTML5 drag，支持吸附）
        clipEl.addEventListener('mousedown', (e) => this._onClipMouseDown(e, clip, track.id));
        clipEl.addEventListener('click', (e) => {
          e.stopPropagation();
          this.selectClip(clip, track.id);
        });

        // FIX #18: 片段右键菜单
        clipEl.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this._showClipContextMenu(e, clip, track.id, clipEl);
        });

        content.appendChild(clipEl);
      });

      // FIX #5: 全局 mousemove 处理拖拽（在 document 上，确保鼠标离开轨道区域仍能跟踪）
      if (!this._dragMoveBound) {
        this._dragMoveBound = (e) => this._onDragMove(e);
        document.addEventListener('mousemove', this._dragMoveBound);
      }

      // 放置区：接收从素材库拖入的素材（仅匹配轨道类型）
      content.addEventListener('dragover', (e) => {
        e.preventDefault();
        const mediaData = e.dataTransfer.getData('application/json');
        if (!mediaData) return;
        try {
          const media = JSON.parse(mediaData);
          if (media.clipId) return;
          // 检查类型匹配
          if (track.type === 'video' && (media.type === 'video' || media.type === 'image')) {
            e.dataTransfer.dropEffect = 'move';
          } else if (track.type === 'audio' && media.type === 'audio') {
            e.dataTransfer.dropEffect = 'move';
          } else {
            e.dataTransfer.dropEffect = 'none';
          }
        } catch (err) { e.dataTransfer.dropEffect = 'none'; }
      });

      content.addEventListener('drop', (e) => {
        e.preventDefault();
        const rect = content.getBoundingClientRect();
        const dropTime = (e.clientX - rect.left) / this.pixelsPerSecond;
        const mediaData = e.dataTransfer.getData('application/json');
        if (mediaData) {
          try {
            const media = JSON.parse(mediaData);
            if (media.clipId) return; // 移动已有片段走自定义拖拽

            // 类型检查：视频/图片 → 视频轨，音频 → 音频轨
            if (track.type === 'video' && media.type === 'audio') {
              setStatus('音频文件不能放入视频轨');
              return;
            }
            if (track.type === 'audio' && (media.type === 'video' || media.type === 'image')) {
              setStatus('视频/图片文件不能放入音频轨');
              return;
            }

            const snapTime = this._snapTime(dropTime, track.id, null);
            Project.addClipToTrack(track.id, {
              mediaId: media.id,
              name: media.name,
              path: media.path,
              startTime: Math.max(0, snapTime),
              duration: media.duration || 5
            });
          } catch (err) { /* ignore parse errors */ }
        }
      });

      trackEl.appendChild(content);
      this.container.appendChild(trackEl);
    });
  },

  // FIX #5: 选中片段
  selectClip(clip, trackId) {
    this.selectedClipId = clip.id;
    EventBus.emit('clip:selected', clip, trackId);
    // 刷新高亮
    this.container.querySelectorAll('.track-clip').forEach(el => {
      el.classList.toggle('selected', el.dataset.clipId === clip.id);
    });
    // 选中片段时自动预览对应素材（图片/视频）
    const media = Project.media.find(m => m.id === clip.mediaId);
    if (media) {
      EventBus.emit('player:source', media.path, media.type);
    }
  },

  // FIX #5: 自定义拖拽 — mousedown
  _onClipMouseDown(e, clip, trackId) {
    if (e.button !== 0) return; // 只响应左键
    e.preventDefault();
    e.stopPropagation();

    this.selectClip(clip, trackId);
    UndoManager.saveState();  // FIX #13: 拖拽前保存状态，使移动可撤销

    const clipEl = e.currentTarget;
    this.dragState = {
      clip: clip,
      trackId: trackId,
      clipEl: clipEl,
      startMouseX: e.clientX,
      origStartTime: clip.startTime,
      moved: false
    };
    clipEl.style.cursor = 'grabbing';
    clipEl.style.zIndex = '20';
  },

  // FIX #5: 自定义拖拽 — mousemove
  _onDragMove(e) {
    if (!this.dragState) return;
    const ds = this.dragState;
    const dx = e.clientX - ds.startMouseX;
    const dt = dx / this.pixelsPerSecond;

    // 移动超过 2px 才算拖拽
    if (Math.abs(dx) < 2) return;
    ds.moved = true;

    let newStart = ds.origStartTime + dt;
    newStart = Math.max(0, newStart); // 不超出左侧边界

    // FIX #5: 吸附
    newStart = this._snapTime(newStart, ds.trackId, ds.clip.id);

    ds.clip.startTime = newStart;
    ds.clipEl.style.left = (newStart * this.pixelsPerSecond) + 'px';
    ds.clipEl.title = `${ds.clip.name}\n起始: ${newStart.toFixed(1)}s\n时长: ${ds.clip.duration.toFixed(1)}s`;
  },

  // FIX #5: 自定义拖拽 — 结束
  _endDrag() {
    if (!this.dragState) return;
    const ds = this.dragState;
    ds.clipEl.style.cursor = 'grab';
    ds.clipEl.style.zIndex = '5';

    if (ds.moved) {
      EventBus.emit('timeline:changed', Project.tracks);
    }
    this.dragState = null;
  },

  // FIX #5: 吸附计算 — 吸附到邻近片段边缘或播放头
  _snapTime(time, trackId, excludeClipId) {
    if (!this._snapEnabled) return time; // 吸附关闭时直接返回原值
    const threshold = 0.3; // 吸附阈值 0.3 秒
    let bestSnap = time;
    let bestDist = threshold;

    // 吸附到其他片段的边缘
    Project.tracks.forEach(track => {
      track.clips.forEach(clip => {
        if (clip.id === excludeClipId) return;
        // 吸附到片段左边缘
        const d1 = Math.abs(time - clip.startTime);
        if (d1 < bestDist) { bestDist = d1; bestSnap = clip.startTime; }
        // 吸附到片段右边缘
        const rightEdge = clip.startTime + clip.duration;
        const d2 = Math.abs(time - rightEdge);
        if (d2 < bestDist) { bestDist = d2; bestSnap = rightEdge; }
      });
    });

    // 吸附到播放头
    const d3 = Math.abs(time - Project.currentTime);
    if (d3 < bestDist) { bestDist = d3; bestSnap = Project.currentTime; }

    // 吸附到 0
    if (Math.abs(time) < bestDist) bestSnap = 0;

    return bestSnap;
  },

  // 播放头（红色竖线 + 顶部菱形指示器 + 标尺拖拽）
  _createPlayhead() {
    // 红线主体（GPU 加速：用 transform 定位，will-change 预提升）
    if (!this.container.querySelector('.playhead-line')) {
      const line = document.createElement('div');
      line.className = 'playhead-line';
      line.style.cssText = `
        position: absolute; top: 0; left: 0; width: 2px; height: 100%;
        background: var(--danger); z-index: 15; pointer-events: none;
        will-change: transform; transform: translateX(0px);
      `;
      this.container.style.position = 'relative';
      this.container.appendChild(line);
    }
    // 菱形指示器（GPU 加速，初始 transform 即包含 translateX + rotate）
    if (!this.ruler.querySelector('.playhead-diamond')) {
      const diamond = document.createElement('div');
      diamond.className = 'playhead-diamond';
      diamond.style.cssText = `
        position: absolute; top: -6px; left: 0; width: 14px; height: 14px;
        background: var(--danger); z-index: 16;
        border-radius: 2px;
        pointer-events: auto; cursor: col-resize;
        box-shadow: 0 0 4px rgba(255,77,79,0.6);
        will-change: transform; transform: translateX(0px) rotate(45deg);
      `;
      diamond.title = '拖动以预览';
      this.ruler.style.position = 'relative';
      this.ruler.appendChild(diamond);

      // 菱形点击 → 立即跳转（不拖拽时）
      diamond.addEventListener('click', (e) => {
        // click 在 mouseup 之后，此时 _scrubbing 已清
        // 不需要额外处理，mouseup 时已经 seek 过
      });
    }
    // 时间气泡（用 left 定位 + translateX(-50%) 居中，不被 updatePlayhead 覆写）
    if (!this.ruler.querySelector('.playhead-tooltip')) {
      const tooltip = document.createElement('div');
      tooltip.className = 'playhead-tooltip';
      tooltip.style.cssText = `
        position: absolute; top: -28px; left: 0;
        transform: translateX(-50%);
        background: var(--bg-elevated); color: #fff; font-size: 10px;
        font-family: "SF Mono","Consolas","Courier New",monospace;
        padding: 2px 6px; border-radius: 3px; z-index: 17;
        pointer-events: none; white-space: nowrap;
        border: 1px solid var(--border); opacity: 0; transition: opacity 0.15s;
      `;
      this.ruler.appendChild(tooltip);
    }
    this._playheadCreated = true;
  },

  // ========== 播放头（剪映风格——丝滑擦洗） ==========

  // 计算鼠标对应的播放时间
  _clientXToTime(e) {
    const rect = this.ruler.getBoundingClientRect();
    const scrollLeft = this.ruler.scrollLeft || 0;
    return Math.max(0, (e.clientX - rect.left + scrollLeft) / this.pixelsPerSecond);
  },

  // GPU 加速移动播放头（用 transform 不用 left）
  updatePlayhead(time) {
    this._createPlayhead();
    const px = time * this.pixelsPerSecond;
    const tx = `translateX(${px}px)`;

    const line = this.container.querySelector('.playhead-line');
    const diamond = this.ruler.querySelector('.playhead-diamond');
    const tooltip = this.ruler.querySelector('.playhead-tooltip');

    // line/diamond 用 transform(GPU)，tooltip 用 left(保留 translateX(-50%) 居中)
    if (line) line.style.transform = tx;
    if (diamond) diamond.style.transform = `translateX(${px}px) rotate(45deg)`;
    if (tooltip) {
      tooltip.style.left = px + 'px';
      tooltip.textContent = formatTime(time);
    }

    // 自动滚动
    const rulerScroll = this.ruler.scrollLeft || 0;
    const rulerWidth = this.ruler.clientWidth;
    if (rulerWidth && (px > rulerScroll + rulerWidth - 40 || px < rulerScroll + 10)) {
      this.ruler.scrollLeft = px - rulerWidth / 2;
    }
  },

  // 统一的标尺交互（rAF 批量更新 + 拖拽不吸附 + 松手才同步视频）
  _initRulerInteraction() {
    const ruler = this.ruler;
    this._scrubbing = false;
    this._pendingTime = null;  // rAF 缓存的时间

    // rAF 循环 —— 所有 mousemove 共用一个 rAF，只更新一次/帧
    const rafLoop = () => {
      if (this._pendingTime !== null) {
        this.updatePlayhead(this._pendingTime);
        this._pendingTime = null;
      }
      if (this._scrubbing || this._pendingTime !== null) {
        requestAnimationFrame(rafLoop);
      }
    };

    const startScrub = (e) => {
      if (e.button !== 0) return;
      if (e.target.closest && e.target.closest('.track-clip')) return;
      e.preventDefault();
      this._scrubbing = true;
      document.body.style.cursor = 'col-resize';

      // 锁定播放器 —— 拖拽期间不让 timeupdate 干扰 playhead
      this._playerLocked = true;

      const diamond = ruler.querySelector('.playhead-diamond');
      if (diamond) diamond.style.boxShadow = '0 0 10px rgba(255,77,79,1)';

      // 拖拽时不吸附（吸附导致跳帧感）
      const time = this._clientXToTime(e);
      this._pendingTime = time;
      requestAnimationFrame(rafLoop);
    };

    const moveScrub = (e) => {
      if (!this._scrubbing) return;
      // 只存时间，不立即写 DOM（rAF 批量处理）
      this._pendingTime = this._clientXToTime(e);
    };

    const endScrub = (e) => {
      if (!this._scrubbing) return;
      this._scrubbing = false;
      this._playerLocked = false;
      document.body.style.cursor = '';

      const diamond = ruler.querySelector('.playhead-diamond');
      if (diamond) diamond.style.boxShadow = '0 0 4px rgba(255,77,79,0.6)';

      // 松手时吸附并同步视频
      let time = this._clientXToTime(e);
      time = this._snapTime(time, null, null);
      Player.seek(time);
      Project.updateCurrentTime(time);
      this.updatePlayhead(time);
      this._pendingTime = null;
    };

    // 标尺上任何位置按下都触发
    ruler.addEventListener('mousedown', startScrub);
    document.addEventListener('mousemove', moveScrub);
    document.addEventListener('mouseup', endScrub);

    // 标尺悬停气泡
    ruler.addEventListener('mousemove', (e) => {
      if (this._scrubbing) return;
      const rect = ruler.getBoundingClientRect();
      const x = e.clientX - rect.left + (ruler.scrollLeft || 0);
      const tooltip = ruler.querySelector('.playhead-tooltip');
      if (tooltip) {
        tooltip.style.left = x + 'px';
        tooltip.textContent = formatTime(Math.max(0, x / this.pixelsPerSecond));
        tooltip.style.opacity = '1';
      }
    });
    ruler.addEventListener('mouseleave', () => {
      const tooltip = ruler.querySelector('.playhead-tooltip');
      if (tooltip) tooltip.style.opacity = '0';
    });
  },

  // FIX #16: 裁剪拖拽 — mousedown
  _onTrimStart(e, clip, clipEl, side) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    this._trimState = {
      clip: clip,
      clipEl: clipEl,
      side: side,
      startMouseX: e.clientX,
      origTrimStart: clip.trimStart || 0,
      origTrimEnd: clip.trimEnd || clip.duration,
      origStartTime: clip.startTime
    };

    const onMove = (ev) => {
      if (!this._trimState) return;
      const dx = ev.clientX - this._trimState.startMouseX;
      const dt = dx / this.pixelsPerSecond;

      if (Math.abs(dx) < 2) return;

      const ts = this._trimState;
      if (ts.side === 'left') {
        let newTrim = ts.origTrimStart + dt;
        newTrim = Math.max(0, Math.min(newTrim, ts.origTrimEnd - 0.1));
        ts.clip.trimStart = newTrim;
        ts.clip.startTime = ts.origStartTime + (newTrim - ts.origTrimStart);
        ts.clipEl.style.left = (ts.clip.startTime * this.pixelsPerSecond) + 'px';
      } else {
        let newTrim = ts.origTrimEnd + dt;
        newTrim = Math.min(ts.clip.duration, Math.max(newTrim, (ts.clip.trimStart || 0) + 0.1));
        ts.clip.trimEnd = newTrim;
      }
      const effDur = (ts.clip.trimEnd || ts.clip.duration) - (ts.clip.trimStart || 0);
      ts.clipEl.style.width = (effDur * this.pixelsPerSecond) + 'px';
    };

    const onUp = () => {
      if (this._trimState) {
        const ts = this._trimState;
        if (Math.abs(ts.clip.trimStart - ts.origTrimStart) > 0.001 || Math.abs(ts.clip.trimEnd - ts.origTrimEnd) > 0.001) {
          UndoManager.saveState();
          EventBus.emit('timeline:changed', Project.tracks);
          EventBus.emit('clip:selected', ts.clip, ts.clip.trackId); // 刷新属性面板
        }
        this._trimState = null;
      }
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  },

  // FIX #17: 在播放头位置分割片段
  splitClipAtPlayhead() {
    const time = Project.currentTime;
    for (const track of Project.tracks) {
      for (let i = track.clips.length - 1; i >= 0; i--) {
        const clip = track.clips[i];
        const clipStart = clip.startTime;
        const clipEnd = clip.startTime + clip.duration;

        // 播放头在该片段范围内
        if (time > clipStart + 0.05 && time < clipEnd - 0.05) {
          UndoManager.saveState();
          const splitPoint = time - clipStart;
          const rightClip = {
            id: 'clip_' + Date.now(),
            mediaId: clip.mediaId,
            name: clip.name + ' (分割)',
            path: clip.path,
            startTime: time,
            duration: clip.duration - splitPoint,
            trimStart: (clip.trimStart || 0) > splitPoint ? (clip.trimStart || 0) - splitPoint : 0,
            trimEnd: (clip.trimEnd || clip.duration) - splitPoint
          };
          // 左半段
          clip.duration = splitPoint;
          clip.trimEnd = Math.min(clip.trimEnd || clip.duration, splitPoint);

          // 插入右半段
          track.clips.splice(i + 1, 0, rightClip);
          EventBus.emit('timeline:changed', Project.tracks);
          setStatus(`已在 ${formatTime(time)} 处分割片段`);
          return;
        }
      }
    }
    setStatus('播放头不在任何片段范围内，无法分割');
  },

  // FIX #18: 片段右键菜单
  _showClipContextMenu(e, clip, trackId, clipEl) {
    hideContextMenu();

    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.left = e.clientX + 'px';
    menu.style.top = e.clientY + 'px';

    const items = [
      { label: '✂ 在此分割', action: () => {
        Player.seek(clip.startTime + clip.duration / 2);
        this.splitClipAtPlayhead();
      }},
      { label: '🗑 删除片段', action: () => {
        Project.removeClip(trackId, clip.id);
        this.selectedClipId = null;
        renderProjectInfo();
      }},
      { type: 'divider' },
      { label: '📋 复制', action: () => {
        // 简单复制：在后面追加
        UndoManager.saveState();
        Project.addClipToTrack(trackId, {
          mediaId: clip.mediaId,
          name: clip.name + ' (复制)',
          path: clip.path,
          startTime: clip.startTime + clip.duration + 0.5,
          duration: clip.duration,
          trimStart: clip.trimStart || 0,
          trimEnd: clip.trimEnd || clip.duration
        });
        setStatus('片段已复制');
      }},
      { label: 'ℹ 属性', action: () => {
        this.selectClip(clip, trackId);
      }}
    ];

    items.forEach(item => {
      if (item.type === 'divider') {
        const div = document.createElement('div');
        div.className = 'context-menu-divider';
        menu.appendChild(div);
      } else {
        const menuItem = document.createElement('div');
        menuItem.className = 'context-menu-item';
        menuItem.textContent = item.label;
        menuItem.addEventListener('click', () => {
          item.action();
          hideContextMenu();
        });
        menu.appendChild(menuItem);
      }
    });

    document.body.appendChild(menu);
    _contextMenuEl = menu;

    const closeHandler = (ev) => {
      if (!menu.contains(ev.target)) {
        hideContextMenu();
        document.removeEventListener('click', closeHandler);
      }
    };
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
  }
};

// ========================================
// 五、撤销/重做管理器 FIX #13
// 关键点：每次变更前快照 Project 状态，撤销/重做时恢复
// ========================================
const UndoManager = {
  undoStack: [],
  redoStack: [],
  maxSteps: 50,
  _locked: false,  // 恢复状态时锁定，防止循环记录

  init() {
    document.getElementById('btn-undo').addEventListener('click', () => this.undo());
    document.getElementById('btn-redo').addEventListener('click', () => this.redo());
    // Keyboard shortcuts handled in initApp()
  },

  // 保存当前状态到撤销栈
  saveState() {
    if (this._locked) return;
    const snapshot = this._snapshot();
    this.undoStack.push(snapshot);
    if (this.undoStack.length > this.maxSteps) this.undoStack.shift();
    // 新操作清空重做栈
    this.redoStack = [];
    this._updateButtons();
  },

  undo() {
    if (this.undoStack.length === 0) return;
    // 当前状态入重做栈
    this.redoStack.push(this._snapshot());
    // 恢复上一个状态
    const state = this.undoStack.pop();
    this._locked = true;
    this._restore(state);
    this._locked = false;
    this._updateButtons();
  },

  redo() {
    if (this.redoStack.length === 0) return;
    // 当前状态入撤销栈
    this.undoStack.push(this._snapshot());
    const state = this.redoStack.pop();
    this._locked = true;
    this._restore(state);
    this._locked = false;
    this._updateButtons();
  },

  _snapshot() {
    return {
      name: Project.name,
      fps: Project.fps,
      media: JSON.parse(JSON.stringify(Project.media)),
      tracks: JSON.parse(JSON.stringify(Project.tracks)),
      currentTime: Project.currentTime,
      isPlaying: Project.isPlaying
    };
  },

  _restore(state) {
    Project.name = state.name;
    Project.fps = state.fps;
    Project.media = JSON.parse(JSON.stringify(state.media));
    Project.tracks = JSON.parse(JSON.stringify(state.tracks));
    Project.currentTime = state.currentTime;
    Project.isPlaying = state.isPlaying;
    EventBus.emit('media:changed', Project.media);
    EventBus.emit('timeline:changed', Project.tracks);
    EventBus.emit('time:changed', state.currentTime);
    EventBus.emit('playback:changed', state.isPlaying);
  },

  _updateButtons() {
    const btnUndo = document.getElementById('btn-undo');
    const btnRedo = document.getElementById('btn-redo');
    btnUndo.style.opacity = this.undoStack.length > 0 ? '1' : '0.4';
    btnRedo.style.opacity = this.redoStack.length > 0 ? '1' : '0.4';
  }
};

// ========================================
// 六、导入模块
// 关键点：NW.js 中文件对话框的使用
// ————
// NW.js 对 <input type="file"> 有原生支持，
// 选中的文件可以通过 File API 读取属性，
// 通过 path 属性获取本地文件路径
// ========================================
const Importer = {
  input: null,

  init() {
    // 创建隐藏的文件选择器
    this.input = document.createElement('input');
    this.input.type = 'file';
    this.input.accept = 'video/*,audio/*,image/*';
    this.input.multiple = true;
    this.input.style.display = 'none';
    document.body.appendChild(this.input);

    this.input.addEventListener('change', () => this._handleFiles());

    document.getElementById('btn-import').addEventListener('click', () => {
      this.input.click();
    });
  },

  _handleFiles() {
    const files = Array.from(this.input.files);
    files.forEach(file => {
      const filePath = file.path || file.name; // NW.js 提供 path 属性

      // 判断媒体类型
      let type = 'video';
      if (file.type.startsWith('audio/')) type = 'audio';
      else if (file.type.startsWith('image/')) type = 'image';

      // 尝试获取视频时长（通过创建临时 URL）
      const url = URL.createObjectURL(file);
      const tempVideo = document.createElement('video');
      tempVideo.preload = 'metadata';
      tempVideo.src = url;

      tempVideo.addEventListener('loadedmetadata', () => {
        const media = Project.addMedia({
          name: file.name,
          path: filePath,
          type: type,
          duration: tempVideo.duration || 0,
          width: tempVideo.videoWidth || 0,
          height: tempVideo.videoHeight || 0,
          size: file.size
        });
        // 自动加载到预览播放器（视频/音频/图片都可以预览）
        if (media.type === 'video' || media.type === 'audio' || media.type === 'image') {
          EventBus.emit('player:source', media.path, media.type);
        }
        URL.revokeObjectURL(url);
      });

      tempVideo.addEventListener('error', () => {
        // 音视频加载失败，作为通用文件处理
        const media = Project.addMedia({
          name: file.name,
          path: filePath,
          type: type,
          duration: 5, // 默认5秒
          width: 0, height: 0,
          size: file.size
        });
        URL.revokeObjectURL(url);
      });
    });

    this.input.value = '';
  }
};

// ========================================
// 六、导出模块 FIX #15
// ========================================
const Exporter = {
  modal: document.getElementById('export-modal'),
  progressFill: document.getElementById('export-progress-fill'),
  progressText: document.getElementById('export-progress-text'),
  timeEstimate: document.getElementById('export-time-estimate'),
  btnCancel: document.getElementById('btn-cancel-export'),
  ffmpegProcess: null,
  exportStartTime: 0,

  init() {
    document.getElementById('btn-export').addEventListener('click', () => this.exportVideo());
    this.btnCancel.addEventListener('click', () => this.cancelExport());
  },

  _showModal() {
    this.modal.style.display = 'flex';
    this.progressFill.style.width = '0%';
    this.progressText.textContent = '准备中...';
    this.timeEstimate.textContent = '';
  },

  _hideModal() {
    this.modal.style.display = 'none';
    this.ffmpegProcess = null;
  },

  cancelExport() {
    if (this.ffmpegProcess) {
      this.ffmpegProcess.kill();
      this.ffmpegProcess = null;
    }
    this._hideModal();
    setStatus('导出已取消');
  },

  exportVideo() {
    const videoClips = Project.tracks
      .filter(t => t.type === 'video')
      .flatMap(t => t.clips);

    if (videoClips.length === 0) {
      alert('请先在时间轴上添加视频片段');
      return;
    }

    if (!window.isNW) {
      alert('导出功能需要在 NW.js 环境中运行\n(当前为浏览器预览模式)');
      return;
    }

    // 计算总时长用于进度估算
    const totalDuration = videoClips.reduce((sum, c) => sum + c.duration, 0);

    const concatFile = path.join(
      require('os').tmpdir(),
      'smartclip_concat_' + Date.now() + '.txt'
    );

    const fileList = videoClips
      .map(c => `file '${c.path.replace(/\\/g, '/')}'`)
      .join('\n');
    fs.writeFileSync(concatFile, fileList);

    const savePath = path.join(
      require('os').homedir(),
      'Desktop',
      '智能剪辑_输出_' + Date.now() + '.mp4'
    );

    this._showModal();
    this.exportStartTime = Date.now();
    setStatus('正在导出...');

    this.ffmpegProcess = childProcess.spawn('ffmpeg', [
      '-f', 'concat',
      '-safe', '0',
      '-i', concatFile,
      '-c', 'copy',
      '-y',
      savePath
    ]);

    let stderr = '';
    this.ffmpegProcess.stderr.on('data', (data) => {
      stderr += data.toString();
      // FIX #15: 解析 FFmpeg 输出中的时间戳，计算进度
      const timeMatch = stderr.match(/time=(\d+):(\d+):(\d+)\.(\d+)/g);
      if (timeMatch) {
        const last = timeMatch[timeMatch.length - 1];
        const parts = last.match(/time=(\d+):(\d+):(\d+)\.(\d+)/);
        if (parts) {
          const h = parseInt(parts[1]), m = parseInt(parts[2]);
          const s = parseInt(parts[3]), cs = parseInt(parts[4]);
          const currentSec = h * 3600 + m * 60 + s + cs / 100;
          const pct = Math.min(99, Math.round((currentSec / totalDuration) * 100));
          this.progressFill.style.width = pct + '%';
          this.progressText.textContent = `导出中... ${pct}%`;

          // 估算剩余时间
          const elapsed = (Date.now() - this.exportStartTime) / 1000;
          if (pct > 0) {
            const eta = (elapsed / pct) * (100 - pct);
            this.timeEstimate.textContent = `预计剩余: ${Math.ceil(eta)} 秒`;
          }
        }
      }
      setStatus('导出中... ' + stderr.slice(-40).replace(/\n/g, ' '));
    });

    this.ffmpegProcess.on('close', (code) => {
      try { fs.unlinkSync(concatFile); } catch (e) { /* ignore */ }

      if (code === 0) {
        this.progressFill.style.width = '100%';
        this.progressText.textContent = '导出完成! ✅';
        this.timeEstimate.textContent = '';
        setStatus('导出完成: ' + savePath);
        setTimeout(() => {
          this._hideModal();
          alert('导出成功!\n' + savePath);
        }, 500);
      } else {
        this._hideModal();
        setStatus('导出失败');
        alert('导出失败，请确认已安装 FFmpeg\n\n错误信息: ' + stderr.slice(-200));
      }
    });

    this.ffmpegProcess.on('error', (err) => {
      this._hideModal();
      setStatus('导出错误: ' + err.message);
      alert('无法调用 FFmpeg，请确认已安装并添加到 PATH\n\nhttps://ffmpeg.org/download.html');
    });
  }
};

// ========================================
// 七、项目管理 FIX #14
// ========================================
const ProjectManager = {
  init() {
    document.getElementById('btn-new').addEventListener('click', () => this.newProject());
    document.getElementById('btn-save').addEventListener('click', () => this.saveProject());
    document.getElementById('btn-open').addEventListener('click', () => this.openProject());
  },

  newProject() {
    if (Project.media.length > 0 || Project.tracks.some(t => t.clips.length > 0)) {
      if (!confirm('确定要新建项目吗？当前未保存的内容将丢失。')) return;
    }
    Project.name = '未命名项目';
    Project.media = [];
    Project.tracks.forEach(t => t.clips = []);
    Project.currentTime = 0;
    Timeline.selectedClipId = null;
    UndoManager.undoStack = [];
    UndoManager.redoStack = [];
    document.querySelector('.project-name').textContent = Project.name;
    EventBus.emit('media:changed', Project.media);
    EventBus.emit('timeline:changed', Project.tracks);
    renderProjectInfo();
    setStatus('已创建新项目');
  },

  saveProject() {
    if (!window.isNW) {
      alert('保存功能需要在 NW.js 环境中运行');
      return;
    }
    const data = JSON.stringify({
      name: Project.name,
      fps: Project.fps,
      media: Project.media,
      tracks: Project.tracks,
      version: '1.0',
      savedAt: new Date().toISOString()
    }, null, 2);

    // 使用 NW.js 的文件保存对话框
    const savePath = path.join(
      require('os').homedir(),
      'Desktop',
      (Project.name === '未命名项目' ? '未命名项目' : Project.name) + '.scproj'
    );

    try {
      fs.writeFileSync(savePath, data, 'utf8');
      setStatus('项目已保存: ' + savePath);
    } catch (err) {
      alert('保存失败: ' + err.message);
    }
  },

  openProject() {
    if (!window.isNW) {
      alert('打开功能需要在 NW.js 环境中运行');
      return;
    }
    // 创建文件选择器
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.scproj,.json';
    input.addEventListener('change', () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const filePath = file.path || file.name;
        const raw = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(raw);

        if (!data.tracks || !data.media) {
          alert('无效的项目文件格式');
          return;
        }

        Project.name = data.name || '未命名项目';
        Project.fps = data.fps || 30;
        Project.media = data.media || [];
        Project.tracks = data.tracks || [];
        Project.currentTime = 0;
        Timeline.selectedClipId = null;
        UndoManager.undoStack = [];
        UndoManager.redoStack = [];

        document.querySelector('.project-name').textContent = Project.name;
        EventBus.emit('media:changed', Project.media);
        EventBus.emit('timeline:changed', Project.tracks);
        renderProjectInfo();
        setStatus('项目已打开: ' + filePath.split(/[/\\]/).pop());
      } catch (err) {
        alert('打开项目失败: ' + err.message);
      }
    });
    input.click();
  }
};

// ========================================
// 八、UI 辅助函数
// ========================================
// 自动将导入的媒体添加到时间轴轨道
function autoAddToTimeline(media) {
  if (!media) return;

  // 计算新片段在时间轴上的起始位置（放在已有片段之后）
  let maxEndTime = 0;
  Project.tracks.forEach(track => {
    track.clips.forEach(clip => {
      const endTime = clip.startTime + clip.duration;
      if (endTime > maxEndTime) maxEndTime = endTime;
    });
  });

  const duration = media.duration || 5;

  // 视频/图片 → 添加到视频轨
  if (media.type === 'video' || media.type === 'image') {
    Project.addClipToTrack('video1', {
      mediaId: media.id,
      name: media.name,
      path: media.path,
      startTime: maxEndTime,
      duration: duration
    });
  }

  // 视频/音频 → 添加到音频轨（视频自带音频也加入音频轨）
  if (media.type === 'video' || media.type === 'audio') {
    Project.addClipToTrack('audio1', {
      mediaId: media.id,
      name: media.name,
      path: media.path,
      startTime: maxEndTime,
      duration: duration
    });
  }
}

function setStatus(msg) {
  document.getElementById('status-text').textContent = msg;
}

// FIX #8: 生成素材缩略图
function generateThumb(media) {
  if (media.type === 'image') {
    // 图片直接用文件路径
    if (window.isNW) {
      return 'file:///' + media.path.replace(/\\/g, '/');
    }
    return media.path;
  }
  // 视频/音频暂时显示类型图标，后续用 canvas 截帧
  return null;
}

// 渲染素材列表
function renderMediaList(media) {
  const container = document.getElementById('media-list');
  if (!media.length) {
    container.innerHTML = '<p class="placeholder">点击\"导入\"添加视频、音频、图片</p>';
    return;
  }

  const typeLabels = { video: '🎬', audio: '🎵', image: '🖼️' };
  const typeIcons = { video: '🎬', audio: '🎵', image: '🖼️' };

  container.innerHTML = media.map(m => {
    const thumbSrc = generateThumb(m);
    const thumbHTML = thumbSrc
      ? `<img class="media-thumb" src="${thumbSrc}" alt="">`
      : `<div class="media-thumb" style="display:flex;align-items:center;justify-content:center;font-size:20px;">${typeIcons[m.type] || '📄'}</div>`;
    return `
      <div class="media-item"
           draggable="true"
           data-media='${JSON.stringify(m).replace(/'/g, "&#39;")}'>
        ${thumbHTML}
        <div class="media-info-wrap">
          <div class="media-name">${typeLabels[m.type] || '📄'} ${m.name}</div>
          <div class="media-info">
            ${m.duration ? m.duration.toFixed(1) + 's' : ''}
            ${m.width ? ' | ' + m.width + '×' + m.height : ''}
            ${m.size ? ' | ' + (m.size / 1024 / 1024).toFixed(1) + 'MB' : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');

  // 素材拖拽开始
  container.querySelectorAll('.media-item').forEach(el => {
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/json', el.dataset.media);
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', (e) => {
      el.classList.remove('dragging');
    });

    // 双击素材预览
    el.addEventListener('dblclick', () => {
      const media = JSON.parse(el.dataset.media);
      EventBus.emit('player:source', media.path, media.type);
    });

    // FIX #9: 右键菜单
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showMediaContextMenu(e, JSON.parse(el.dataset.media), el);
    });
  });
}

// FIX #9: 右键菜单
let _contextMenuEl = null;

function hideContextMenu() {
  if (_contextMenuEl) {
    _contextMenuEl.remove();
    _contextMenuEl = null;
  }
}

function showMediaContextMenu(e, media, el) {
  hideContextMenu();

  const menu = document.createElement('div');
  menu.className = 'context-menu';
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';

  const items = [
    { label: '👁 预览', action: () => {
      EventBus.emit('player:source', media.path, media.type);
    }},
    { label: '➕ 添加到时间轴', action: () => autoAddToTimeline(media) },
    { type: 'divider' },
    { label: '🗑 删除素材', action: () => {
      Project.media = Project.media.filter(m => m.id !== media.id);
      // 同时删除关联的片段
      Project.tracks.forEach(track => {
        track.clips = track.clips.filter(c => c.mediaId !== media.id);
      });
      EventBus.emit('media:changed', Project.media);
      EventBus.emit('timeline:changed', Project.tracks);
      setStatus(`已删除素材: ${media.name}`);
    }},
    { label: 'ℹ 属性', action: () => {
      alert(`文件: ${media.name}\n类型: ${media.type}\n路径: ${media.path}\n时长: ${media.duration.toFixed(1)}s\n尺寸: ${media.width}×${media.height}\n大小: ${(media.size / 1024 / 1024).toFixed(1)}MB`);
    }}
  ];

  items.forEach(item => {
    if (item.type === 'divider') {
      const div = document.createElement('div');
      div.className = 'context-menu-divider';
      menu.appendChild(div);
    } else {
      const menuItem = document.createElement('div');
      menuItem.className = 'context-menu-item';
      menuItem.textContent = item.label;
      menuItem.addEventListener('click', () => {
        item.action();
        hideContextMenu();
      });
      menu.appendChild(menuItem);
    }
  });

  document.body.appendChild(menu);
  _contextMenuEl = menu;

  // 点击其他地方关闭菜单
  const closeHandler = (ev) => {
    if (!menu.contains(ev.target)) {
      hideContextMenu();
      document.removeEventListener('click', closeHandler);
    }
  };
  setTimeout(() => document.addEventListener('click', closeHandler), 0);
}

// FIX #11: 未选中片段时显示项目概览
function renderProjectInfo() {
  const container = document.getElementById('panel-content');
  let totalClips = 0;
  let totalDuration = 0;
  Project.tracks.forEach(track => {
    totalClips += track.clips.length;
    track.clips.forEach(clip => {
      const end = clip.startTime + clip.duration;
      if (end > totalDuration) totalDuration = end;
    });
  });

  container.innerHTML = `
    <div class="prop-group">
      <label>项目名称</label>
      <div>${Project.name}</div>
    </div>
    <div class="prop-group">
      <label>素材数量</label>
      <div>${Project.media.length} 个</div>
    </div>
    <div class="prop-group">
      <label>片段数量</label>
      <div>${totalClips} 个</div>
    </div>
    <div class="prop-group">
      <label>总时长</label>
      <div>${formatTime(totalDuration)}</div>
    </div>
    <div class="prop-group">
      <label>帧率</label>
      <div>${Project.fps} fps</div>
    </div>
    <div class="prop-group">
      <label>轨道数</label>
      <div>${Project.tracks.length} 条</div>
    </div>
  `;
}

// FIX #10 #12: 渲染属性面板（可编辑字段 + 详细信息）
function renderProperties(clip, trackId) {
  const container = document.getElementById('panel-content');
  const track = Project.tracks.find(t => t.id === trackId);
  const media = Project.media.find(m => m.id === clip.mediaId);

  container.innerHTML = `
    <div class="prop-group">
      <label>名称</label>
      <input type="text" id="prop-name" value="${escapeHTML(clip.name)}" style="width:100%;padding:4px 6px;background:var(--bg-primary);color:var(--text-primary);border:1px solid var(--border);border-radius:3px;font-size:12px;">
    </div>
    <div class="prop-group">
      <label>轨道</label>
      <div>${track ? track.name : '—'}</div>
    </div>
    <div class="prop-group">
      <label>起始时间 (秒)</label>
      <input type="number" id="prop-start" value="${clip.startTime.toFixed(2)}" step="0.01" min="0" style="width:100%;padding:4px 6px;background:var(--bg-primary);color:var(--text-primary);border:1px solid var(--border);border-radius:3px;font-size:12px;">
    </div>
    <div class="prop-group">
      <label>时长 (秒)</label>
      <input type="number" id="prop-duration" value="${clip.duration.toFixed(2)}" step="0.01" min="0.1" style="width:100%;padding:4px 6px;background:var(--bg-primary);color:var(--text-primary);border:1px solid var(--border);border-radius:3px;font-size:12px;">
    </div>
    ${media ? `
    <div class="prop-group" style="border-top:1px solid var(--border);padding-top:8px;margin-top:8px;">
      <label style="color:var(--accent);">媒体信息</label>
      <div style="font-size:11px;color:var(--text-muted);line-height:1.6;">
        ${media.width && media.height ? `分辨率: ${media.width}×${media.height}<br>` : ''}
        文件路径:<br><span style="word-break:break-all;">${media.path || '—'}</span><br>
        大小: ${media.size ? (media.size / 1024 / 1024).toFixed(1) + ' MB' : '—'}
      </div>
    </div>
    ` : ''}
    <button id="btn-delete-clip" style="margin-top:12px;background:var(--accent);color:#fff;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;width:100%;">
      🗑 删除片段
    </button>
  `;

  // FIX #10: 可编辑字段 — change 时更新数据
  document.getElementById('prop-name').addEventListener('change', function() {
    UndoManager.saveState();  // FIX #13
    clip.name = this.value;
    EventBus.emit('timeline:changed', Project.tracks);
  });
  document.getElementById('prop-start').addEventListener('change', function() {
    UndoManager.saveState();  // FIX #13
    clip.startTime = parseFloat(this.value) || 0;
    EventBus.emit('timeline:changed', Project.tracks);
  });
  document.getElementById('prop-duration').addEventListener('change', function() {
    UndoManager.saveState();  // FIX #13
    clip.duration = Math.max(0.1, parseFloat(this.value) || 1);
    clip.trimEnd = clip.duration; // 重置裁剪终点
    EventBus.emit('timeline:changed', Project.tracks);
  });

  document.getElementById('btn-delete-clip').addEventListener('click', () => {
    Project.removeClip(trackId, clip.id);
    Timeline.selectedClipId = null;
    renderProjectInfo();  // FIX #11: 回到项目概览
  });
}

// HTML 转义辅助
function escapeHTML(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ========================================
// 八、应用初始化
// 关键点：所有模块在这里"装配"
// ————
// 这是依赖注入的朴素形式：
// 各模块不直接依赖彼此，通过 EventBus 通信，
// 初始化顺序只影响功能可用性，不影响正确性
// ========================================
function initApp() {
  Player.init();
  PreviewControls.init();  // FIX #6 #7
  Timeline.init();
  Importer.init();
  Exporter.init();
  UndoManager.init();       // FIX #13
  ProjectManager.init();    // FIX #14

  // 键盘快捷键
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    switch (e.code) {
      case 'Space':
        e.preventDefault();
        Player.toggle();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        Player.seek(Project.currentTime - 1 / Project.fps);
        break;
      case 'ArrowRight':
        e.preventDefault();
        Player.seek(Project.currentTime + 1 / Project.fps);
        break;
      case 'Delete':
        // FIX #18: 删除选中片段
        if (Timeline.selectedClipId) {
          for (const track of Project.tracks) {
            const clip = track.clips.find(c => c.id === Timeline.selectedClipId);
            if (clip) {
              Project.removeClip(track.id, Timeline.selectedClipId);
              Timeline.selectedClipId = null;
              document.getElementById('panel-content').innerHTML = '<p class="placeholder">选择片段查看属性</p>';
              renderProjectInfo();  // FIX #11: 回到项目概览
              break;
            }
          }
        }
        break;
      case 'KeyS':
        // FIX #17: S 键 — 在播放头分割片段（不按 Ctrl）
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          Timeline.splitClipAtPlayhead();
        }
        break;
    }

    // FIX #13: Ctrl+Z/Y 快捷键
    if (e.ctrlKey || e.metaKey) {
      switch (e.code) {
        case 'KeyZ':
          e.preventDefault();
          if (e.shiftKey) {
            UndoManager.redo();
          } else {
            UndoManager.undo();
          }
          break;
        case 'KeyY':
          e.preventDefault();
          UndoManager.redo();
          break;
        case 'KeyS':
          e.preventDefault();
          ProjectManager.saveProject();
          break;
      }
    }
  });

  // 监听素材变化 → 更新素材面板
  EventBus.on('media:changed', renderMediaList);

  // 监听片段选中 → 更新属性面板
  EventBus.on('clip:selected', renderProperties);

  // 初始渲染
  renderMediaList([]);
  renderProjectInfo();  // FIX #11: 初始显示项目概览

  setStatus('就绪 — 点击\"导入\"开始，或拖拽素材到时间轴');
  // 左侧标签页切换
  document.querySelectorAll('.left-tab').forEach(tab => {
    tab.addEventListener('click', function() {
      document.querySelectorAll('.left-tab').forEach(t => t.classList.remove('active'));
      this.classList.add('active');
      const targetId = 'tab-' + this.dataset.tab;
      document.querySelectorAll('.left-panel-content').forEach(p => p.classList.remove('active'));
      const target = document.getElementById(targetId);
      if (target) target.classList.add('active');
    });
  });

  console.log('智能剪辑 初始化完成');
  console.log('运行环境:', window.isNW ? 'NW.js' : '浏览器(预览模式)');
}

// 启动
document.addEventListener('DOMContentLoaded', initApp);
