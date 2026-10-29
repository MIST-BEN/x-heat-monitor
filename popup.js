/**
 * X Heat Pulse - Popup Logic & Visualization (v1.4.0)
 * Aggregates real in-page recorded tweet data from x.com
 * Supports strictly filtering and monitoring the user's OWN tweets.
 */

let currentTab = "own"; // 'own' (default) or 'all'

document.addEventListener("DOMContentLoaded", () => {
  renderData();

  // Scope Tab Clicks
  const tabOwn = document.getElementById("tab-own");
  const tabAll = document.getElementById("tab-all");

  if (tabOwn && tabAll) {
    tabOwn.addEventListener("click", () => {
      currentTab = "own";
      tabOwn.classList.add("active");
      tabAll.classList.remove("active");
      document.getElementById("posts-list-title").textContent = "我的专属帖子";
      renderData();
    });

    tabAll.addEventListener("click", () => {
      currentTab = "all";
      tabAll.classList.add("active");
      tabOwn.classList.remove("active");
      document.getElementById("posts-list-title").textContent = "发现信息流推文";
      renderData();
    });
  }

  // Refresh button click
  const refreshBtn = document.getElementById("btn-refresh");
  const refreshIcon = document.getElementById("icon-refresh");

  refreshBtn.addEventListener("click", () => {
    refreshIcon.classList.add("spinning");
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "RESCAN" }, () => {});
      }
    });

    setTimeout(() => {
      refreshIcon.classList.remove("spinning");
      renderData();
    }, 400);
  });

  // Settings button click
  const settingsBtn = document.getElementById("btn-settings");
  const optionsLink = document.getElementById("link-options");

  const openSettings = () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL("options.html"));
    }
  };

  settingsBtn.addEventListener("click", openSettings);
  optionsLink.addEventListener("click", openSettings);
});

