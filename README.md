# X Heat Pulse ⚡ - 帖子热度时序差分与推流监测器 (v1.5.0)

<p align="center">
  <img src="icons/icon128.png" width="96" height="96" alt="X Heat Pulse Logo" style="border-radius: 20px; box-shadow: 0 8px 24px rgba(56, 189, 248, 0.35);">
</p>

<p align="center">
  <b>面向创作者与推特深度用户的 X (Twitter) 帖子热度脉冲与推流监测插件</b><br>
  推文旁直接悬浮极简微标，实时计算 <b>当前总浏览</b>、<b>时增均速 (浏览量/发布时间)</b> 与 <b>短周期新增脉冲</b>，精准捕捉算法推流时机！
</p>

<p align="center">
  <a href="#-1-分钟极速安装教程给朋友们"><img src="https://img.shields.io/badge/安装教程-1分钟极速上手-brightgreen.svg?style=flat-square" alt="安装教程"></a>
  <a href="https://developer.chrome.com/docs/extensions/mv3/intro/"><img src="https://img.shields.io/badge/Chrome_Extension-Manifest_V3-blue.svg?style=flat-square" alt="Manifest V3"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-purple.svg?style=flat-square" alt="MIT License"></a>
  <a href="https://github.com/MIST-BEN/x-heat-monitor"><img src="https://img.shields.io/badge/Author-MIST--BEN-cyan.svg?style=flat-square" alt="Author MIST-BEN"></a>
</p>

---

## ✨ 核心特性 (v1.5.0)

- 🚀 **时增均速监测 (浏览量 ÷ 发布时间)**：
  - 自动读取推文精准发布时间戳，实时换算为 **每小时均增流速 (Views / Hour)**。
  - 推文刚发布时即刻生成时速，不再需要苦等整整 1 小时：
    - `☕ 91 阅 · 45/h | 3m +0`：平稳推流期。
    - `⚡ 320 阅 · 160/h | 3m +18`：流量正在起飞加速。
    - `🔥 1500 阅 · 750/h | 3m +80`：**爆款推流中！** 提醒博主迅速叫人助力转推！
- 🎯 **推文内嵌极简纯净微标 (Action Bar Badge)**：
  - 挂载在推文操作栏右侧，绝不堆砌冗余点赞/转推文字，只突出核心曝光与时速。
  - **总览 + 时速 + 增量三合一**，一眼看出帖子是在爆发还是沉寂。
- 📊 **五列时序悬浮看板 (Hover Tooltip Table)**：
  - 悬停药丸展开 OLED 暗黑磨砂数据对比面板：
    - 顶部高亮显示：**推流态势** (`🔥 爆款推流中` / `⚡ 正在加速推流` / `☕ 平稳推流`) 与时均增速。
    - 表格五列对比：`互动指标` | `近 3 分增量` | `监控累计增量` | `时均增速 (/h)` | `当前总量`。
    - 底部清晰标注帖子发布时长与首次基准捕获时间。
- 🛡️ **单调防骨架屏清零守卫 (Monotonic Hydration Guard)**：
  - 彻底拦截 Twitter/X 网页刷新 (F5) 时 React 骨架屏异步加载引起的瞬时 0 值干扰，真实数据永久留存。
- 👤 **创作者专属账号识别 & 右上角角标**：
  - 自动识别博主当前账号（支持内置预绑与 1 秒无感切换）。
  - 右上角角标在平稳期展示博主总浏览量，推流起爆时以鲜亮颜色展示增量。
- 💾 **首次基准永久锁定 & 视频控件隔离**：
  - 本地安全存储（`unlimitedStorage`），无论关机重启，时序增量持续有效。
  - 严格隔离媒体播放器按钮组，确保徽章永远稳定吸附于推文底栏。

---

## 🎁 1 分钟极速安装教程（给朋友们）

只需简单 3 步，**无需安装任何编程环境**，Chrome、Edge、Brave 等主流 Chromium 浏览器均可使用：

1. **下载代码包**：
   - 点击本仓库右上角的 **「Code」** 按钮，选择 **「Download ZIP」**（下载压缩包）。
   - 下载后解压到电脑任意文件夹（比如解压到桌面或文档）。
2. **打开浏览器扩展管理**：
   - 在浏览器地址栏输入 `chrome://extensions/` 并回车。
   - 打开页面右上角的 **「开发者模式」(Developer Mode)** 开关。
3. **加载插件**：
   - 点击左上角的 **「加载已解压的扩展程序」(Load unpacked)**。
   - 选中刚才解压出来的文件夹，点击“选择文件夹”。
   - 🎉 **安装完成！** 打开或按 `F5` 刷新 [x.com](https://x.com)，在帖子右下角工具栏旁即可看到专属实时增量徽章！

---

## 🖥️ 视觉与交互示意

### 1. 帖子旁极简药丸微标（Action Bar Badge）
```text
[ 💬 1 ]    [ 🔁 0 ]    [ ❤️ 2 ]    [ 📊 91 ]    [ 🔖 ]    [ 📤 ]   [ ⚡ 3m +18 | 累计 +18 ]
                                                                             │
                                                              (鼠标悬停展开四列表格 ↓)
```

### 2. 悬浮数据对比卡片（Hover Tooltip）
```text
┌────────────────────────────────────────────────────────┐
│ 📊 X 帖子热度时序追踪 [我的专属帖子]   持续追踪 35 分钟 │
├─────────────┬─────────────┬─────────────┬──────────────┤
│  互动指标   │  近3分钟    │  首次至今   │   当前总量   │
├─────────────┼─────────────┼─────────────┼──────────────┤
│ 👁️ 曝光浏览 │    +18      │    +18      │     97       │
│ ❤️ 获得点赞 │    +0       │    +2       │      2       │
│ 🔁 转发推文 │    +0       │    +0       │      0       │
│ 💬 参与回复 │    +0       │    +1       │      1       │
│ 🔖 书签收藏 │    +0       │    +0       │      0       │
├─────────────┴─────────────┴─────────────┴──────────────┤
│ 首次捕获: 18:30                [ 🔄 重设此帖基准 ]      │
└────────────────────────────────────────────────────────┘
```

---

## 🔒 隐私与安全性

- **100% 本地纯前端处理**：插件仅在你的本地浏览器运行，绝不会向任何第三方服务器上传你的推特 Cookie、账号或推文数据。
- **免 API 费用**：直接读取网页当前显示的数值，无需花高价申请 X 开发者 API。

---

## 👤 作者与支持

- 项目地址: [https://github.com/MIST-BEN/x-heat-monitor](https://github.com/MIST-BEN/x-heat-monitor)
- 欢迎提交 Issue 或 Star 🌟 支持！
