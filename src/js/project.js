/**
 * smart-clip — 项目数据模型（单一数据源）
 *
 * UI 只负责渲染，数据只在此处修改，避免状态不一致。
 *
 * 事件发布：
 *   media:changed      → 素材列表变更
 *   timeline:changed   → 时间轴片段变更
 *   time:changed       → 当前时间变更
 */
const Project = {
  name: '未命名项目',
  fps: 30,
  media: [],        // 导入的素材 [{id, name, path, type, duration, width, height, size}]
  tracks: [         // 时间轴轨道
    { id: 'video1', type: 'video', name: '视频轨', clips: [] },
    { id: 'audio1', type: 'audio', name: '音频轨', clips: [] }
  ],
  currentTime: 0,
  isPlaying: false,

  /**
   * 添加素材到素材库
   * @param {object} mediaItem - 素材属性
   * @returns {object} 创建的素材对象（含生成的 id）
   */
  addMedia(mediaItem) {
    const item = {
      id: 'media_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      ...mediaItem
    };
    this.media.push(item);
    EventBus.emit('media:changed', this.media);
    return item;
  },

  /**
   * 添加片段到指定轨道
   * @param {string} trackId - 轨道 ID
   * @param {object} clipData - 片段数据
   */
  addClipToTrack(trackId, clipData) {
    const track = this.tracks.find(t => t.id === trackId);
    if (!track) return;
    UndoManager.saveState();
    const clip = {
      id: 'clip_' + Date.now(),
      mediaId: clipData.mediaId,
      name: clipData.name,
      path: clipData.path,
      startTime: clipData.startTime || 0,
      duration: clipData.duration || 5,
      trimStart: clipData.trimStart || 0,
      trimEnd: clipData.trimEnd || clipData.duration || 5
    };
    track.clips.push(clip);
    EventBus.emit('timeline:changed', this.tracks);
  },

  /**
   * 从轨道移除片段
   * @param {string} trackId - 轨道 ID
   * @param {string} clipId - 片段 ID
   */
  removeClip(trackId, clipId) {
    const track = this.tracks.find(t => t.id === trackId);
    if (!track) return;
    UndoManager.saveState();
    track.clips = track.clips.filter(c => c.id !== clipId);
    EventBus.emit('timeline:changed', this.tracks);
  },

  /**
   * 更新当前播放时间
   * @param {number} time - 秒数
   */
  updateCurrentTime(time) {
    this.currentTime = time;
    EventBus.emit('time:changed', time);
  }
};
