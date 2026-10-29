/**
 * X Heat Pulse - Popup Logic & Visualization (v1.5.1)
 * Linear / Stripe minimalist white SaaS design language matching the in-page portal.
 * Aggregates real in-page recorded tweet data from x.com
 * Supports strictly filtering and monitoring the user's OWN tweets.
 * Pre-binds @sben96001 by default with interactive 1-click handle modification.
 */

let currentTab = "own"; // 'own' (default) or 'all'
let currentSortMode = "views"; // 'views' (默认按总流量), 'surge' (近10分起量), 'velocity' (时均增速)

document.addEventListener("DOMContentLoaded", async () => {
  // 1. Check active tab or auto-bind default handle (@sben96001)
  const storage = await chrome.storage.local.get(["my_user_handle", "config"]);
  let activeHandle = storage.my_user_handle || (storage.config ? storage.config.myHandle : "") || "sben96001";

  // Sort selector listener
  const sortSelect = document.getElementById("sort-select");
  if (sortSelect) {
    sortSelect.value = currentSortMode;
    sortSelect.addEventListener("change", (e) => {
      currentSortMode = e.target.value;
      renderData();
    });
  }

  if (!storage.my_user_handle) {
    await bindHandleAndRetag(activeHandle);
  } else {
    renderData();
  }

  // 2. Scope Tab Clicks
  const tabOwn = document.getElementById("tab-own");
  const tabAll = document.getElementById("tab-all");

  if (tabOwn && tabAll) {
    tabOwn.addEventListener("click", () => {
      currentTab = "own";
      tabOwn.classList.add("active");
      tabAll.classList.remove("active");
      const titleEl = document.getElementById("posts-list-title");
      if (titleEl) titleEl.textContent = "我的专属帖子";
      renderData();
    });

    tabAll.addEventListener("click", () => {
      currentTab = "all";
      tabAll.classList.add("active");
      tabOwn.classList.remove("active");
      const titleEl = document.getElementById("posts-list-title");
      if (titleEl) titleEl.textContent = "发现信息流推文";
      renderData();
    });
  }

  // 3. Refresh button click
  const refreshBtn = document.getElementById("btn-refresh");
  const refreshIcon = document.getElementById("icon-refresh");

  if (refreshBtn && refreshIcon) {
    refreshBtn.addEventListener("click", () => {
      refreshIcon.classList.add("spinning");
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, { action: "RESCAN" }, () => {
            const _ = chrome.runtime.lastError;
          });
        }
      });

      setTimeout(() => {
        refreshIcon.classList.remove("spinning");
        renderData();
      }, 400);
    });
  }

  // 4. Account Switcher Modal Handlers
  const accountBtn = document.getElementById("account-btn");
  const modal = document.getElementById("account-modal");
  const cancelBtn = document.getElementById("btn-modal-cancel");
  const saveBtn = document.getElementById("btn-modal-save");
  const inputEl = document.getElementById("modal-handle-input");

  if (accountBtn && modal) {
    accountBtn.addEventListener("click", async () => {
      const cur = await chrome.storage.local.get("my_user_handle");
      inputEl.value = cur.my_user_handle || "sben96001";
      modal.classList.add("open");
      inputEl.focus();
    });
  }

  if (cancelBtn && modal) {
    cancelBtn.addEventListener("click", () => {
      modal.classList.remove("open");
    });
  }

  if (saveBtn && modal && inputEl) {
    saveBtn.addEventListener("click", async () => {
      const val = inputEl.value.trim().replace(/^@/, '');
      if (val) {
        modal.classList.remove("open");
        await bindHandleAndRetag(val);
      }
    });

    inputEl.addEventListener("keydown", async (e) => {
      if (e.key === "Enter") {
        const val = inputEl.value.trim().replace(/^@/, '');
        if (val) {
          modal.classList.remove("open");
          await bindHandleAndRetag(val);
        }
      }
    });
  }

  // 5. Settings button click
  const settingsBtn = document.getElementById("btn-settings");
  const optionsLink = document.getElementById("link-options");

  const openSettings = () => {
    if (chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open(chrome.runtime.getURL("options.html"));
    }
  };

  if (settingsBtn) settingsBtn.addEventListener("click", openSettings);
  if (optionsLink) optionsLink.addEventListener("click", openSettings);
});

