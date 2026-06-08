/**
 * smart-clip — UI 渲染函数
 *
 * 素材列表、属性面板、项目概览、右键菜单的 DOM 渲染逻辑。
 */

let _contextMenuEl = null;

/** 关闭所有右键菜单 */
function hideContextMenu() {
  if (_contextMenuEl) {
    _contextMenuEl.remove();
    _contextMenuEl = null;
  }
}

/** 素材右键菜单 */
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

  const closeHandler = (ev) => {
    if (!menu.contains(ev.target)) {
      hideContextMenu();
      document.removeEventListener('click', closeHandler);
    }
  };
  setTimeout(() => document.addEventListener('click', closeHandler), 0);
}

/** 手动将素材添加到时间轴（仅右键菜单调用） */
function autoAddToTimeline(media) {
  if (!media) return;

  let maxEndTime = 0;
  Project.tracks.forEach(track => {
    track.clips.forEach(clip => {
      const endTime = clip.startTime + clip.duration;
      if (endTime > maxEndTime) maxEndTime = endTime;
    });
  });

  const duration = media.duration || 5;

  if (media.type === 'video' || media.type === 'image') {
    Project.addClipToTrack('video1', {
      mediaId: media.id,
      name: media.name,
      path: media.path,
      startTime: maxEndTime,
      duration: duration
    });
  }

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

/** 渲染素材列表 */
function renderMediaList(media) {
  const container = document.getElementById('media-list');
  if (!media.length) {
    container.innerHTML = '<p class="placeholder">点击"导入"添加视频、音频、图片</p>';
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
          <div class="media-name">${typeLabels[m.type] || '📄'} ${escapeHTML(m.name)}</div>
          <div class="media-info">
            ${m.duration ? m.duration.toFixed(1) + 's' : ''}
            ${m.width ? ' | ' + m.width + '×' + m.height : ''}
            ${m.size ? ' | ' + (m.size / 1024 / 1024).toFixed(1) + 'MB' : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.media-item').forEach(el => {
    el.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('application/json', el.dataset.media);
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', (e) => {
      el.classList.remove('dragging');
    });

    el.addEventListener('dblclick', () => {
      const m = JSON.parse(el.dataset.media);
      EventBus.emit('player:source', m.path, m.type);
    });

    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showMediaContextMenu(e, JSON.parse(el.dataset.media), el);
    });
  });
}

/** 渲染项目概览（未选中片段时显示） */
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
      <div>${escapeHTML(Project.name)}</div>
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

/** 渲染属性面板（选中片段时显示可编辑字段） */
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
      <div>${track ? escapeHTML(track.name) : '—'}</div>
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
        文件路径:<br><span style="word-break:break-all;">${media.path ? escapeHTML(media.path) : '—'}</span><br>
        大小: ${media.size ? (media.size / 1024 / 1024).toFixed(1) + ' MB' : '—'}
      </div>
    </div>
    ` : ''}
    <button id="btn-delete-clip" style="margin-top:12px;background:var(--accent);color:#fff;border:none;padding:6px 16px;border-radius:4px;cursor:pointer;width:100%;">
      🗑 删除片段
    </button>
  `;

  document.getElementById('prop-name').addEventListener('change', function() {
    UndoManager.saveState();
    clip.name = this.value;
    EventBus.emit('timeline:changed', Project.tracks);
  });
  document.getElementById('prop-start').addEventListener('change', function() {
    UndoManager.saveState();
    clip.startTime = parseFloat(this.value) || 0;
    EventBus.emit('timeline:changed', Project.tracks);
  });
  document.getElementById('prop-duration').addEventListener('change', function() {
    UndoManager.saveState();
    const newDuration = Math.max(0.1, parseFloat(this.value) || 1);
    clip.duration = newDuration;
    // 仅在新 duration 小于当前 trimEnd 时才调整 trimEnd（FIX: 不再无条件重置）
    if ((clip.trimEnd || clip.duration) > newDuration) {
      clip.trimEnd = newDuration;
    }
    EventBus.emit('timeline:changed', Project.tracks);
  });

  document.getElementById('btn-delete-clip').addEventListener('click', () => {
    Project.removeClip(trackId, clip.id);
    Timeline.selectedClipId = null;
    renderProjectInfo();
  });
}
