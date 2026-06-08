# ✂ 智能剪辑 (Smart Clip)

**CapCut（剪映）风格的桌面视频编辑器**，基于 NW.js 构建，纯原生前端技术栈。

![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)
![NW.js](https://img.shields.io/badge/NW.js-v0.95.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## ✨ 功能特性

- 🎬 **多格式导入** — 视频、音频、图片，支持多选
- 🎞 **时间轴编辑** — 拖拽移动、裁剪手柄、分割片段、吸附对齐
- 👁 **实时预览** — 视频 + 图片双模式，适应/填充画面切换
- ↩ **撤销/重做** — 全量快照，最多 50 步
- 🎹 **键盘快捷键** — Space 播放/暂停，←→ 逐帧，S 分割，Ctrl+Z/Y 撤销/重做
- 📤 **FFmpeg 导出** — concat 模式，进度条 + ETA 估算
- 💾 **项目持久化** — 保存/打开 `.scproj` JSON 格式
- 🎨 **剪映风格 UI** — 深灰主题，三栏布局

## 🚀 快速开始

### 环境要求

- [Node.js](https://nodejs.org/) (推荐 v18+)
- [FFmpeg](https://ffmpeg.org/download.html) (需在系统 PATH 中可用)

### 安装与运行

```bash
# 安装依赖
npm install

# 启动桌面应用
npm start

# 开发模式（带远程调试端口）
npm run dev

# 浏览器预览模式（部分功能受限）
npx http-server .
```

## 🏗 技术栈

| 层 | 技术 |
|---|---|
| 运行时 | NW.js v0.95.0（Chromium + Node.js） |
| 语言 | 原生 JavaScript（ES2020+），无 TypeScript，无框架 |
| 样式 | 原生 CSS，CSS 自定义属性主题系统 |
| 视频处理 | FFmpeg（concat demuxer 导出） |
| 包管理 | npm |

## 📁 项目结构

```
智能剪辑项目/
├── package.json          # NW.js 配置 + npm scripts
├── index.html            # 完整 DOM 结构
├── src/
│   ├── styles/
│   │   └── main.css      # 全部样式
│   └── js/
│       └── app.js        # 全部应用逻辑
└── node_modules/
```

## 🏛 架构

- **EventBus 发布-订阅** — 所有模块通过事件中心通信，无直接依赖
- **Project 单一数据源** — UI 只负责渲染，数据只在一处修改
- **GPU 加速播放头** — `transform: translateX()` + `will-change` + rAF 批量更新
- **全量快照撤销** — 每次变更前 JSON 深拷贝 Project 状态

## ⌨ 快捷键

| 快捷键 | 功能 |
|---|---|
| `Space` | 播放 / 暂停 |
| `←` `→` | 逐帧移动 |
| `S` | 在播放头位置分割片段 |
| `Delete` | 删除选中片段 |
| `Ctrl+Z` | 撤销 |
| `Ctrl+Y` / `Ctrl+Shift+Z` | 重做 |
| `Ctrl+S` | 保存项目 |

## 📄 许可

MIT License
