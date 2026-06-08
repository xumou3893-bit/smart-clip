/**
 * smart-clip — 事件中心（发布-订阅模式）
 *
 * 所有模块通过 EventBus 通信，不直接依赖彼此：
 *   EventBus.on('event:name', callback)   // 订阅
 *   EventBus.emit('event:name', ...args)  // 发布
 *   EventBus.off('event:name', callback)  // 取消订阅
 */
const EventBus = {
  _events: {},

  /** 订阅事件 */
  on(event, fn) {
    (this._events[event] ||= []).push(fn);
  },

  /** 取消订阅 */
  off(event, fn) {
    const list = this._events[event];
    if (list) this._events[event] = list.filter(f => f !== fn);
  },

  /** 发布事件 */
  emit(event, ...args) {
    (this._events[event] || []).forEach(fn => fn(...args));
  }
};
