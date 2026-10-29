# X Heat Pulse ⚡ - 帖子热度时序差分检测器 (v1.3.0)

<p align="center">
  <img src="icons/icon128.png" width="96" height="96" alt="X Heat Pulse Logo" style="border-radius: 20px; box-shadow: 0 8px 24px rgba(56, 189, 248, 0.35);">
</p>

<p align="center">
  <b>面向创作者与推特深度用户的 X (Twitter) 帖子热度脉冲与时序差分监测插件</b><br>
  无需点开弹窗，直接在推文旁挂载原生微标，实时计算 <b>3 分钟增量</b> 与 <b>自看到起的累计总增量</b>！
</p>

<p align="center">
  <a href="#-1-分钟极速安装教程给朋友们"><img src="https://img.shields.io/badge/安装教程-1分钟极速上手-brightgreen.svg?style=flat-square" alt="安装教程"></a>
  <a href="https://developer.chrome.com/docs/extensions/mv3/intro/"><img src="https://img.shields.io/badge/Chrome_Extension-Manifest_V3-blue.svg?style=flat-square" alt="Manifest V3"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-purple.svg?style=flat-square" alt="MIT License"></a>
  <a href="https://github.com/MIST-BEN"><img src="https://img.shields.io/badge/Author-MIST--BEN-cyan.svg?style=flat-square" alt="Author MIST-BEN"></a>
</p>

---

## ✨ 核心特性

- 🎯 **推文内嵌药丸徽章 (In-Page Action Bar Badge)**：
  - 自动挂载在每条帖子右下角工具栏旁（点赞、转发按钮右侧）。
  - **双重增量直观呈现**：
    - `⚡ 3m: +18阅 | 总: +18阅`：3 分钟曝光增长与自你初次刷到该帖子的全部累计增量。
    - `🔥 3m: +2赞 +30阅 | 总: +5赞 +120阅`：出现爆款流量时自动高亮。
    - `☕ 3m: 0 | 总: +18阅`：近 3 分钟数据平缓，但总浏览已有稳定沉淀。
- 📊 **悬浮四列表格 & 智能防遮挡翻折**：
  - 鼠标悬停（Hover）在药丸上，展开磨砂玻璃时序数据对比卡片：
    - `近 3 分钟增量` vs `首次看到至今总增量` vs `当前实际总量`
  - **智能翻折**：推文位于屏幕顶部时，弹窗自动向下展开，杜绝内容被浏览器边缘裁切。
- 💾 **首次基准永久锁定 (Lifetime Baseline Retention)**：
  - 本地安全存储（`unlimitedStorage`），无论关机、重启浏览器或几天后再看，初次看到该帖的数据基准永不丢失。
  - 支持在悬浮窗中点击 **`[ 🔄 重设此帖基准 ]`** 随时将当前数据重新设为起算起点。
- 🔍 **DOM 原生完整数字提取**：
  - 即使页面上的大数字显示为缩写（如 `1.2K`、`3.5万`），插件会自动深入解析 HTML 的 `title` 与 `aria-label` 属性，恢复真实个位数精度。

---

## 🎁 1 分钟极速安装教程（给朋友们）

只需简单 3 步，**无需安装任何编程软件**，Chrome、Edge、Brave、360极速浏览器等均可使用：

1. **下载代码包**：
   - 点击本页面右上角绿色的 **「Code」** 按钮，选择 **「Download ZIP」**（下载压缩包）。
   - 下载后解压到电脑任意文件夹（比如解压到桌面或文档目录）。
2. **打开浏览器扩展管理**：
   - 打开 Chrome 或 Edge 浏览器，在地址栏输入 `chrome://extensions/` 并回车。
   - 打开页面右上角的 **「开发者模式」(Developer Mode)** 开关。
3. **加载插件**：
   - 点击左上角的 **「加载已解压的扩展程序」(Load unpacked)**。
   - 选中刚才解压出来的文件夹，点击“选择文件夹”。
   - 🎉 **安装完成！** 打开或刷新 [x.com](https://x.com) 浏览推文，你的推文旁就会直接出现精致的热度增量微标！

---

## 🖥️ 视觉与交互示意

### 1. 帖子旁药丸微标（Action Bar Badge）
```text
[ 💬 1 ]    [ 🔁 0 ]    [ ❤️ 2 ]    [ 🔖 0 ]    [ 📤 ]   [ ⚡ 3m: +18阅 | 总: +18阅 ]
                                                                      │
                                                       (鼠标悬停展开四列表格 ↓)
```

### 2. 悬浮数据对比卡片（Hover Tooltip）
```text
┌────────────────────────────────────────────────────────┐
│ 📊 X 帖子热度时序追踪             已持续追踪 35 分钟    │
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
