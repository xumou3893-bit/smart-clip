/**
 * smart-clip — 项目管理
 *
 * 新建项目、保存/打开 .scproj JSON 格式项目文件。
 */

const ProjectManager = {
  init() {
    document.getElementById('btn-new').addEventListener('click', () => this.newProject());
    document.getElementById('btn-save').addEventListener('click', () => this.saveProject());
    document.getElementById('btn-open').addEventListener('click', () => this.openProject());
  },

  /** 新建项目（清除当前所有内容） */
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

  /** 保存项目到 Desktop */
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

  /** 打开项目文件 */
  openProject() {
    if (!window.isNW) {
      alert('打开功能需要在 NW.js 环境中运行');
      return;
    }
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
