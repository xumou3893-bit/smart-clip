/**
 * smart-clip — 工具函数
 * 提供全局共享的纯函数和 Node.js 模块引用
 */

// NW.js 环境下可直接使用 Node.js API
let fs, path, childProcess;
if (window.isNW) {
  fs = require('fs');
  path = require('path');
  childProcess = require('child_process');
}

/**
 * 格式化时间为 "MM:SS.ms" 格式
 * @param {number} seconds - 秒数
 * @returns {string} 格式化后的时间字符串
 */
function formatTime(seconds) {
  const s = seconds || 0;
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return String(m).padStart(2, '0') + ':' + sec.toFixed(2).padStart(5, '0');
}

/**
 * HTML 特殊字符转义（纯字符串替换，无 DOM 操作）
 * @param {string} str - 待转义的字符串
 * @returns {string} 转义后的 HTML 安全字符串
 */
function escapeHTML(str) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(str).replace(/[&<>"']/g, char => map[char]);
}

/**
 * 更新状态栏文本
 * @param {string} msg - 状态消息
 */
function setStatus(msg) {
  document.getElementById('status-text').textContent = msg;
}

/**
 * 生成素材缩略图 URL
 * @param {object} media - 素材对象
 * @returns {string|null} 图片 URL 或 null（需用类型图标）
 */
function generateThumb(media) {
  if (media.type === 'image') {
    if (window.isNW) {
      return 'file:///' + media.path.replace(/\\/g, '/');
    }
    return media.path;
  }
  // 视频/音频暂时显示类型图标，后续用 canvas 截帧
  return null;
}
