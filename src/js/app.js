/**
 * smart-clip — 应用入口
 *
 * 装配所有模块（依赖注入的朴素形式）：
 * 各模块不直接依赖彼此，通过 EventBus 通信，
 * 初始化顺序只影响功能可用性，不影响正确性。
 */

function initApp() {
  Player.init();
  PreviewControls.init();
  Timeline.init();
  Importer.init();
  Exporter.init();
  UndoManager.init();
  ProjectManager.init();

  // ========== 键盘快捷键 ==========
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
        if (Timeline.selectedClipId) {
          for (const track of Project.tracks) {
            const clip = track.clips.find(c => c.id === Timeline.selectedClipId);
            if (clip) {
              Project.removeClip(track.id, Timeline.selectedClipId);
              Timeline.selectedClipId = null;
              document.getElementById('panel-content').innerHTML =
                '<p class="placeholder">选择片段查看属性</p>';
              renderProjectInfo();
              break;
            }
          }
        }
        break;
      case 'KeyS':
        if (!e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          Timeline.splitClipAtPlayhead();
        }
        break;
    }

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

  // ========== 事件监听 ==========
  EventBus.on('media:changed', renderMediaList);
  EventBus.on('clip:selected', renderProperties);

  // ========== 初始渲染 ==========
  renderMediaList([]);
  renderProjectInfo();

  // ========== 左侧标签页切换 ==========
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

  // ========== 帮助菜单（键盘快捷键） ==========
  const helpBtn = document.querySelector('.topbar-menu button:nth-child(3)');
  if (helpBtn) {
    helpBtn.addEventListener('click', () => {
      const shortcuts = [
        ['Space', '播放 / 暂停'],
        ['← →', '逐帧移动'],
        ['S', '在播放头分割片段'],
        ['Delete', '删除选中片段'],
        ['Ctrl+Z', '撤销'],
        ['Ctrl+Y / Ctrl+Shift+Z', '重做'],
        ['Ctrl+S', '保存项目'],
        ['滚轮/拖动', '时间轴缩放/擦洗']
      ];
      const msg = '⌨ 键盘快捷键\n\n' +
        shortcuts.map(([key, desc]) => `  ${key.padEnd(20)}  ${desc}`).join('\n');
      alert(msg);
    });
  }

  setStatus('就绪 — 点击"导入"开始，或拖拽素材到时间轴');
  console.log('智能剪辑 初始化完成');
  console.log('运行环境:', window.isNW ? 'NW.js' : '浏览器(预览模式)');
}

// 启动
document.addEventListener('DOMContentLoaded', initApp);
