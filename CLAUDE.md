# 智能剪辑 (Smart Clip) — 项目概览

## 项目简介

CapCut（剪映）风格的桌面视频编辑器，基于 **NW.js v0.95.0** 构建。纯原生前端技术栈（HTML + CSS + 原生 JS），无需构建工具，NW.js 允许页面直接 `require` Node.js 模块，无 preload/IPC 层。

## 技术栈

| 层 | 技术 |
|---|---|
| 运行时 | NW.js v0.95.0（Chromium + Node.js） |
| 语言 | 原生 JavaScript（ES2020+），无 TypeScript，无框架 |
| 样式 | 原生 CSS，CSS 自定义属性（变量）主题系统 |
| 视频处理 | FFmpeg（concat demuxer 导出） |
| 包管理 | npm（仅安装 nw 依赖） |

## 项目结构

```
智能剪辑项目/
├── package.json          # NW.js 配置 + npm scripts
├── index.html            # 完整 DOM 结构（175行）
├── CLAUDE.md             # 本文件
├── .gitignore
├── src/
│   ├── styles/
│   │   └── main.css      # 全部样式（~980行）
│   └── js/
│       └── app.js        # 全部应用逻辑（~1853行）
└── node_modules/
    └── nw/               # NW.js 二进制
```

## 架构

### 核心模式：发布-订阅（EventBus）

所有模块通过 `EventBus` 通信，不直接依赖彼此：

```js
EventBus.on('event:name', callback)   // 订阅
EventBus.emit('event:name', ...args)  // 发布
EventBus.off('event:name', callback)  // 取消订阅
```

### 数据模型：Project（单一数据源）

```js
Project = {
  name: '未命名项目',
  fps: 30,
  media: [],            // [{id, name, path, type, duration, width, height, size}]
  tracks: [             // type: 'video' | 'audio'
    { id: 'video1', type: 'video', name: '视频轨', clips: [...] },
    { id: 'audio1', type: 'audio', name: '音频轨', clips: [...] }
  ],
  currentTime: 0,
  isPlaying: false
}
```

Clip 结构：`{id, mediaId, name, path, startTime, duration, trimStart, trimEnd}`

### 模块列表（均在 app.js 中，全局变量）

| 模块 | 行数 | 职责 |
|---|---|---|
| `EventBus` | 26-38 | 发布-订阅事件中心 |
| `Project` | 47-98 | 数据模型：addMedia/addClipToTrack/removeClip/updateCurrentTime |
| `Player` | 107-203 | 封装 `<video>` + `<img>`，支持视频/图片预览切换 |
| `PreviewControls` | 208-290 | 播放器底部控件（播放/暂停、进度条拖拽、时间显示、适应/填充切换） |
| `Timeline` | 307-1046 | **最核心模块**：轨道渲染、片段拖拽、裁剪手柄、播放头、标尺擦洗、分割、吸附、右键菜单 |
| `UndoManager` | 1052-1128 | 全量快照撤销/重做（JSON 深拷贝，最多50步） |
| `Importer` | 1138-1206 | 隐藏文件输入，支持视频/音频/图片，自动生成缩略图，导入后自动预览 |
| `Exporter` | 1211-1345 | FFmpeg concat 导出，进度条 + ETA 估算，取消按钮 |
| `ProjectManager` | 1350-1446 | 新建/保存(.scproj JSON)/打开项目 |
| `initApp()` | 1751-1849 | 装配入口：依次 init 各模块 + 键盘快捷键 + 标签页切换 |
| `renderMediaList()` | ~1507 | 素材网格渲染（缩略图 + 拖拽 + 右键菜单） |
| `renderProperties()` | ~1395 | 右侧属性面板（可编辑名称/起始/时长 + 删除按钮） |
| `renderProjectInfo()` | ~1345 | 项目概览面板 |
| `autoAddToTimeline()` | ~1452 | 手动将素材添加到时间轴（右键菜单调用，非自动） |
| `formatTime()` | ~300 | 全局时间格式化 "MM:SS.ms" |
| `escapeHTML()` | ~1737 | HTML 转义辅助 |
| `setStatus()` | ~1489 | 状态栏更新辅助 |

### 事件总线清单

| 事件名 | 触发者 | 监听者 |
|---|---|---|
| `media:changed` | Project.addMedia | renderMediaList, initApp |
| `timeline:changed` | Project.addClipToTrack/removeClip, Timeline drag end | Timeline.render |
| `time:changed` | Project.updateCurrentTime | Timeline.updatePlayhead/updateTimeLabel, 时间显示 |
| `playback:changed(bool)` | Player video events | PreviewControls（按钮图标） |
| `player:seek(time)` | Timeline click, PreviewControls | Player.seek |
| `player:source(path, type)` | Timeline.selectClip, Importer, renderMediaList | Player.loadSource |
| `player:duration(sec)` | Player loadedmetadata | PreviewControls |
| `clip:selected(clip, trackId)` | Timeline.selectClip | renderProperties, initApp |

## 关键 DOM ID（JS 依赖）

### 顶层按钮
- `#btn-new` / `#btn-open` / `#btn-save` / `#btn-undo` / `#btn-redo` / `#btn-export`
- `#btn-import`（左侧素材面板内）

### 预览区
- `#preview-player`（`<video>`）
- `#preview-image`（`<img>`）
- `#preview-placeholder`
- `#btn-play` / `#ctrl-current-time` / `#ctrl-total-time` / `#ctrl-progress-bar` / `#ctrl-progress-fill` / `#ctrl-progress-thumb`
- `#btn-fit-mode` / `#player-controls`