async function renderData() {
  const storage = await chrome.storage.local.get([
    "config",
    "tweet_records",
    "my_user_handle"
  ]);

  const tweetRecords = storage.tweet_records || {};
  const config = storage.config || { intervalMinutes: 3 };
  const intervalM = config.intervalMinutes || 3;
  const myHandle = (storage.my_user_handle || config.myHandle || "").trim();
  const tweetList = Object.values(tweetRecords);

  document.getElementById("d-interval").textContent = `${intervalM}m`;
  const titleEl = document.getElementById("label-delta-title");
  if (titleEl) {
    titleEl.textContent = currentTab === "own"
      ? `我的帖子近${intervalM}分增量`
      : `信息流近${intervalM}分增量`;
  }
  const unitEl = document.getElementById("label-delta-unit");
  if (unitEl) unitEl.textContent = `次曝光/${intervalM}m`;

  // Always display user's own handle on the top-right of hero card
  if (myHandle) {
    document.getElementById("account-name").textContent = `@${myHandle}`;
  } else {
    document.getElementById("account-name").textContent = "@我的账号";
  }

  // 1. Separate own tweets from external feed tweets
  const ownTweets = [];
  const otherTweets = [];

  for (const tweet of tweetList) {
    const isOwn = tweet.isOwnTweet || (myHandle && tweet.author && tweet.author.toLowerCase() === myHandle.toLowerCase());
    if (isOwn) {
      ownTweets.push(tweet);
    } else {
      otherTweets.push(tweet);
    }
  }

  // Choose display list based on active tab
  const targetList = currentTab === "own" ? ownTweets : tweetList;

  // If no tweets at all
  if (tweetList.length === 0) {
    document.getElementById("status-tag").textContent = "等待页面数据";
    document.getElementById("status-tag").className = "tag";
    document.getElementById("delta-heat").textContent = "+0";
    document.getElementById("delta-rate").textContent = "未检测到推文";
    document.getElementById("monitored-count").textContent = "监控中: 0";
    document.getElementById("posts-container").innerHTML = `
      <div style="color:#94a3b8; font-size:11px; text-align:center; padding: 22px 10px; line-height:1.6;">
        ⚡ <b>实时监控就绪</b><br>
        请在浏览器中打开 <a href="https://x.com" target="_blank" style="color:#38bdf8;">x.com</a> 并浏览你的主页，插件将自动在推文旁标出 ${intervalM} 分钟增量与累计总增量！
      </div>
    `;
    document.getElementById("last-update").textContent = "打开 x.com 即可实时标记";
    return;
  }

  // If user selected "我的帖子" but has not browsed their own profile yet
  if (currentTab === "own" && ownTweets.length === 0) {
    document.getElementById("status-tag").textContent = "等待个人主页";
    document.getElementById("status-tag").className = "tag";
    document.getElementById("delta-heat").textContent = "+0";
    document.getElementById("delta-rate").textContent = "等待专属发帖";
    document.getElementById("monitored-count").textContent = "我的帖子: 0";

    // Zero out grid
    document.getElementById("d-likes").textContent = "+0";
    document.getElementById("d-rts").textContent = "+0";
    document.getElementById("d-replies").textContent = "+0";
    document.getElementById("d-bookmarks").textContent = "+0";
    document.getElementById("d-views").textContent = "+0";

    document.getElementById("posts-container").innerHTML = `
      <div style="background:rgba(56,189,248,0.06); border:1px dashed rgba(56,189,248,0.25); border-radius:10px; padding:18px 12px; text-align:center; color:#94a3b8; font-size:11px; line-height:1.7;">
        <div style="font-size:24px; margin-bottom:4px;">👤</div>
        <b style="color:#38bdf8; font-size:12px;">已开启专属账号监控</b><br>
        当前仅记录您自己发布的帖子。请在 X 左侧点击 <b style="color:#f8fafc;">「个人资料 (Profile)」</b> 浏览一下自己的主页，插件就会自动锁定您的专属推文！
      </div>
    `;
    return;
  }

  document.getElementById("status-tag").textContent = `${intervalM}m 实时监控中`;
  document.getElementById("status-tag").className = "tag live";

  // Aggregate Deltas across targetList
  let totalDeltaViews = 0;
  let totalDeltaLikes = 0;
  const totalBreakdown = { views: 0, likes: 0, retweets: 0, replies: 0, bookmarks: 0 };
  const targetIntervalMs = intervalM * 60 * 1000;
  const now = Date.now();

  const activeTweets = [];

  for (const tweet of targetList) {
    const snaps = tweet.snapshots || [];
    if (snaps.length === 0) continue;

    const curr = snaps[snaps.length - 1];
    const first = tweet.firstSeenMetrics || snaps[0];

    // Find previous snapshot ~3 mins ago
    let prev = snaps[0];
    const targetTimestamp = now - targetIntervalMs;
    let minDiff = Infinity;

    for (const s of snaps) {
      const diff = Math.abs(s.t - targetTimestamp);
      if (diff < minDiff) {
        minDiff = diff;
        prev = s;
      }
    }

    // 3m Delta
    const dPeriod = {
      views: Math.max(0, curr.views - prev.views),
      likes: Math.max(0, curr.likes - prev.likes),
      retweets: Math.max(0, curr.retweets - prev.retweets),
      replies: Math.max(0, curr.replies - prev.replies),
      bookmarks: Math.max(0, curr.bookmarks - prev.bookmarks)
    };

    // Total Lifetime Delta
    const dTot = {
      views: Math.max(0, curr.views - first.views),
      likes: Math.max(0, curr.likes - first.likes),
      retweets: Math.max(0, curr.retweets - first.retweets),
      replies: Math.max(0, curr.replies - first.replies),
      bookmarks: Math.max(0, curr.bookmarks - first.bookmarks)
    };

    totalBreakdown.views += dPeriod.views;
    totalBreakdown.likes += dPeriod.likes;
    totalBreakdown.retweets += dPeriod.retweets;
    totalBreakdown.replies += dPeriod.replies;
    totalBreakdown.bookmarks += dPeriod.bookmarks;

    totalDeltaViews += dPeriod.views;
    totalDeltaLikes += dPeriod.likes;

    activeTweets.push({
      id: tweet.id,
      author: tweet.author,
      text: tweet.text || "推文",
      isOwnTweet: tweet.isOwnTweet,
      current: curr,
      dPeriod,
      dTot,
      firstSeenAt: tweet.firstSeenAt || now
    });
  }

  // Hero Card Summary
  document.getElementById("delta-heat").textContent = totalDeltaViews > 0 || totalDeltaLikes > 0
    ? `+${totalDeltaViews}`
    : `0`;
  
  const rateEl = document.getElementById("delta-rate");
  if (totalDeltaLikes > 0 || totalDeltaViews >= 40) {
    rateEl.textContent = "🔥 快速增长";
    rateEl.style.background = "rgba(244, 63, 94, 0.2)";
    rateEl.style.color = "#fb7185";
  } else if (totalDeltaViews > 0) {
    rateEl.textContent = "⚡ 持续上升";
    rateEl.style.background = "rgba(16, 185, 129, 0.2)";
    rateEl.style.color = "#34d399";
  } else {
    rateEl.textContent = "平稳";
    rateEl.style.background = "rgba(100, 116, 139, 0.2)";
    rateEl.style.color = "#94a3b8";
  }

  // Breakdown
  document.getElementById("d-likes").textContent = `+${totalBreakdown.likes}`;
  document.getElementById("d-rts").textContent = `+${totalBreakdown.retweets}`;
  document.getElementById("d-replies").textContent = `+${totalBreakdown.replies}`;
  document.getElementById("d-bookmarks").textContent = `+${totalBreakdown.bookmarks}`;
  document.getElementById("d-views").textContent = `+${totalBreakdown.views}`;

  // Time
  document.getElementById("last-update").textContent = `更新: ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;

  // Sort
  activeTweets.sort((a, b) => (b.dPeriod.views + b.dPeriod.likes * 10) - (a.dPeriod.views + a.dPeriod.likes * 10) || (b.dTot.views - a.dTot.views));

  // Render list
  document.getElementById("monitored-count").textContent = `${currentTab === "own" ? "我的帖子" : "已监控"}: ${activeTweets.length} 条`;
  renderPostsList(activeTweets, intervalM);

  // Sparkline
  drawSparkline(activeTweets.map(t => ({ heatDelta: t.dPeriod.views + t.dPeriod.likes * 5 })));
}

function renderPostsList(tweets, intervalM = 3) {
  const container = document.getElementById("posts-container");
  container.innerHTML = "";

  tweets.slice(0, 6).forEach((t) => {
    const card = document.createElement("div");
    card.className = "post-card";
    const c = t.current || {};
    const dp = t.dPeriod || {};
    const dt = t.dTot || {};

    let dpStr = [];
    if (dp.likes > 0) dpStr.push(`赞+${dp.likes}`);
    if (dp.views > 0) dpStr.push(`阅+${dp.views}`);
    const dpText = dpStr.length > 0 ? dpStr.join(" ") : "0";

    let totStr = [];
    if (dt.likes > 0) totStr.push(`赞+${dt.likes}`);
    if (dt.views > 0) totStr.push(`阅+${dt.views}`);
    const totText = totStr.length > 0 ? totStr.join(" ") : "0";

    card.innerHTML = `
      <div class="post-text">${escapeHtml(t.text)}</div>
      <div class="post-stats">
        <span>👁️ ${formatNumber(c.views)} · ❤️ ${formatNumber(c.likes)}</span>
        <span class="post-delta" style="color: #34d399;">${intervalM}m: <b>${dpText}</b> | 累计: <b style="color:#38bdf8;">${totText}</b></span>
      </div>
    `;
    container.appendChild(card);
  });
}

function drawSparkline(points) {
  if (!points || points.length < 2) return;

  const svg = document.getElementById("sparkline-svg");
  const path = document.getElementById("sparkline-path");
  const area = document.getElementById("sparkline-area");

  const width = 320;
  const height = 40;
  const paddingY = 4;

  const values = points.map(p => p.heatDelta || 0);
  const maxVal = Math.max(...values, 10);
  const minVal = Math.min(...values, 0);
  const range = maxVal - minVal || 1;

  const stepX = width / (values.length - 1);

  const coords = values.map((val, idx) => {
    const x = idx * stepX;
    const y = height - paddingY - ((val - minVal) / range) * (height - paddingY * 2);
    return { x, y };
  });

  let pathD = `M ${coords[0].x} ${coords[0].y}`;
  for (let i = 1; i < coords.length; i++) {
    pathD += ` L ${coords[i].x} ${coords[i].y}`;
  }

  path.setAttribute("d", pathD);
  const areaD = `${pathD} L ${coords[coords.length - 1].x} ${height} L ${coords[0].x} ${height} Z`;
  area.setAttribute("d", areaD);
}

function formatNumber(num) {
  if (!num) return "0";
  if (num >= 1000000) return (num / 1000000).toFixed(1) + "M";
  if (num >= 1000) return (num / 1000).toFixed(1) + "K";
  return num.toString();
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
