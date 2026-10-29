# X Heat Pulse ⚡ - 帖子热度差分监测插件 (v1.1.0)

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Chrome_Extension-Manifest_V3-green.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Author](https://img.shields.io/badge/Author-MIST--BEN-cyan.svg)](https://github.com/MIST-BEN)

> 面向网络工程师与创作者的 **X (原 Twitter) 帖子热度时序差分检测插件**。  
> **直接在推文旁边实时标出近 5 分钟热度增量 (In-Page Action Bar Badge)**，鼠标悬浮即可查看点赞、转发、浏览量的精准差分变动！

---

## 🌟 核心特性 (v1.1.0 重磅升级)

### 1. 🎯 页面内嵌悬浮标柱 (In-Page Action Bar Overlay)
- 无需频繁点开扩展弹窗！当你打开 [x.com](https://x.com) 浏览自己的主页或信息流时，插件会自动在**每条推文底部的操作工具栏右侧**直接插入实时药丸胶囊微标：
  - `🔥 +48 (5m)`：热度极高爆发（红粉流光）
  - `⚡ +12 (5m)`：稳步快速上升（翡翠绿）
  - `☕ +0 (5m)`：近 5 分钟无波动
  - `⏱️ 采样记录中`：初次捕获，正在建立 5 分钟差分基准
- **鼠标悬停浮窗 (Hover Tooltip)**：悬浮即可查看该推文的详细差分 Breakdown：
  - ❤️ 点赞：`+3`
  - 🔁 转发：`+1`
  - 💬 回复：`+0`
  - 🔖 收藏：`+2`
  - 👁️ 浏览曝光：`+180`
  - 🕒 采样基准时间点

### 2. 🛡️ 100% 真实准确实时采样 (DOM Native Extraction)
- 放弃传统不稳定且易受频控拦截的旧版 REST API，直接通过 `content_script` 实时读取页面渲染的真实计数。
- 支持各种国际化计数格式：`1.2K`、`3.5万`、`1.5M`、`2.1亿` 及千分位逗号。
- 本地维护每条推文的时序快照环形队列（Snapshots Ring Buffer），跨时间段精确比对 $T - 5\text{min}$。

### 3. 📈 综合热度差分加权模型
$$\Delta \text{Heat} = 2.0 \cdot \Delta \text{Likes} + 5.0 \cdot \Delta \text{Retweets} + 3.0 \cdot \Delta \text{Replies} + 4.0 \cdot \Delta \text{Bookmarks} + 0.01 \cdot \Delta \text{Views}$$

### 4. 📊 弹出看板与全局徽章
- 点击工具栏图标弹出赛博朋克极简仪表盘，汇总所有监控推文的总吞吐增量与趋势微图表（Sparkline）。
- 扩展图标右上角徽章（Badge）实时提示当前账号的总 5 分钟热度增量。

---

## 🚀 安装与使用

1. 打开浏览器扩展管理页 `chrome://extensions/`。
2. 开启右上角 **「开发者模式」(Developer Mode)**。
3. 点击 **「加载已解压的扩展程序」(Load unpacked)**，选择本项目文件夹：
   ```text
   C:\Users\Administrator\.gemini\antigravity\scratch\x-heat-monitor
   ```
4. 打开 [x.com](https://x.com) 网页，进入你的个人主页（Profile）或任意推文页面。
5. **在推文的操作按钮旁（转推、点赞右侧）会直接显示胶囊标签**，记录与展现 5 分钟热度差分！

---

## 🛠️ 项目目录结构

```text
x-heat-monitor/
├── manifest.json       # Chrome Extension Manifest V3 配置 (含 content_scripts)
├── content_script.js   # 页面直接捕获与推文工具栏注入引擎
├── content_style.css   # 推文原生样式药丸微标与悬浮窗 CSS
├── background.js       # 后台 Service Worker（调度、全局告警、差分聚合）
├── popup.html          # 监控面板 UI
├── popup.js            # 看板渲染与 Sparkline 绘制逻辑
├── options.html        # 权重模型与告警阈值配置页面
├── options.js          # 配置项持久化处理
├── icons/              # 插件图标资源 (16px, 48px, 128px)
├── README.md           # 项目说明文档
└── LICENSE             # MIT 开源协议
```

---

## 👤 作者

- GitHub: [@MIST-BEN](https://github.com/MIST-BEN)
