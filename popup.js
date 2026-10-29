/**
 * X Heat Pulse - Popup Logic & Visualization (v1.4.2)
 * Aggregates real in-page recorded tweet data from x.com
 * Supports strictly filtering and monitoring the user's OWN tweets.
 * Pre-binds @sben96001 by default with interactive 1-click handle modification.
 */

let currentTab = "own"; // 'own' (default) or 'all'

document.addEventListener("DOMContentLoaded", async () => {
  // 1. Check active tab or auto-bind default handle (@sben96001)
  const storage = await chrome.storage.local.get(["my_user_handle", "config"]);
  let activeHandle = storage.my_user_handle || (storage.config ? storage.config.myHandle : "") || "sben96001";

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
  if (dIntervalEl) dIntervalEl.textContent = `${intervalM}m`;

  const titleEl = document.getElementById("label-delta-title");
  if (titleEl) {
    titleEl.textContent = currentTab === "own"
      ? `我的帖子近${intervalM}分增量`
      : `信息流近${intervalM}分增量`;
  }
  const unitEl = document.getElementById("label-delta-unit");
  if (unitEl) unitEl.textContent = `次曝光/${intervalM}m`;

  // Always display user's own handle on the hero card
  const accountNameEl = document.getElementById("account-name");
  if (accountNameEl) {
    accountNameEl.textContent = `@${myHandle}`;
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

  // If no tweets at all in storage
  if (tweetList.length === 0) {
    document.getElementById("status-tag").textContent = "等待页面数据";
    document.getElementById("status-tag").className = "tag";
    const totalViewsEl = document.getElementById("total-views");
    if (totalViewsEl) totalViewsEl.textContent = "0";
    const totalHourlyEl = document.getElementById("total-hourly-rate");
    if (totalHourlyEl) totalHourlyEl.textContent = "0/h";
    document.getElementById("delta-heat").textContent = "+0";
    const deltaTotEl = document.getElementById("delta-total");
    if (deltaTotEl) deltaTotEl.textContent = "+0";
    document.getElementById("delta-rate").textContent = "未检测到推文";
    document.getElementById("monitored-count").textContent = "监控中: 0";
    document.getElementById("posts-container").innerHTML = `
      <div style="color:#94a3b8; font-size:11px; text-align:center; padding: 22px 10px; line-height:1.6;">
        ⚡ <b>实时监控就绪</b><br>
        当前正在专属监控 <b style="color:#38bdf8;">@${myHandle}</b>。<br>
        请在浏览器中打开 <a href="https://x.com/${myHandle}" target="_blank" style="color:#38bdf8;">x.com/${myHandle}</a> 浏览主页，推文旁将自动标出专属增量与时速！
      </div>
    `;
    document.getElementById("last-update").textContent = "打开 x.com 即可实时标记";
    return;
  }

  // If user selected "我的帖子" but has not matched own tweets yet
  if (currentTab === "own" && ownTweets.length === 0) {
    document.getElementById("status-tag").textContent = "专属监控中";
    document.getElementById("status-tag").className = "tag live";
    const totalViewsEl = document.getElementById("total-views");
    if (totalViewsEl) totalViewsEl.textContent = "0";
    const totalHourlyEl = document.getElementById("total-hourly-rate");
    if (totalHourlyEl) totalHourlyEl.textContent = "0/h";
    document.getElementById("delta-heat").textContent = "+0";
    const deltaTotEl = document.getElementById("delta-total");
    if (deltaTotEl) deltaTotEl.textContent = "+0";
    document.getElementById("delta-rate").textContent = "等待主页浏览";
    document.getElementById("monitored-count").textContent = "我的帖子: 0";

    // Zero out grid
    document.getElementById("d-likes").innerHTML = `0 <span style="font-size:10px; color:#94a3b8;">(+0)</span>`;
    document.getElementById("d-rts").innerHTML = `0 <span style="font-size:10px; color:#94a3b8;">(+0)</span>`;
    document.getElementById("d-replies").innerHTML = `0 <span style="font-size:10px; color:#94a3b8;">(+0)</span>`;
    document.getElementById("d-bookmarks").innerHTML = `0 <span style="font-size:10px; color:#94a3b8;">(+0)</span>`;
    document.getElementById("d-views").innerHTML = `0 <span style="font-size:10px; color:#94a3b8;">(+0)</span>`;
    const dSpeedEl = document.getElementById("d-speed");
    if (dSpeedEl) dSpeedEl.textContent = "0/h";

    document.getElementById("posts-container").innerHTML = `
      <div style="background:rgba(56,189,248,0.06); border:1px dashed rgba(56,189,248,0.25); border-radius:10px; padding:16px 12px; text-align:center; color:#94a3b8; font-size:11px; line-height:1.7;">
        <div style="font-size:24px; margin-bottom:4px;">👤</div>
        <b style="color:#38bdf8; font-size:12.5px;">专属账号已锁定: @${myHandle}</b><br>
        当前在信息流已缓存 ${tweetList.length} 条推文。<br>
        请在 X 打开 <a href="https://x.com/${myHandle}" target="_blank" style="color:#38bdf8; text-decoration:underline;">个人主页 (Profile)</a> 浏览自己的推文，即可立即呈现！
        <div style="margin-top:10px; display:flex; justify-content:center; gap:8px;">
          <button id="btn-force-scan" style="background:#0284c7; border:none; color:#fff; border-radius:6px; padding:5px 12px; font-size:11px; font-weight:600; cursor:pointer;">
            🔄 立即扫描主页推文
          </button>
          <button id="btn-change-handle" style="background:rgba(255,255,255,0.08); border:1px solid rgba(255,255,255,0.15); color:#cbd5e1; border-radius:6px; padding:5px 12px; font-size:11px; cursor:pointer;">
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

    return;
  }

  document.getElementById("status-tag").textContent = `${intervalM}m 实时监控中`;
  document.getElementById("status-tag").className = "tag live";

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

  // Hero Card Summary: Shows Total Views + Hourly Velocity + 3m Delta + Lifetime Delta
  const totalViewsEl = document.getElementById("total-views");
  if (totalViewsEl) totalViewsEl.textContent = formatNumber(totalViews);

  const totalHourlyEl = document.getElementById("total-hourly-rate");
  if (totalHourlyEl) {
    totalHourlyEl.textContent = totalHourlyRate >= 10000
      ? `${(totalHourlyRate / 1000).toFixed(1)}k/h`
      : `${totalHourlyRate}/h`;
  }

  const deltaHeatEl = document.getElementById("delta-heat");
  if (deltaHeatEl) deltaHeatEl.textContent = `+${totalDeltaViews}`;

  const deltaTotEl = document.getElementById("delta-total");
  if (deltaTotEl) deltaTotEl.textContent = `+${totalLifetimeDeltaViews}`;
  
  const rateEl = document.getElementById("delta-rate");
  if (totalDeltaViews >= 50 || totalHourlyRate >= 500) {
    rateEl.textContent = "🔥 爆款推流中";
    rateEl.style.background = "rgba(244, 63, 94, 0.2)";
    rateEl.style.color = "#fb7185";
  } else if (totalDeltaViews >= 5 || totalHourlyRate >= 80) {
    rateEl.textContent = "⚡ 正在加速推流";
    rateEl.style.background = "rgba(16, 185, 129, 0.2)";
    rateEl.style.color = "#34d399";
  } else {
    rateEl.textContent = "☕ 平稳推流";
    rateEl.style.background = "rgba(100, 116, 139, 0.2)";
    rateEl.style.color = "#94a3b8";
  }

  // Breakdown with Total and (+Delta)
  document.getElementById("d-likes").innerHTML = `${formatNumber(totalBreakdown.likesTotal)} <span style="font-size:10px; color:#94a3b8;">(+${totalBreakdown.likes})</span>`;
  document.getElementById("d-rts").innerHTML = `${formatNumber(totalBreakdown.retweetsTotal)} <span style="font-size:10px; color:#94a3b8;">(+${totalBreakdown.retweets})</span>`;
  document.getElementById("d-replies").innerHTML = `${formatNumber(totalBreakdown.repliesTotal)} <span style="font-size:10px; color:#94a3b8;">(+${totalBreakdown.replies})</span>`;
  document.getElementById("d-bookmarks").innerHTML = `${formatNumber(totalBreakdown.bookmarksTotal)} <span style="font-size:10px; color:#94a3b8;">(+${totalBreakdown.bookmarks})</span>`;
  document.getElementById("d-views").innerHTML = `${formatNumber(totalBreakdown.viewsTotal)} <span style="font-size:10px; color:#94a3b8;">(+${totalBreakdown.views})</span>`;

  const dSpeedEl = document.getElementById("d-speed");
  if (dSpeedEl) {
    dSpeedEl.textContent = totalHourlyRate >= 10000
      ? `${(totalHourlyRate / 1000).toFixed(1)}k/h`
      : `${totalHourlyRate}/h`;
  }

  // Time
  document.getElementById("last-update").textContent = `更新: ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;

  // Sort: prioritize tweets with recent view changes or highest velocity
  activeTweets.sort((a, b) => (b.dPeriod.views * 2 + b.hourlyVelocity) - (a.dPeriod.views * 2 + a.hourlyVelocity) || (b.dTot.views - a.dTot.views));

  // Render list
  document.getElementById("monitored-count").textContent = `${currentTab === "own" ? "我的帖子" : "已监控"}: ${activeTweets.length} 条`;
  renderPostsList(activeTweets, intervalM);

  // Sparkline
  drawSparkline(activeTweets.map(t => ({ heatDelta: t.dPeriod.views + t.dPeriod.likes * 5 })));
}

function renderPostsList(tweets, intervalM = 10) {
  const container = document.getElementById("posts-container");
  container.innerHTML = "";

  tweets.slice(0, 10).forEach((t) => {
    const card = document.createElement("div");
    card.className = "post-card";
    const c = t.current || {};
    const dp = t.dPeriod || {};
    const dt = t.dTot || {};

    card.innerHTML = `
      <div class="post-text">${escapeHtml(t.text)}</div>
      <div class="post-stats">
        <span>👁️ <b>${formatNumber(c.views)}</b> 总阅 <span style="color:#fbbf24; font-weight:700; margin-left:3px;">⚡ ${t.formattedHourlyRate}</span> · ❤️ ${formatNumber(c.likes)} · 💬 ${formatNumber(c.replies)}</span>
        <span class="post-delta" style="color: #34d399;">${intervalM}m: <b>+${dp.views || 0}</b> | 累计: <b style="color:#38bdf8;">+${dt.views || 0}</b></span>
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
