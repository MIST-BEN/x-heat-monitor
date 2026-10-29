/**
 * X Heat Pulse - Popup Logic & Visualization (v1.2.0)
 * Aggregates real in-page recorded tweet data from x.com
 * Supports both 5-minute delta and total lifetime delta since first seen.
 */

document.addEventListener("DOMContentLoaded", () => {
  renderData();

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
    "history"
  ]);

  const tweetRecords = storage.tweet_records || {};
  const config = storage.config || { intervalMinutes: 5 };
  const tweetList = Object.values(tweetRecords);

  document.getElementById("d-interval").textContent = `${config.intervalMinutes}m`;

  if (tweetList.length === 0) {
    document.getElementById("account-name").textContent = "@X.com";
    document.getElementById("status-tag").textContent = "等待页面数据";
    document.getElementById("status-tag").className = "tag";
    document.getElementById("delta-heat").textContent = "+0";
    document.getElementById("delta-rate").textContent = "未检测到推文";
    document.getElementById("monitored-count").textContent = "监控中: 0";
    document.getElementById("posts-container").innerHTML = `
      <div style="color:#94a3b8; font-size:11px; text-align:center; padding: 20px 10px; line-height:1.6;">
        ⚡ <b>实时标柱已激活</b><br>
        请在浏览器中打开 <a href="https://x.com" target="_blank" style="color:#38bdf8;">x.com</a> 并浏览你的主页或帖子，插件会自动在每条帖子右下角标出 5 分钟增量与自首次看到的累计总增量！
      </div>
    `;
    document.getElementById("last-update").textContent = "打开 x.com 即可实时标记";
    return;
  }

  document.getElementById("status-tag").textContent = "页面实时监控中";
  document.getElementById("status-tag").className = "tag live";

  // Aggregate Deltas
  let totalDeltaViews = 0;
  let totalDeltaLikes = 0;
  const totalBreakdown = { views: 0, likes: 0, retweets: 0, replies: 0, bookmarks: 0 };
  const targetIntervalMs = (config.intervalMinutes || 5) * 60 * 1000;
  const now = Date.now();

  const activeTweets = [];

  for (const tweet of tweetList) {
    const snaps = tweet.snapshots || [];
    if (snaps.length === 0) continue;

    const curr = snaps[snaps.length - 1];
    const first = tweet.firstSeenMetrics || snaps[0];

    // Find previous snapshot ~5 mins ago
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

    // 5m Delta
    const d5 = {
      views: Math.max(0, curr.views - prev.views),
      likes: Math.max(0, curr.likes - prev.likes),
      retweets: Math.max(0, curr.retweets - prev.retweets),
      replies: Math.max(0, curr.replies - prev.replies),
      bookmarks: Math.max(0, curr.bookmarks - prev.bookmarks)
    };

    // Total Lifetime Delta since first seen
    const dTot = {
      views: Math.max(0, curr.views - first.views),
      likes: Math.max(0, curr.likes - first.likes),
      retweets: Math.max(0, curr.retweets - first.retweets),
      replies: Math.max(0, curr.replies - first.replies),
      bookmarks: Math.max(0, curr.bookmarks - first.bookmarks)
    };

    totalBreakdown.views += d5.views;
    totalBreakdown.likes += d5.likes;
    totalBreakdown.retweets += d5.retweets;
    totalBreakdown.replies += d5.replies;
    totalBreakdown.bookmarks += d5.bookmarks;

    totalDeltaViews += d5.views;
    totalDeltaLikes += d5.likes;

    activeTweets.push({
      id: tweet.id,
      author: tweet.author,
      text: tweet.text || "推文",
      current: curr,
      d5,
      dTot,
      firstSeenAt: tweet.firstSeenAt || now
    });
  }

  // Account name
  if (activeTweets.length > 0 && activeTweets[0].author) {
    document.getElementById("account-name").textContent = `@${activeTweets[0].author}`;
  }

  // Delta Card Summary
  const net5m = totalDeltaLikes * 10 + totalDeltaViews;
  document.getElementById("delta-heat").textContent = totalDeltaViews > 0 || totalDeltaLikes > 0
    ? `+${totalDeltaViews}`
    : `0`;
  
  const rateEl = document.getElementById("delta-rate");
  if (totalDeltaLikes > 0 || totalDeltaViews >= 50) {
    rateEl.textContent = "🔥 快速增长";
    rateEl.style.background = "rgba(249, 24, 128, 0.2)";
    rateEl.style.color = "#f91880";
  } else if (totalDeltaViews > 0) {
    rateEl.textContent = "⚡ 持续上升";
    rateEl.style.background = "rgba(0, 186, 124, 0.2)";
    rateEl.style.color = "#00ba7c";
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

  // Sort: prioritize tweets with recent changes
  activeTweets.sort((a, b) => (b.d5.views + b.d5.likes * 10) - (a.d5.views + a.d5.likes * 10) || (b.dTot.views - a.dTot.views));

  // Render list
  document.getElementById("monitored-count").textContent = `监控中: ${activeTweets.length} 条`;
  renderPostsList(activeTweets);

  // Sparkline
  drawSparkline(activeTweets.map(t => ({ heatDelta: t.d5.views + t.d5.likes * 5 })));
}

function renderPostsList(tweets) {
  const container = document.getElementById("posts-container");
  container.innerHTML = "";

  tweets.slice(0, 6).forEach((t) => {
    const card = document.createElement("div");
    card.className = "post-card";
    const c = t.current || {};
    const d5 = t.d5 || {};
    const dt = t.dTot || {};

    let d5Str = [];
    if (d5.likes > 0) d5Str.push(`赞+${d5.likes}`);
    if (d5.views > 0) d5Str.push(`阅+${d5.views}`);
    const d5Text = d5Str.length > 0 ? d5Str.join(" ") : "0";

    let totStr = [];
    if (dt.likes > 0) totStr.push(`赞+${dt.likes}`);
    if (dt.views > 0) totStr.push(`阅+${dt.views}`);
    const totText = totStr.length > 0 ? totStr.join(" ") : "0";

    card.innerHTML = `
      <div class="post-text">${escapeHtml(t.text)}</div>
      <div class="post-stats">
        <span>👁️ ${formatNumber(c.views)} · ❤️ ${formatNumber(c.likes)}</span>
        <span class="post-delta" style="color: #00ba7c;">5m: <b>${d5Text}</b> | 累计: <b style="color:#1d9bf0;">${totText}</b></span>
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
