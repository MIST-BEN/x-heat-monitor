# X Heat Pulse ⚡ - 帖子热度差分监测插件

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Manifest V3](https://img.shields.io/badge/Chrome_Extension-Manifest_V3-green.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Author](https://img.shields.io/badge/Author-MIST--BEN-cyan.svg)](https://github.com/MIST-BEN)

> 面向网络工程师、算法创作者与社交媒体运营的 **X (原 Twitter) 帖子热度时序差分检测插件**。  
> 默认以 **5 分钟** 为周期定时采样，精准计算与上一次检测的热度增量（一阶差分 $\Delta \text{Heat}$），实时捕捉推文进入算法推荐池的爆发脉冲。

---

## 📌 核心功能

- ⏱️ **高精度 5 分钟差分引擎**：采用 Chrome Alarms 定时唤醒，杜绝长时间后台休眠遗漏；自动计算 $\text{Metric}(t) - \text{Metric}(t - 5\text{min})$。
- 📈 **综合热度加权模型**：根据点赞、转发、回复、书签、浏览量等多维度指标动态计算综合热度积分。
- 🛡️ **单调性与网络抖动抑制 (Monotonic Guard)**：自动过滤分布式数据库最终一致性导致的计数微小回退与抖动。
- 🔔 **流量脉冲突发告警**：当 5 分钟热度增量超过设定阈值（默认 50 pts）时，自动触发系统级桌面通知。
- 📊 **赛博朋克极简看板**：内置 Sparkline 实时趋势微图表、近 24 小时 288 个采样点环形缓冲区、Top 活跃帖子排行。
- 🔑 **双重数据源模式**：
  - **自动免密模式**：自动复用浏览器已登录的 X.com 会话 Cookie (`auth_token` + `ct0`)，零 API 费用，即装即用。
  - **官方 API 模式**：支持输入官方 X API v2 Bearer Token 进行企业级数据采集。
  - **离线模拟模式**：未登录时自动开启仿真演示数据流，方便开发调试。

---

## 📐 热度差分数学模型

不同于传统的“累计总数”展示，本插件专注于**时序吞吐增量（Throughput Velocity）**：

$$\Delta \text{Heat} = w_l \cdot \Delta \text{Likes} + w_r \cdot \Delta \text{Retweets} + w_c \cdot \Delta \text{Replies} + w_b \cdot \Delta \text{Bookmarks} + w_v \cdot \Delta \text{Views}$$

### 默认权重矩阵：
| 互动类型 | 权重 ($w_i$) | 物理意义 |
| :--- | :--- | :--- |
| **转推 (Retweets)** | `5.0` | 极高权重：强社交扩散与二次流转 |
| **书签 (Bookmarks)** | `4.0` | 高权重：深度高价值沉淀 |
| **回复 (Replies)** | `3.0` | 中高权重：高参与度互动 |
| **点赞 (Likes)** | `2.0` | 基础认可互动 |
| **展现 (Views)** | `0.01` | 流量底座展现基数 |

*(以上权重可在插件“参数配置”页面随时自定义调整)*

---

## 🚀 安装与使用指南

### 1. 安装插件
1. 将本仓库克隆或下载到本地：
   ```bash
   git clone https://github.com/MIST-BEN/x-heat-monitor.git
   ```
2. 打开基于 Chromium 的浏览器（Google Chrome / Microsoft Edge / Brave）。
3. 在地址栏输入 `chrome://extensions/` 并按回车。
4. 在页面右上角开启 **「开发者模式」(Developer Mode)**。
5. 点击左上角的 **「加载已解压的扩展程序」(Load unpacked)**，选择本项目根目录。
6. 在浏览器右上角扩展栏点击图钉 📌，将 **X Heat Pulse** 固定到工具栏。

### 2. 使用方法
1. 确保浏览器中已登录 [x.com](https://x.com) 账号。
2. 插件会自动在后台以 5 分钟为周期开始采样并计算差分。
3. 扩展图标右上角的徽章（Badge）会直接实时显示最近 5 分钟的净增量（如 `+42`）。
4. 点击插件图标可展开详细仪表盘，查看各指标明细与时序折线图。

---

## 🛠️ 项目目录结构

```text
x-heat-monitor/
├── manifest.json       # Chrome Extension Manifest V3 核心配置
├── background.js       # 后台 Service Worker（调度、网络层、差分计算引擎）
├── popup.html          # 监控面板 UI
├── popup.js            # 看板渲染与 Sparkline 绘制逻辑
├── options.html        # 权重模型与告警阈值配置页面
├── options.js          # 配置项持久化处理
├── icons/              # 插件图标资源 (16px, 48px, 128px)
├── README.md           # 项目中英文文档说明
└── LICENSE             # MIT 开源协议
```

---

## 🔒 隐私与安全声明

- 本插件为 **100% 本地纯客户端架构**，所有采集与计算均在用户的本地浏览器内完成。
- 不会向任何第三方服务器上传您的任何推特数据或身份凭证。
- 代码完全开源透明，遵循 MIT 协议。

---

## 👤 作者

- GitHub: [@MIST-BEN](https://github.com/MIST-BEN)
