/**
 * X Heat Pulse - Background Service Worker (v1.4.2)
 * Network-grade metric collection, rate limiting, and differential analysis.
 * Exclusively monitors and aggregates the creator's own posts for the toolbar badge.
 */

const DEFAULT_CONFIG = {
  intervalMinutes: 10,
  alertThreshold: 40,
  enableNotification: true,
  myHandle: "sben96001",
  weights: {
    views: 0.01,
    likes: 2.0,
    retweets: 5.0,
    replies: 3.0,
    bookmarks: 4.0
  },
  apiToken: "" // Optional user-provided X API v2 Bearer Token
};

// 1. Extension Lifecycle: setup alarms, defaults, and auto-inject into open tabs
chrome.runtime.onInstalled.addListener(async () => {
  console.log("[X-Heat-Pulse] Extension initialized/updated.");
  const existing = await chrome.storage.local.get(["config", "my_user_handle"]);
  let cfg = existing.config || DEFAULT_CONFIG;
  if (!existing.config || existing.config.intervalMinutes === 5 || existing.config.intervalMinutes === 3) {
    cfg = { ...cfg, intervalMinutes: 10, myHandle: cfg.myHandle || "sben96001" };
    await chrome.storage.local.set({ config: cfg });
  }
  if (!existing.my_user_handle) {
    await chrome.storage.local.set({ my_user_handle: "sben96001" });
  }

  // Setup periodic alarm
  setupAlarm(cfg.intervalMinutes);

  // Auto-inject content script into open Twitter/X tabs so users don't need manual reload
  try {
    const tabs = await chrome.tabs.query({ url: ["https://x.com/*", "https://twitter.com/*"] });
    for (const tab of tabs) {
      if (tab.id) {
        chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content_script.js"]
        }).catch(() => {});
        chrome.scripting.insertCSS({
          target: { tabId: tab.id },
          files: ["content_style.css"]
        }).catch(() => {});
      }
    }
  } catch (e) {
    console.warn("[X-Heat-Pulse] Tab auto-injection skipped:", e);
  }

  // Trigger immediate sample
  executePollingCycle("INSTALL_INIT").catch(err => {
    console.warn("[X-Heat-Pulse] Initial sample notice:", err);
  });
});

// Setup or update alarm
function setupAlarm(intervalMinutes) {
  chrome.alarms.clear("x_heat_polling", () => {
    chrome.alarms.create("x_heat_polling", {
      periodInMinutes: Math.max(1, intervalMinutes || 10)
    });
    console.log(`[X-Heat-Pulse] Alarm set for every ${intervalMinutes} minutes.`);
  });
}

// 2. Alarm Trigger Listener
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "x_heat_polling") {
    executePollingCycle("ALARM_TRIGGER");
  }
});

// 3. Runtime Message Listener (Popup & Options commands)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "FORCE_POLL") {
    executePollingCycle("MANUAL_REFRESH").then(result => {
      sendResponse({ status: "success", data: result });
    }).catch(err => {
      sendResponse({ status: "error", message: err.message });
    });
    return true; // Keep message port open for async response
  }

  if (request.action === "UPDATE_CONFIG") {
    chrome.storage.local.get("config", (res) => {
      const newConfig = { ...res.config, ...request.config };
      chrome.storage.local.set({ config: newConfig }, () => {
        setupAlarm(newConfig.intervalMinutes);
        sendResponse({ status: "ok" });
      });
    });
    return true;
  }
});

