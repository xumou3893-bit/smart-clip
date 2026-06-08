/**
 * smart-clip — 时间轴渲染模块（核心）
 *
 * 数据驱动渲染：每次数据变化清空重绘。
 * 功能：轨道渲染、片段拖拽、裁剪手柄、播放头、标尺擦洗、
 *        分割、吸附、右键菜单、缩放、滚动同步。
 */

const Timeline = {
  container: document.getElementById('timeline-tracks'),
  ruler: document.getElementById('time-ruler'),
  timeLabel: document.querySelector('.time-label'),
  pixelsPerSecond: 50,
  totalDuration: 60,
  selectedClipId: null,
  dragState: null,
  _scrubbing: false,
  _playerLocked: false,
  _snapEnabled: true,
  _dragMoveBound: null,
  _trimState: null,
  _playheadCreated: false,
  _pendingTime: null,

  init() {
    EventBus.on('timeline:changed', () => this.render());
    EventBus.on('time:changed', (time) => {
      this.updatePlayhead(time);
      this.updateTimeLabel(time);
    });

    this.container.addEventListener('click', (e) => {
      if (this.dragState) return;
      const rect = this.container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      if (x < 0) return;
      const time = x / this.pixelsPerSecond;
      EventBus.emit('player:seek', time);
    });

    document.getElementById('btn-zoom-in').addEventListener('click', () => this.zoom(1.3));
    document.getElementById('btn-zoom-out').addEventListener('click', () => this.zoom(0.77));

    const zoomSlider = document.getElementById('zoom-slider');
    if (zoomSlider) {
      zoomSlider.addEventListener('input', () => {
        this.pixelsPerSecond = parseInt(zoomSlider.value);
        this.render();
        this._updateZoomLabel();
      });
    }

    const btnSplit = document.getElementById('btn-split-tool');
    if (btnSplit) {
      btnSplit.addEventListener('click', () => this.splitClipAtPlayhead());
    }

    const btnSnap = document.querySelector('.timeline-toolbar .btn-tt[title="吸附"]');
    if (btnSnap) {
      btnSnap.addEventListener('click', () => {
        this._snapEnabled = !this._snapEnabled;
        btnSnap.classList.toggle('active', this._snapEnabled);
        setStatus(this._snapEnabled ? '吸附: 开' : '吸附: 关');
      });
    }

    const ttUndoBtn = document.querySelector('.timeline-toolbar .btn-tt[title="撤销"]');
    const ttRedoBtn = document.querySelector('.timeline-toolbar .btn-tt[title="重做"]');
    if (ttUndoBtn) ttUndoBtn.addEventListener('click', () => UndoManager.undo());
    if (ttRedoBtn) ttRedoBtn.addEventListener('click', () => UndoManager.redo());

    EventBus.on('time:changed', (time) => {
      const disp = document.getElementById('timeline-time-display');
      if (disp) disp.textContent = formatTime(time);
    });

    this.container.addEventListener('scroll', () => {
      this.ruler.scrollLeft = this.container.scrollLeft;
    });
    this.ruler.addEventListener('scroll', () => {
      this.container.scrollLeft = this.ruler.scrollLeft;
    });

    this._initRulerInteraction();

    document.addEventListener('mouseup', () => {
      if (this.dragState) this._endDrag();
    });

    this.render();
  },

  _updateZoomLabel() {
    const label = document.getElementById('zoom-label');
    if (label) label.textContent = Math.round(this.pixelsPerSecond / 50 * 100) + '%';
    const slider = document.getElementById('zoom-slider');
    if (slider) slider.value = this.pixelsPerSecond;
  },

  zoom(factor) {
    this.pixelsPerSecond = Math.max(20, Math.min(200, Math.round(this.pixelsPerSecond * factor)));
    this._updateZoomLabel();
    this.render();
    setStatus(`缩放: ${Math.round(this.pixelsPerSecond / 50 * 100)}%`);
  },

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

  renderRuler() {
    this.ruler.innerHTML = '';

    const rulerInner = document.createElement('div');
    rulerInner.className = 'ruler-inner';
    const width = this.totalDuration * this.pixelsPerSecond;
    rulerInner.style.cssText = `position:relative;width:${width}px;min-width:${width}px;height:100%;`;

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

    this._playheadCreated = false;
    this._createPlayhead();
    this.updatePlayhead(Project.currentTime);
  },

  updateTimeLabel(time) {
    if (this.timeLabel) {
      this.timeLabel.textContent = formatTime(time);
    }
  },

  render() {
    this.totalDuration = this._calcTotalDuration();
    this.container.innerHTML = '';
    this.renderRuler();

    Project.tracks.forEach(track => {
      const trackEl = document.createElement('div');
      trackEl.className = 'track';
      trackEl.dataset.trackId = track.id;

      const content = document.createElement('div');
      content.className = 'track-content';
      content.style.width = (this.totalDuration * this.pixelsPerSecond) + 'px';

      track.clips.forEach(clip => {
        const clipEl = document.createElement('div');
        clipEl.className = 'track-clip' + (track.type === 'audio' ? ' audio' : '');
        if (clip.id === this.selectedClipId) clipEl.classList.add('selected');

        const effectiveStart = clip.trimStart || 0;
        const effectiveEnd = clip.trimEnd || clip.duration;
        const effectiveDuration = effectiveEnd - effectiveStart;

        clipEl.style.left = (clip.startTime * this.pixelsPerSecond) + 'px';
        clipEl.style.width = (effectiveDuration * this.pixelsPerSecond) + 'px';
        clipEl.textContent = clip.name;
        clipEl.title = `${clip.name}\n起始: ${clip.startTime.toFixed(1)}s\n时长: ${clip.duration.toFixed(1)}s\n裁剪: ${effectiveStart.toFixed(1)}s ~ ${effectiveEnd.toFixed(1)}s`;
        clipEl.dataset.clipId = clip.id;
        clipEl.dataset.trackId = track.id;

        const trimLeft = document.createElement('div');
        trimLeft.className = 'trim-handle trim-handle-left';
        trimLeft.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this._onTrimStart(e, clip, clipEl, track.id, 'left');
        });

        const trimRight = document.createElement('div');
        trimRight.className = 'trim-handle trim-handle-right';
        trimRight.addEventListener('mousedown', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this._onTrimStart(e, clip, clipEl, track.id, 'right');
        });

        clipEl.appendChild(trimLeft);
        clipEl.appendChild(trimRight);

        clipEl.addEventListener('mousedown', (e) => this._onClipMouseDown(e, clip, track.id));
        clipEl.addEventListener('click', (e) => {
          e.stopPropagation();
          this.selectClip(clip, track.id);
        });

        clipEl.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          e.stopPropagation();
          this._showClipContextMenu(e, clip, track.id);
        });

        content.appendChild(clipEl);
      });

      if (!this._dragMoveBound) {
        this._dragMoveBound = (e) => this._onDragMove(e);
        document.addEventListener('mousemove', this._dragMoveBound);
      }

      content.addEventListener('dragover', (e) => {
        e.preventDefault();
        const mediaData = e.dataTransfer.getData('application/json');
        if (!mediaData) return;
        try {
          const media = JSON.parse(mediaData);
          if (media.clipId) return;
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
            if (media.clipId) return;

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

  selectClip(clip, trackId) {
    this.selectedClipId = clip.id;
    EventBus.emit('clip:selected', clip, trackId);
    this.container.querySelectorAll('.track-clip').forEach(el => {
      el.classList.toggle('selected', el.dataset.clipId === clip.id);
    });
    const media = Project.media.find(m => m.id === clip.mediaId);
    if (media) {
      EventBus.emit('player:source', media.path, media.type);
    }
  },

  _onClipMouseDown(e, clip, trackId) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    this.selectClip(clip, trackId);
    UndoManager.saveState();

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

  _onDragMove(e) {
    if (!this.dragState) return;
    const ds = this.dragState;
    const dx = e.clientX - ds.startMouseX;
    const dt = dx / this.pixelsPerSecond;

    if (Math.abs(dx) < 2) return;
    ds.moved = true;

    let newStart = ds.origStartTime + dt;
    newStart = Math.max(0, newStart);
    newStart = this._snapTime(newStart, ds.trackId, ds.clip.id);

    ds.clip.startTime = newStart;
    ds.clipEl.style.left = (newStart * this.pixelsPerSecond) + 'px';
    ds.clipEl.title = `${ds.clip.name}\n起始: ${newStart.toFixed(1)}s\n时长: ${ds.clip.duration.toFixed(1)}s`;
  },

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

  _snapTime(time, trackId, excludeClipId) {
    if (!this._snapEnabled) return time;
    const threshold = 0.3;
    let bestSnap = time;
    let bestDist = threshold;

    Project.tracks.forEach(track => {
      track.clips.forEach(clip => {
        if (clip.id === excludeClipId) return;
        const d1 = Math.abs(time - clip.startTime);
        if (d1 < bestDist) { bestDist = d1; bestSnap = clip.startTime; }
        const rightEdge = clip.startTime + clip.duration;
        const d2 = Math.abs(time - rightEdge);
        if (d2 < bestDist) { bestDist = d2; bestSnap = rightEdge; }
      });
    });

    const d3 = Math.abs(time - Project.currentTime);
    if (d3 < bestDist) { bestDist = d3; bestSnap = Project.currentTime; }

    if (Math.abs(time) < bestDist) bestSnap = 0;

    return bestSnap;
  },

  _createPlayhead() {
    if (!this.container.querySelector('.playhead-line')) {
      const line = document.createElement('div');
      line.className = 'playhead-line';
      line.style.cssText = `position:absolute;top:0;left:0;width:2px;height:100%;background:var(--danger);z-index:15;pointer-events:none;will-change:transform;transform:translateX(0px);`;
      this.container.style.position = 'relative';
      this.container.appendChild(line);
    }
    if (!this.ruler.querySelector('.playhead-diamond')) {
      const diamond = document.createElement('div');
      diamond.className = 'playhead-diamond';
      diamond.style.cssText = `position:absolute;top:-6px;left:0;width:14px;height:14px;background:var(--danger);z-index:16;border-radius:2px;pointer-events:auto;cursor:col-resize;box-shadow:0 0 4px rgba(255,77,79,0.6);will-change:transform;transform:translateX(0px) rotate(45deg);`;
      diamond.title = '拖动以预览';
      this.ruler.style.position = 'relative';
      this.ruler.appendChild(diamond);
    }
    if (!this.ruler.querySelector('.playhead-tooltip')) {
      const tooltip = document.createElement('div');
      tooltip.className = 'playhead-tooltip';
      tooltip.style.cssText = `position:absolute;top:-28px;left:0;transform:translateX(-50%);background:var(--bg-elevated);color:#fff;font-size:10px;font-family:"SF Mono","Consolas","Courier New",monospace;padding:2px 6px;border-radius:3px;z-index:17;pointer-events:none;white-space:nowrap;border:1px solid var(--border);opacity:0;transition:opacity 0.15s;`;
      this.ruler.appendChild(tooltip);
    }
    this._playheadCreated = true;
  },

  _clientXToTime(e) {
    const rect = this.ruler.getBoundingClientRect();
    const scrollLeft = this.ruler.scrollLeft || 0;
    return Math.max(0, (e.clientX - rect.left + scrollLeft) / this.pixelsPerSecond);
  },

  updatePlayhead(time) {
    this._createPlayhead();
    const px = time * this.pixelsPerSecond;
    const tx = `translateX(${px}px)`;

    const line = this.container.querySelector('.playhead-line');
    const diamond = this.ruler.querySelector('.playhead-diamond');
    const tooltip = this.ruler.querySelector('.playhead-tooltip');

    if (line) line.style.transform = tx;
    if (diamond) diamond.style.transform = `translateX(${px}px) rotate(45deg)`;
    if (tooltip) {
      tooltip.style.left = px + 'px';
      tooltip.textContent = formatTime(time);
    }

    const rulerScroll = this.ruler.scrollLeft || 0;
    const rulerWidth = this.ruler.clientWidth;
    if (rulerWidth && (px > rulerScroll + rulerWidth - 40 || px < rulerScroll + 10)) {
      this.ruler.scrollLeft = px - rulerWidth / 2;
    }
  },

  _initRulerInteraction() {
    const ruler = this.ruler;
    this._scrubbing = false;
    this._pendingTime = null;

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
      this._playerLocked = true;

      const diamond = ruler.querySelector('.playhead-diamond');
      if (diamond) diamond.style.boxShadow = '0 0 10px rgba(255,77,79,1)';

      const time = this._clientXToTime(e);
      this._pendingTime = time;
      requestAnimationFrame(rafLoop);
    };

    const moveScrub = (e) => {
      if (!this._scrubbing) return;
      this._pendingTime = this._clientXToTime(e);
    };

    const endScrub = (e) => {
      if (!this._scrubbing) return;
      this._scrubbing = false;
      this._playerLocked = false;
      document.body.style.cursor = '';

      const diamond = ruler.querySelector('.playhead-diamond');
      if (diamond) diamond.style.boxShadow = '0 0 4px rgba(255,77,79,0.6)';

      let time = this._clientXToTime(e);
      time = this._snapTime(time, null, null);
      Player.seek(time);
      Project.updateCurrentTime(time);
      this.updatePlayhead(time);
      this._pendingTime = null;
    };

    ruler.addEventListener('mousedown', startScrub);
    document.addEventListener('mousemove', moveScrub);
    document.addEventListener('mouseup', endScrub);

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

  _onTrimStart(e, clip, clipEl, trackId, side) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

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
        if (Math.abs(ts.clip.trimStart - ts.origTrimStart) > 0.001 ||
            Math.abs(ts.clip.trimEnd - ts.origTrimEnd) > 0.001) {
          UndoManager.saveState();
          EventBus.emit('timeline:changed', Project.tracks);
          EventBus.emit('clip:selected', ts.clip, ts.trackId);
        }
        this._trimState = null;
      }
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    this._trimState = {
      clip: clip,
      clipEl: clipEl,
      side: side,
      trackId: trackId,
      startMouseX: e.clientX,
      origTrimStart: clip.trimStart || 0,
      origTrimEnd: clip.trimEnd || clip.duration,
      origStartTime: clip.startTime,
      _onMove: onMove,
      _onUp: onUp
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  },

  splitClipAtPlayhead() {
    const time = Project.currentTime;
    for (const track of Project.tracks) {
      for (let i = track.clips.length - 1; i >= 0; i--) {
        const clip = track.clips[i];
        const clipStart = clip.startTime;
        const clipEnd = clip.startTime + clip.duration;

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
          clip.duration = splitPoint;
          clip.trimEnd = Math.min(clip.trimEnd || clip.duration, splitPoint);

          track.clips.splice(i + 1, 0, rightClip);
          EventBus.emit('timeline:changed', Project.tracks);
          setStatus(`已在 ${formatTime(time)} 处分割片段`);
          return;
        }
      }
    }
    setStatus('播放头不在任何片段范围内，无法分割');
  },

  _showClipContextMenu(e, clip, trackId) {
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
