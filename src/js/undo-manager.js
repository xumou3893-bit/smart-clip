/**
 * smart-clip — 撤销/重做管理器
 *
 * 全量快照模式：每次变更前 JSON 深拷贝 Project 状态，
 * 撤销/重做时直接恢复。最多保留 50 步。
 */
const UndoManager = {
  undoStack: [],
  redoStack: [],
  maxSteps: 50,
  _locked: false,  // 恢复状态时锁定，防止循环记录

  init() {
    document.getElementById('btn-undo').addEventListener('click', () => this.undo());
    document.getElementById('btn-redo').addEventListener('click', () => this.redo());
  },

  /** 保存当前状态到撤销栈（变更前调用） */
  saveState() {
    if (this._locked) return;
    const snapshot = this._snapshot();
    this.undoStack.push(snapshot);
    if (this.undoStack.length > this.maxSteps) this.undoStack.shift();
    this.redoStack = [];  // 新操作清空重做栈
    this._updateButtons();
  },

  /** 撤销 */
  undo() {
    if (this.undoStack.length === 0) return;
    this.redoStack.push(this._snapshot());
    const state = this.undoStack.pop();
    this._locked = true;
    this._restore(state);
    this._locked = false;
    this._updateButtons();
  },

  /** 重做 */
  redo() {
    if (this.redoStack.length === 0) return;
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
