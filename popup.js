/**
 * X Heat Pulse - Popup Logic & Visualization
 */

document.addEventListener("DOMContentLoaded", () => {
  renderData();

  // Refresh button click
  const refreshBtn = document.getElementById("btn-refresh");
  const refreshIcon = document.getElementById("icon-refresh");

  refreshBtn.addEventListener("click", () => {
    refreshIcon.classList.add("spinning");
    chrome.runtime.sendMessage({ action: "FORCE_POLL" }, (response) => {
      setTimeout(() => {
        refreshIcon.classList.remove("spinning");
        renderData();
      }, 500);
    });
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
    "history",
    "account_info",
    "last_metrics",
    "last_poll_status"
  ]);

  const history = storage.history || [];
  const accountInfo = storage.account_info || null;
  const lastMetrics = storage.last_metrics || null;
  const config = storage.config || { intervalMinutes: 5 };

  // 1. Account info
  if (accountInfo) {
    document.getElementById("account-name").textContent = `@${accountInfo.screen_name || "You"}`;
    if (accountInfo.type === "demo_simulation") {
      document.getElementById("status-tag").textContent = "模拟数据";
      document.getElementById("status-tag").className = "tag";
    } else {
      document.getElementById("status-tag").textContent = `${config.intervalMinutes}m 活跃`;
      document.getElementById("status-tag").className = "tag live";
    }
  }

  document.getElementById("d-interval").textContent = `${config.intervalMinutes}m`;

  // 2. Latest sample & Delta
  if (history.length > 0) {
    const latest = history[history.length - 1];
    const heatDelta = latest.heatDelta || 0;

    document.getElementById("delta-heat").textContent = heatDelta > 0 ? `+${heatDelta}` : `${heatDelta}`;
    
    // Status text & color
    const rateEl = document.getElementById("delta-rate");
    if (heatDelta >= 100) {
      rateEl.textContent = "🔥 极高爆发";
      rateEl.style.background = "rgba(239, 68, 68, 0.2)";
      rateEl.style.color = "#f87171";
    } else if (heatDelta >= 30) {
      rateEl.textContent = "⚡ 快速上升";
      rateEl.style.background = "rgba(245, 158, 11, 0.2)";
      rateEl.style.color = "#fbbf24";
    } else if (heatDelta > 0) {
      rateEl.textContent = "📈 稳步上升";
      rateEl.style.background = "rgba(16, 185, 129, 0.2)";
      rateEl.style.color = "#34d399";
    } else {
      rateEl.textContent = "平稳";
      rateEl.style.background = "rgba(100, 116, 139, 0.2)";
      rateEl.style.color = "#94a3b8";
    }

    // Breakdown
    const b = latest.breakdown || {};
    document.getElementById("d-likes").textContent = `+${b.likes || 0}`;
    document.getElementById("d-rts").textContent = `+${b.retweets || 0}`;
    document.getElementById("d-replies").textContent = `+${b.replies || 0}`;
    document.getElementById("d-bookmarks").textContent = `+${b.bookmarks || 0}`;
    document.getElementById("d-views").textContent = `+${b.views || 0}`;

    // Timestamp
    const timeStr = new Date(latest.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    document.getElementById("last-update").textContent = `最近采样: ${timeStr}`;

    // Draw sparkline
    drawSparkline(history.slice(-16));
  } else {
    document.getElementById("last-update").textContent = "采样准备中...";
  }

  // 3. Render Monitored Tweets
  if (lastMetrics && lastMetrics.data && lastMetrics.data.length > 0) {
    document.getElementById("monitored-count").textContent = `监控中: ${lastMetrics.data.length}`;
    renderPostsList(lastMetrics.data);
  }
}

function renderPostsList(tweets) {
  const container = document.getElementById("posts-container");
  container.innerHTML = "";

  tweets.slice(0, 5).forEach((t, idx) => {
    const card = document.createElement("div");
    card.className = "post-card";
    const m = t.metrics || {};
    card.innerHTML = `
      <div class="post-text">${escapeHtml(t.text || "推文内容")}</div>
      <div class="post-stats">
        <span>👁️ ${formatNumber(m.views)} · ❤️ ${formatNumber(m.likes)} · 🔁 ${formatNumber(m.retweets)}</span>
        <span class="post-delta">#${idx + 1}</span>
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

  // Construct SVG path
  let pathD = `M ${coords[0].x} ${coords[0].y}`;
  for (let i = 1; i < coords.length; i++) {
    pathD += ` L ${coords[i].x} ${coords[i].y}`;
  }

  path.setAttribute("d", pathD);

  // Area path (closed at the bottom)
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