### 时间轴
- `#timeline-tracks`（轨道容器）
- `#time-ruler`（时间标尺）
- `#btn-zoom-in` / `#btn-zoom-out` / `#zoom-slider` / `#zoom-label`
- `#btn-split-tool` / `#timeline-time-display`

### 面板
- `#left-panel` / `#media-list` / `#audio-list`
- `#right-panel` / `#panel-content` / `#btn-delete-clip`

### 其他
- `#export-modal` / `#export-progress-fill` / `#export-progress-text` / `#export-time-estimate` / `#btn-cancel-export`
- `#statusbar` / `#status-text` / `#status-info`
- `.project-name`（顶部项目名称）
- `.left-tab` / `.left-panel-content`（左侧标签页）

## CSS 主题（main.css CSS 变量）

```css
--bg-primary: #121212;     --bg-secondary: #1e1e1e;   --bg-tertiary: #2a2a2a;
--text-primary: #e8e8e8;   --text-secondary: #b0b0b0;  --text-muted: #707070;
--accent: #00c8ff;         --accent-hover: #33d4ff;     --danger: #ff4d4f;
--success: #52c41a;        --border: #3a3a3a;           --clip-video: #00c8ff;
--clip-audio: #7c5ce0;     --clip-image: #ff6b35;
```

## 运行方式

```bash
npm start          # NW.js 桌面应用
npm run dev        # 带远程调试端口 --remote-debugging-port=9222
npx http-server .  # 浏览器预览模式（部分功能受限）
```

浏览器中需通过 HTTP 服务器访问（`file://` 协议会阻止 Node.js API 调用）。

## 已完成功能清单

- [x] 素材导入（视频/音频/图片，支持多选）
- [x] 素材库网格显示 + 缩略图 + 类型图标
- [x] 素材拖入时间轴轨道（类型匹配限制：视频/图片→视频轨，音频→音频轨）
- [x] 时间轴片段渲染（位置 × duration 对应宽度）
- [x] 片段选中（单击高亮 + 自动预览 + 属性面板）
- [x] 片段拖拽移动（自定义 mousedown/mousemove/mouseup，支持吸附）
- [x] 片段裁剪手柄（左右拖拽 trim，含撤销支持）
- [x] 片段右键菜单（分割/删除/复制/属性）
- [x] 播放头擦洗（标尺点击/拖拽，GPU 加速，rAF 批量）
- [x] 播放头分割（播放头在片段内按 S 键） + 工具栏分割按钮
- [x] 吸附切换（工具栏按钮，含状态指示）
- [x] 时间轴缩放（+/- 按钮 + range 滑块，20-200 px/s）
- [x] 标尺刻度渲染（自适应缩放级别的小/大刻度）
- [x] 标尺-轨道双向滚动同步
- [x] 预览播放器（播放/暂停、进度条拖拽、时间显示）
- [x] 视频+图片双模式预览（自动检测文件扩展名切换 `<video>` / `<img>`）
- [x] 适应/填充画面切换
- [x] 撤销/重做（全量快照，最多50步，Ctrl+Z/Y + 按钮）
- [x] 键盘快捷键（Space 播放/暂停，←→ 逐帧，Delete 删除片段，S 分割，Ctrl+Z/Y/S）
- [x] 导出（FFmpeg concat，进度 + ETA）
- [x] 保存/打开项目（.scproj JSON 格式）
- [x] 新建项目（确认对话框）
- [x] 左侧6标签页切换（媒体/音频/文本/特效/转场/滤镜）
- [x] 右侧属性面板（选中片段时显示可编辑字段 + 删除按钮）
- [x] 项目概览面板（未选中时显示项目信息）
- [x] 底部状态栏（状态文本 + 项目信息）
- [x] CapCut 剪映风格深灰 UI 主题

## 待开发/未完成

- [ ] 音频轨的独立波形渲染（目前仅显示色块）
- [ ] Canvas 视频帧缩略图（目前视频用类型图标，图片用原图）
- [ ] 文本/特效/转场/滤镜标签页的实际功能
- [ ] 多轨道支持（目前仅固定 1 视频轨 + 1 音频轨）
- [ ] 轨道锁定/隐藏按钮功能
- [ ] 文件菜单和编辑菜单的下拉菜单
- [ ] 拖拽文件到窗口导入
- [ ] 使用系统文件对话框选择保存路径（目前写死桌面）
- [ ] 播放时播放头同步滚动（目前播放时播放头更新但不会自动触发渲染循环）
- [ ] 视频导出时包含音频轨
- [ ] 音频预览播放
- [ ] 片段交叉淡化/转场
- [ ] 导出格式选项（目前仅 mp4 copy）

## 已知注意事项

- `index.html` 第170-171行有 NW.js 环境检测：`window.isNW` 在 NW.js 中为 true
- 浏览器预览模式下，文件保存/打开/导出功能不可用（需要 Node.js API）
- FFmpeg 需要在系统 PATH 中可用
- 播放头 tooltip 使用 `left` 定位（保留 `translateX(-50%)` 居中），line/diamond 用 `transform` 定位（GPU 加速）
- Timeline `render()` 先清空 `container.innerHTML`，再调用 `renderRuler()`（在 ruler 中重新创建播放头元素）
- 拖拽监听绑定在 `document` 上（`_dragMoveBound`），确保鼠标移出轨道区域仍能跟踪
- 素材导入后不自动添加到时间轴（用户明确要求）
- `autoAddToTimeline()` 函数保留但仅通过右键菜单手动调用

## Git 状态

- 仓库已推送至 GitHub: https://github.com/xumou3893-bit/smart-clip
- 默认分支: `main`