async function bindHandleAndRetag(handle) {
  const clean = handle.replace(/^@/, '').trim();
  if (!clean) return;

  const storage = await chrome.storage.local.get(["tweet_records", "config"]);
  const records = storage.tweet_records || {};

  for (const id in records) {
    if (records[id].author && records[id].author.toLowerCase() === clean.toLowerCase()) {
      records[id].isOwnTweet = true;
    }
  }

  const newConfig = { ...(storage.config || { intervalMinutes: 10 }), myHandle: clean };

  await chrome.storage.local.set({
    my_user_handle: clean,
    config: newConfig,
    tweet_records: records
  });

  // Notify background service worker to update polling & alarms
  chrome.runtime.sendMessage({ action: "UPDATE_CONFIG", config: newConfig }, () => {
    const _ = chrome.runtime.lastError;
  });

  // Notify active tabs
  chrome.tabs.query({ url: ["https://x.com/*", "https://twitter.com/*"] }, (tabs) => {
    tabs.forEach(tab => {
      if (tab.id) {
        chrome.tabs.sendMessage(tab.id, { action: "SET_HANDLE", handle: clean }, () => {
          const _ = chrome.runtime.lastError;
        });
      }
    });
  });

  renderData();
}

async function renderData() {
  const storage = await chrome.storage.local.get([
    "config",
    "tweet_records",
    "my_user_handle"
  ]);

  const tweetRecords = storage.tweet_records || {};
  const config = storage.config || { intervalMinutes: 10 };
  const intervalM = config.intervalMinutes || 10;
  const myHandle = (storage.my_user_handle || config.myHandle || "sben96001").trim();
  const tweetList = Object.values(tweetRecords);

  const dIntervalEl = document.getElementById("d-interval");
  if (dIntervalEl) dIntervalEl.textContent = `${intervalM}`;

  const tbIntervalEl = document.getElementById("tb-interval");
  if (tbIntervalEl) tbIntervalEl.textContent = `${intervalM}`;

  const titleEl = document.getElementById("label-delta-title");
  if (titleEl) {
    titleEl.textContent = currentTab === "own"
      ? `我的帖子实时热度`
      : `发现信息流实时热度`;
  }
  const unitEl = document.getElementById("label-delta-unit");
  if (unitEl) unitEl.textContent = `阅`;

  // Always display user's own handle on the hero card
  const accountNameEl = document.getElementById("account-name");
  if (accountNameEl) {
    accountNameEl.textContent = `@${myHandle}`;
  }

  const statusTag = document.getElementById("status-tag");
  const statusTagText = document.getElementById("status-tag-text");

  // Helper function for metric table row rendering
  const renderDeltaCell = (val) => {
    if (val > 0) return `<span class="val-highlight">+${val}</span>`;
    return `<span class="val-zero">+0</span>`;
  };

  const setMetricRow = (deltaId, totId, deltaVal, totVal) => {
    const elDelta = document.getElementById(deltaId);
    if (elDelta) elDelta.innerHTML = renderDeltaCell(deltaVal);
    const elTot = document.getElementById(totId);
    if (elTot) elTot.textContent = formatNumber(totVal);
  };

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

  // If no tweets at all in storage
  if (tweetList.length === 0) {
    if (statusTagText) statusTagText.textContent = "等待页面数据";
    if (statusTag) statusTag.className = "tag";

    const totalViewsEl = document.getElementById("total-views");
    if (totalViewsEl) totalViewsEl.textContent = "0";
    const totalHourlyEl = document.getElementById("total-hourly-rate");
    if (totalHourlyEl) totalHourlyEl.textContent = "0/h";
    const deltaHeatEl = document.getElementById("delta-heat");
    if (deltaHeatEl) {
      deltaHeatEl.textContent = "+0";
      deltaHeatEl.classList.remove("text-positive");
    }
    const burstHourlyEl = document.getElementById("burst-hourly-rate");
    if (burstHourlyEl) burstHourlyEl.textContent = "0";

    const deltaTotEl = document.getElementById("delta-total");
    if (deltaTotEl) deltaTotEl.textContent = "+0";

    const rateEl = document.getElementById("delta-rate");
    if (rateEl) {
      rateEl.className = "x-push-status-badge steady";
      rateEl.innerHTML = `<span class="x-status-pulse-dot"></span><span>未检测到推文</span>`;
    }

    setMetricRow("d-views", "tot-views", 0, 0);
    setMetricRow("d-likes", "tot-likes", 0, 0);
    setMetricRow("d-rts", "tot-rts", 0, 0);
    setMetricRow("d-replies", "tot-replies", 0, 0);
    setMetricRow("d-bookmarks", "tot-bookmarks", 0, 0);

    const countEl = document.getElementById("monitored-count");
    if (countEl) countEl.textContent = "监控中: 0 条";

    const postsContainer = document.getElementById("posts-container");
    if (postsContainer) {
      postsContainer.innerHTML = `
        <div style="background:#ffffff; border:1px dashed #d1d5db; border-radius:8px; padding:18px 12px; text-align:center; color:#6b7280; font-size:11.5px; line-height:1.6;">
          <div style="font-size:20px; margin-bottom:4px;">⚡</div>
          <b style="color:#111827;">实时监控就绪</b><br>
          当前正在专属监控 <b style="color:#0284c7;">@${myHandle}</b>。<br>
          请在浏览器中打开 <a href="https://x.com/${myHandle}" target="_blank" style="color:#0284c7; text-decoration:underline;">x.com/${myHandle}</a> 浏览主页，推文将自动捕获并计算！
        </div>
      `;
    }
    const lastUpdateEl = document.getElementById("last-update");
    if (lastUpdateEl) lastUpdateEl.textContent = "打开 x.com 即可实时标记";
    return;
  }

  // If user selected "我的帖子" but has not matched own tweets yet
  if (currentTab === "own" && ownTweets.length === 0) {
    if (statusTagText) statusTagText.textContent = "专属监控中";
    if (statusTag) statusTag.className = "tag live";

    const totalViewsEl = document.getElementById("total-views");
    if (totalViewsEl) totalViewsEl.textContent = "0";
    const totalHourlyEl = document.getElementById("total-hourly-rate");
    if (totalHourlyEl) totalHourlyEl.textContent = "0/h";
    const deltaHeatEl = document.getElementById("delta-heat");
    if (deltaHeatEl) {
      deltaHeatEl.textContent = "+0";
      deltaHeatEl.classList.remove("text-positive");
    }
    const burstHourlyEl = document.getElementById("burst-hourly-rate");
    if (burstHourlyEl) burstHourlyEl.textContent = "0";

    const deltaTotEl = document.getElementById("delta-total");
    if (deltaTotEl) deltaTotEl.textContent = "+0";

    const rateEl = document.getElementById("delta-rate");
    if (rateEl) {
      rateEl.className = "x-push-status-badge steady";
      rateEl.innerHTML = `<span class="x-status-pulse-dot"></span><span>等待主页浏览</span>`;
    }

    setMetricRow("d-views", "tot-views", 0, 0);
    setMetricRow("d-likes", "tot-likes", 0, 0);
    setMetricRow("d-rts", "tot-rts", 0, 0);
    setMetricRow("d-replies", "tot-replies", 0, 0);
    setMetricRow("d-bookmarks", "tot-bookmarks", 0, 0);

    const countEl = document.getElementById("monitored-count");
    if (countEl) countEl.textContent = "我的帖子: 0 条";

    const postsContainer = document.getElementById("posts-container");
    if (postsContainer) {
      postsContainer.innerHTML = `
        <div style="background:#ffffff; border:1px dashed #d1d5db; border-radius:8px; padding:16px 12px; text-align:center; color:#6b7280; font-size:11.5px; line-height:1.6;">
          <div style="font-size:20px; margin-bottom:4px;">👤</div>
          <b style="color:#111827;">专属账号已锁定: @${myHandle}</b><br>
          当前在信息流已缓存 ${tweetList.length} 条推文。<br>
          请在 X 打开 <a href="https://x.com/${myHandle}" target="_blank" style="color:#0284c7; text-decoration:underline;">个人主页 (Profile)</a> 浏览自己的推文，即可立即呈现！
          <div style="margin-top:10px; display:flex; justify-content:center; gap:8px;">
            <button id="btn-force-scan" style="background:#0f172a; border:none; color:#fff; border-radius:6px; padding:5px 12px; font-size:11px; font-weight:600; cursor:pointer;">
              🔄 立即扫描主页推文
            </button>
            <button id="btn-change-handle" style="background:#f3f4f6; border:1px solid #e5e7eb; color:#4b5563; border-radius:6px; padding:5px 12px; font-size:11px; cursor:pointer;">
              切换账号
            </button>
          </div>
        </div>
      `;

      const forceScanBtn = document.getElementById("btn-force-scan");
      if (forceScanBtn) {
        forceScanBtn.addEventListener("click", () => {
          chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0]?.id) {
              chrome.tabs.sendMessage(tabs[0].id, { action: "RESCAN" }, () => {
                const _ = chrome.runtime.lastError;
              });
            }
          });
          setTimeout(renderData, 400);
        });
      }

      const changeHandleBtn = document.getElementById("btn-change-handle");
      if (changeHandleBtn) {
        changeHandleBtn.addEventListener("click", () => {
          const modal = document.getElementById("account-modal");
          const inputEl = document.getElementById("modal-handle-input");
          if (modal && inputEl) {
            inputEl.value = myHandle;
            modal.classList.add("open");
            inputEl.focus();
          }
        });
      }
    }

    return;
  }

  if (statusTagText) statusTagText.textContent = `${intervalM}m 实时监控中`;
  if (statusTag) statusTag.className = "tag live";

  // Aggregate Totals, Deltas & Hourly Velocity across targetList
  let totalViews = 0;
  let totalDeltaViews = 0;
  let totalLifetimeDeltaViews = 0;
  let totalHourlyRate = 0;
  const totalBreakdown = {
    views: 0, viewsTotal: 0,
    likes: 0, likesTotal: 0,
    retweets: 0, retweetsTotal: 0,
    replies: 0, repliesTotal: 0,
    bookmarks: 0, bookmarksTotal: 0
  };
  const targetIntervalMs = intervalM * 60 * 1000;
  const now = Date.now();

  const activeTweets = [];

  for (const tweet of targetList) {
    const snaps = tweet.snapshots || [];
    if (snaps.length === 0) continue;

    const curr = snaps[snaps.length - 1];
    const first = tweet.firstSeenMetrics || snaps[0];
    const pubTime = tweet.publishedAt || tweet.firstSeenAt || now;
    const pubAgeMs = Math.max(now - pubTime, 60 * 1000);
    const pubAgeHours = pubAgeMs / (1000 * 60 * 60);
    const hourlyVelocity = pubAgeHours > 0 ? Math.round((curr.views || 0) / pubAgeHours) : 0;
    const formattedHourlyRate = hourlyVelocity >= 10000
      ? `${(hourlyVelocity / 1000).toFixed(1)}k/h`
      : `${hourlyVelocity}/h`;

    // Find previous snapshot ~ intervalM mins ago
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

    // Interval Delta
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

    totalViews += (curr.views || 0);
    totalDeltaViews += dPeriod.views;
    totalLifetimeDeltaViews += dTot.views;
    totalHourlyRate += hourlyVelocity;

    totalBreakdown.views += dPeriod.views;
    totalBreakdown.viewsTotal += (curr.views || 0);

    totalBreakdown.likes += dPeriod.likes;
    totalBreakdown.likesTotal += (curr.likes || 0);

    totalBreakdown.retweets += dPeriod.retweets;
    totalBreakdown.retweetsTotal += (curr.retweets || 0);

    totalBreakdown.replies += dPeriod.replies;
    totalBreakdown.repliesTotal += (curr.replies || 0);

    totalBreakdown.bookmarks += dPeriod.bookmarks;
    totalBreakdown.bookmarksTotal += (curr.bookmarks || 0);

    activeTweets.push({
      id: tweet.id,
      author: tweet.author,
      text: tweet.text || "推文",
      isOwnTweet: tweet.isOwnTweet,
      current: curr,
      dPeriod,
      dTot,
      hourlyVelocity,
      formattedHourlyRate,
      firstSeenAt: tweet.firstSeenAt || now
    });
  }

  // --- Hero Card 3-Pillars ---
  // 1. 全帖累计均速
  const totalHourlyEl = document.getElementById("total-hourly-rate");
  if (totalHourlyEl) {
    totalHourlyEl.textContent = totalHourlyRate >= 10000
      ? `${(totalHourlyRate / 1000).toFixed(1)}k/h`
      : `${totalHourlyRate}/h`;
  }
  const totalViewsEl = document.getElementById("total-views");
  if (totalViewsEl) totalViewsEl.textContent = formatNumber(totalViews);

  // 2. 眼下起量 (近10分增量与折算时速)
  const deltaHeatEl = document.getElementById("delta-heat");
  if (deltaHeatEl) {
    deltaHeatEl.textContent = `+${totalDeltaViews}`;
    if (totalDeltaViews > 0) {
      deltaHeatEl.classList.add("text-positive");
    } else {
      deltaHeatEl.classList.remove("text-positive");
    }
  }

  const burstHourly = Math.round(totalDeltaViews * (60 / (intervalM || 10)));
  const burstHourlyEl = document.getElementById("burst-hourly-rate");
  if (burstHourlyEl) {
    burstHourlyEl.textContent = burstHourly >= 10000 ? `${(burstHourly / 1000).toFixed(1)}k` : String(burstHourly);
  }

  // 3. 当前推流态势 & 监控累计
  const deltaTotEl = document.getElementById("delta-total");
  if (deltaTotEl) deltaTotEl.textContent = `+${totalLifetimeDeltaViews}`;

  const rateEl = document.getElementById("delta-rate");
  if (rateEl) {
    let rateClass = "steady";
    let rateText = "☕ 平稳推流";
    if (totalDeltaViews >= 50 || totalHourlyRate >= 500 || burstHourly >= 500) {
      rateClass = "hot";
      rateText = "🔥 爆款推流中";
    } else if (totalDeltaViews >= 5 || totalHourlyRate >= 80 || burstHourly >= 60) {
      rateClass = "growing";
      rateText = "⚡ 正在加速推流";
    }
    rateEl.className = `x-push-status-badge ${rateClass}`;
    rateEl.innerHTML = `<span class="x-status-pulse-dot"></span><span>${rateText}</span>`;
  }

  // --- Breakdown Table Rows ---
  setMetricRow("d-views", "tot-views", totalBreakdown.views, totalBreakdown.viewsTotal);
  setMetricRow("d-likes", "tot-likes", totalBreakdown.likes, totalBreakdown.likesTotal);
  setMetricRow("d-rts", "tot-rts", totalBreakdown.retweets, totalBreakdown.retweetsTotal);
  setMetricRow("d-replies", "tot-replies", totalBreakdown.replies, totalBreakdown.repliesTotal);
  setMetricRow("d-bookmarks", "tot-bookmarks", totalBreakdown.bookmarks, totalBreakdown.bookmarksTotal);

  // Time
  const lastUpdateEl = document.getElementById("last-update");
  if (lastUpdateEl) {
    lastUpdateEl.textContent = `采样更新: ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
  }

  // Sort: Default strictly by total traffic (views) descending
  if (currentSortMode === "surge") {
    activeTweets.sort((a, b) => (b.dPeriod?.views || 0) - (a.dPeriod?.views || 0) || ((b.current?.views || 0) - (a.current?.views || 0)));
  } else if (currentSortMode === "velocity") {
    activeTweets.sort((a, b) => (b.hourlyVelocity || 0) - (a.hourlyVelocity || 0) || ((b.current?.views || 0) - (a.current?.views || 0)));
  } else {
    // 默认严格按总流量 (总浏览曝光 views) 降序排序
    activeTweets.sort((a, b) => ((b.current?.views || 0) - (a.current?.views || 0)) || ((b.dTot?.views || 0) - (a.dTot?.views || 0)));
  }

  // Render list
  const countEl = document.getElementById("monitored-count");
  if (countEl) {
    countEl.textContent = `${currentTab === "own" ? "我的帖子" : "已监控"}: ${activeTweets.length} 条`;
  }
  renderPostsList(activeTweets, intervalM);

  // Sparkline
  drawSparkline(activeTweets.map(t => ({ heatDelta: t.dPeriod.views + t.dPeriod.likes * 5 })));
}

function renderPostsList(tweets, intervalM = 10) {
  const container = document.getElementById("posts-container");
  if (!container) return;
  container.innerHTML = "";

  if (tweets.length === 0) {
    container.innerHTML = `<div style="color:#9ca3af; text-align:center; padding: 20px 0; font-size:11.5px;">暂无匹配的推文数据</div>`;
    return;
  }

  tweets.slice(0, 15).forEach((t) => {
    const card = document.createElement("div");
    card.className = "post-card";
    const c = t.current || {};
    const dp = t.dPeriod || {};
    const dt = t.dTot || {};

    const isPositive = (dp.views || 0) > 0;
    const deltaBadge = isPositive
      ? `<span class="post-delta-badge positive">${intervalM}m: +${dp.views}</span>`
      : `<span class="post-delta-badge">${intervalM}m: +0</span>`;

    card.innerHTML = `
      <div class="post-text" title="${escapeHtml(t.text)}">${escapeHtml(t.text)}</div>
      <div class="post-stats">
        <div class="post-stats-left">
          <span>👁️ <b>${formatNumber(c.views)}</b></span>
          <span class="post-speed-pill">⚡ ${t.formattedHourlyRate}</span>
          <span>❤️ ${formatNumber(c.likes)}</span>
          <span>💬 ${formatNumber(c.replies)}</span>
        </div>
        <div class="post-stats-right">
          ${deltaBadge}
          <span class="post-delta-tot">累计: +${dt.views || 0}</span>
        </div>
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
  if (!svg || !path || !area) return;

  const width = 350;
  const height = 34;
  const paddingY = 3;

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
