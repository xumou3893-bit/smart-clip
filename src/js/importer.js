/**
 * smart-clip — 导入模块
 *
 * 通过隐藏的 <input type="file"> 选择文件，
 * 自动识别视频/音频/图片类型，获取元数据后添加到 Project。
 */

const Importer = {
  input: null,

  init() {
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
      const filePath = file.path || file.name;

      // 根据 MIME 类型判断媒体类型
      let type = 'video';
      if (file.type.startsWith('audio/')) type = 'audio';
      else if (file.type.startsWith('image/')) type = 'image';

      // 图片文件直接导入，无需创建临时 video 元素
      if (type === 'image') {
        const media = Project.addMedia({
          name: file.name,
          path: filePath,
          type: 'image',
          duration: 5,
          width: 0, height: 0,
          size: file.size
        });
        EventBus.emit('player:source', media.path, media.type);
        return;
      }

      // 视频/音频：创建临时 video 获取时长和分辨率
      const url = URL.createObjectURL(file);
      const tempVideo = document.createElement('video');
      tempVideo.preload = 'metadata';
      tempVideo.src = url;

      tempVideo.addEventListener('loadedmetadata', () => {
        const media = Project.addMedia({
          name: file.name,
          path: filePath,
          type: type,
          duration: tempVideo.duration || 5,
          width: tempVideo.videoWidth || 0,
          height: tempVideo.videoHeight || 0,
          size: file.size
        });
        EventBus.emit('player:source', media.path, media.type);
        URL.revokeObjectURL(url);
      });

      tempVideo.addEventListener('error', () => {
        Project.addMedia({
          name: file.name,
          path: filePath,
          type: type,
          duration: 5,
          width: 0, height: 0,
          size: file.size
        });
        URL.revokeObjectURL(url);
      });
    });

    this.input.value = '';
  }
};
