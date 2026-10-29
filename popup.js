/**
 * X Heat Pulse - Popup Logic & Visualization
 * Aggregates real in-page recorded tweet data from x.com
 */

document.addEventListener("DOMContentLoaded", () => {
  renderData();

  // Refresh button click
  const refreshBtn = document.getElementById("btn-refresh");
  const refreshIcon = document.getElementById("icon-refresh");

  refreshBtn.addEventListener("click", () => {
    refreshIcon.classList.add("spinning");
    // Trigger active tab rescan and storage sync
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, { action: "RESCAN" }, () => {
          // ignore error if tab is not on x.com
        });
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
  const history = storage.history || [];

  const tweetList = Object.values(tweetRecords);

  // 1. Tag & Status
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
        请在浏览器中打开 <a href="https://x.com" target="_blank" style="color:#38bdf8;">x.com</a> 并浏览你的主页或个人帖子，插件会自动在每条帖子右下角标出 5 分钟热度增量！
      </div>
    `;
    document.getElementById("last-update").textContent = "打开 x.com 即可实时标记";
    return;
  }

  document.getElementById("status-tag").textContent = "页面实时监控中";
  document.getElementById("status-tag").className = "tag live";

  // 2. Aggregate Deltas across all tracked tweets
  let totalDeltaHeat = 0;
  const totalBreakdown = { views: 0, likes: 0, retweets: 0, replies: 0, bookmarks: 0 };
  const targetIntervalMs = (config.intervalMinutes || 5) * 60 * 1000;
  const now = Date.now();

  const activeTweets = [];

  for (const tweet of tweetList) {
    const snaps = tweet.snapshots || [];
    if (snaps.length === 0) continue;

    const curr = snaps[snaps.length - 1];

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

    const dViews = Math.max(0, curr.views - prev.views);
    const dLikes = Math.max(0, curr.likes - prev.likes);
    const dRetweets = Math.max(0, curr.retweets - prev.retweets);
    const dReplies = Math.max(0, curr.replies - prev.replies);
    const dBookmarks = Math.max(0, curr.bookmarks - prev.bookmarks);

    const heatDelta = Math.round(
      dViews * 0.01 +
      dLikes * 2.0 +
      dRetweets * 5.0 +
      dReplies * 3.0 +
      dBookmarks * 4.0
    );

    totalBreakdown.views += dViews;
    totalBreakdown.likes += dLikes;
    totalBreakdown.retweets += dRetweets;
    totalBreakdown.replies += dReplies;
    totalBreakdown.bookmarks += dBookmarks;
    totalDeltaHeat += heatDelta;

    activeTweets.push({
      id: tweet.id,
      author: tweet.author,
      text: tweet.text || "推文",
      heatDelta,
      current: curr,
      delta: { views: dViews, likes: dLikes, retweets: dRetweets, replies: dReplies, bookmarks: dBookmarks }
    });
  }

  // Account display
  if (activeTweets.length > 0 && activeTweets[0].author) {
    document.getElementById("account-name").textContent = `@${activeTweets[0].author}`;
  }

  // Delta Card
  document.getElementById("delta-heat").textContent = totalDeltaHeat > 0 ? `+${totalDeltaHeat}` : `${totalDeltaHeat}`;
  
  const rateEl = document.getElementById("delta-rate");
  if (totalDeltaHeat >= 100) {
    rateEl.textContent = "🔥 极高爆发";
    rateEl.style.background = "rgba(239, 68, 68, 0.2)";
    rateEl.style.color = "#f87171";
  } else if (totalDeltaHeat >= 30) {
    rateEl.textContent = "⚡ 快速上升";
    rateEl.style.background = "rgba(245, 158, 11, 0.2)";
    rateEl.style.color = "#fbbf24";
  } else if (totalDeltaHeat > 0) {
    rateEl.textContent = "📈 稳步上升";
    rateEl.style.background = "rgba(16, 185, 129, 0.2)";
    rateEl.style.color = "#34d399";
  } else {
    rateEl.textContent = "采样基准就绪";
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
  document.getElementById("last-update").textContent = `采样更新: ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;

  // Sort active tweets by heat delta descending
  activeTweets.sort((a, b) => b.heatDelta - a.heatDelta || (b.current.views - a.current.views));

  // Render list
  document.getElementById("monitored-count").textContent = `已捕获: ${activeTweets.length} 条`;
  renderPostsList(activeTweets);

  // Sparkline from history
  drawSparkline(activeTweets.map(t => ({ heatDelta: t.heatDelta })));
}

function renderPostsList(tweets) {
  const container = document.getElementById("posts-container");
  container.innerHTML = "";

  tweets.slice(0, 6).forEach((t) => {
    const card = document.createElement("div");
    card.className = "post-card";
    const c = t.current || {};
    const d = t.delta || {};

    const deltaBadges = [];
    if (d.likes > 0) deltaBadges.push(`赞+${d.likes}`);
    if (d.retweets > 0) deltaBadges.push(`转+${d.retweets}`);
    if (d.views > 0) deltaBadges.push(`阅+${d.views}`);

    const deltaSummary = deltaBadges.length > 0 ? deltaBadges.join(" · ") : "5m稳定";

    card.innerHTML = `
      <div class="post-text">${escapeHtml(t.text)}</div>
      <div class="post-stats">
        <span>👁️ ${formatNumber(c.views)} · ❤️ ${formatNumber(c.likes)} · 🔁 ${formatNumber(c.retweets)}</span>
        <span class="post-delta" style="${t.heatDelta > 0 ? 'color:#00ba7c;' : ''}">Δ ${deltaSummary}</span>
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
