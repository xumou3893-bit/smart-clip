/**
 * smart-clip — 导出模块
 *
 * 使用 FFmpeg concat demuxer 将时间轴视频片段合并导出为 MP4。
 * 支持进度条显示、ETA 估算、取消导出。
 */

const Exporter = {
  modal: document.getElementById('export-modal'),
  progressFill: document.getElementById('export-progress-fill'),
  progressText: document.getElementById('export-progress-text'),
  timeEstimate: document.getElementById('export-time-estimate'),
  btnCancel: document.getElementById('btn-cancel-export'),
  ffmpegProcess: null,
  exportStartTime: 0,
  _concatFile: null,  // 临时 concat 文件路径，用于清理

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

  /** 清理临时文件 */
  _cleanup() {
    if (this._concatFile) {
      try { fs.unlinkSync(this._concatFile); } catch (e) { /* ignore */ }
      this._concatFile = null;
    }
  },

  cancelExport() {
    if (this.ffmpegProcess) {
      this.ffmpegProcess.kill();
      this.ffmpegProcess = null;
    }
    this._cleanup();
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

    const totalDuration = videoClips.reduce((sum, c) => sum + c.duration, 0);

    this._concatFile = path.join(
      require('os').tmpdir(),
      'smartclip_concat_' + Date.now() + '.txt'
    );

    const fileList = videoClips
      .map(c => `file '${c.path.replace(/\\/g, '/')}'`)
      .join('\n');
    fs.writeFileSync(this._concatFile, fileList);

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
      '-i', this._concatFile,
      '-c', 'copy',
      '-y',
      savePath
    ]);

    let stderr = '';
    this.ffmpegProcess.stderr.on('data', (data) => {
      stderr += data.toString();
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
      this._cleanup();

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
      this._cleanup();
      this._hideModal();
      setStatus('导出错误: ' + err.message);
      alert('无法调用 FFmpeg，请确认已安装并添加到 PATH\n\nhttps://ffmpeg.org/download.html');
    });
  }
};