// 4. Core Differential Polling Cycle
async function executePollingCycle(source = "SCHEDULED") {
  const timestamp = Date.now();
  console.log(`[X-Heat-Pulse] Starting polling cycle. Source: ${source}, Time: ${new Date(timestamp).toISOString()}`);

  const storage = await chrome.storage.local.get(["config", "last_metrics", "history", "account_info", "tweet_records", "my_user_handle"]);
  const config = storage.config || DEFAULT_CONFIG;
  const history = storage.history || [];
  const tweetRecords = storage.tweet_records || {};
  const myHandle = (storage.my_user_handle || config.myHandle || "sben96001").trim().toLowerCase();

  try {
    const allRecords = Object.values(tweetRecords);
    const ownRecords = allRecords.filter(t => t.isOwnTweet || (myHandle && t.author && t.author.toLowerCase() === myHandle));

    // Calculate view totals, increments, and hourly velocity specifically for user's own posts
    let totalOwnViews = 0;
    let totalOwnViewsDelta = 0;
    let totalLifetimeDelta = 0;
    let totalHourlyRate = 0;
    const intervalMinutes = config.intervalMinutes || 10;
    const targetIntervalMs = intervalMinutes * 60 * 1000;

    if (ownRecords.length > 0) {
      for (const item of ownRecords) {
        const snaps = item.snapshots || [];
        if (snaps.length > 0) {
          const curr = snaps[snaps.length - 1];
          const first = item.firstSeenMetrics || snaps[0];
          const pubTime = item.publishedAt || item.firstSeenAt || timestamp;
          const pubAgeHours = Math.max(0.016, (timestamp - pubTime) / (1000 * 60 * 60));
          const hRate = Math.round((curr.views || 0) / pubAgeHours);
          totalHourlyRate += hRate;

          let baseSnap = snaps[0];
          let minDiff = Infinity;
          for (const s of snaps) {
            const diff = Math.abs(s.t - (timestamp - targetIntervalMs));
            if (diff < minDiff) {
              minDiff = diff;
              baseSnap = s;
            }
          }
          const dViews = Math.max(0, (curr.views || 0) - (baseSnap.views || 0));
          const dLife = Math.max(0, (curr.views || 0) - (first.views || 0));
          totalOwnViews += (curr.views || 0);
          totalOwnViewsDelta += dViews;
          totalLifetimeDelta += dLife;
        }
      }
    }

    // Update Chrome toolbar badge icon: displays live delta if positive, or total views if steady
    updateToolbarBadge(totalOwnViewsDelta, totalOwnViews, totalLifetimeDelta, totalHourlyRate, ownRecords.length > 0, myHandle, intervalMinutes);

    // Save polling status
    await chrome.storage.local.set({
      last_poll_status: {
        success: true,
        timestamp,
        totalOwnViews,
        totalOwnViewsDelta,
        totalLifetimeDelta,
        totalHourlyRate,
        monitoredOwnCount: ownRecords.length
      }
    });

    // Burst Alert Notification if own tweets spike
    if (config.enableNotification && (totalOwnViewsDelta >= config.alertThreshold || totalHourlyRate >= 500) && ownRecords.length > 0) {
      triggerNotification(totalOwnViewsDelta, totalHourlyRate, ownRecords[0]);
    }

    return { totalOwnViews, totalOwnViewsDelta, totalLifetimeDelta, totalHourlyRate, ownRecordsCount: ownRecords.length };
  } catch (error) {
    console.error("[X-Heat-Pulse] Polling cycle failed:", error);
    chrome.action.setBadgeText({ text: "ERR" });
    chrome.action.setBadgeBackgroundColor({ color: "#EF4444" });
    throw error;
  }
}

// 5. Update Action Badge UI (Exclusively displays user's own post view metrics)
function updateToolbarBadge(viewsDelta, totalOwnViews, totalLifetimeDelta, totalHourlyRate, hasOwnPosts, myHandle = "sben96001", intervalMinutes = 10) {
  if (!hasOwnPosts) {
    chrome.action.setBadgeText({ text: "" });
    chrome.action.setTitle({ title: `X Heat Pulse: 正在等待检测 @${myHandle} 的推文` });
    return;
  }
  if (viewsDelta > 0) {
    const text = viewsDelta > 999 ? `${(viewsDelta / 1000).toFixed(1)}k` : `+${viewsDelta}`;
    chrome.action.setBadgeText({ text });
    if (viewsDelta >= 50 || totalHourlyRate >= 500) {
      chrome.action.setBadgeBackgroundColor({ color: "#F43F5E" }); // Hot rose
    } else {
      chrome.action.setBadgeBackgroundColor({ color: "#10B981" }); // Emerald green
    }
  } else {
    // Show total views instead of misleading 0 to eliminate false perception of data loss!
    const text = totalOwnViews > 9999 ? `${(totalOwnViews / 1000).toFixed(1)}k` : `${totalOwnViews}`;
    chrome.action.setBadgeText({ text });
    chrome.action.setBadgeBackgroundColor({ color: "#334155" }); // Neutral slate dark
  }

  const pushState = (viewsDelta >= 50 || totalHourlyRate >= 500)
    ? "🔥 爆款推流中"
    : (viewsDelta >= 5 || totalHourlyRate >= 80)
      ? "⚡ 正在加速推流"
      : "☕ 平稳推流";

  chrome.action.setTitle({
    title: `X Heat Pulse 监控中心 (@${myHandle})\n推流态势: ${pushState}\n当前总曝光: ${totalOwnViews} 次\n时增均速: ~${totalHourlyRate} 阅/小时 (浏览/发布时间)\n近${intervalMinutes}分钟增量: +${viewsDelta} 次\n监控累计增量: +${totalLifetimeDelta} 次`
  });
}

// 6. Trigger Chrome Notification for traffic spikes
function triggerNotification(viewsDelta, totalHourlyRate, topTweet) {
  const tweetSnippet = topTweet ? `推文: "${(topTweet.text || '').substring(0, 40)}..."` : "";
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: `🔥 X 专属推文开始爆流! (时速 ~${totalHourlyRate}/h)`,
    message: `您的账号推文在近3分钟增量 +${viewsDelta} 次，时增均速达 ~${totalHourlyRate} 阅/小时！\n${tweetSnippet}`,
    priority: 2
  });
}
