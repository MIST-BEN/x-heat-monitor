/**
 * X Heat Pulse - Background Service Worker
 * Network-grade metric collection, rate limiting, and differential analysis.
 */

const DEFAULT_CONFIG = {
  intervalMinutes: 5,
  alertThreshold: 50,
  enableNotification: true,
  weights: {
    views: 0.01,
    likes: 2.0,
    retweets: 5.0,
    replies: 3.0,
    bookmarks: 4.0
  },
  apiToken: "" // Optional user-provided X API v2 Bearer Token
};

// 1. Extension Lifecycle: setup alarms and defaults
chrome.runtime.onInstalled.addListener(async () => {
  console.log("[X-Heat-Pulse] Extension initialized.");
  const existing = await chrome.storage.local.get("config");
  if (!existing.config) {
    await chrome.storage.local.set({ config: DEFAULT_CONFIG });
  }

  // Setup periodic alarm
  setupAlarm(DEFAULT_CONFIG.intervalMinutes);

  // Trigger immediate sample
  executePollingCycle("INSTALL_INIT").catch(err => {
    console.warn("[X-Heat-Pulse] Initial sample notice:", err);
  });
});

// Setup or update alarm
function setupAlarm(intervalMinutes) {
  chrome.alarms.clear("x_heat_polling", () => {
    chrome.alarms.create("x_heat_polling", {
      periodInMinutes: Math.max(1, intervalMinutes || 5)
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

  const storage = await chrome.storage.local.get(["config", "last_metrics", "history", "account_info"]);
  const config = storage.config || DEFAULT_CONFIG;
  const history = storage.history || [];
  const lastMetrics = storage.last_metrics || null;

  try {
    // Collect metrics from X
    const metricResult = await fetchXMetrics(config);

    if (!metricResult || !metricResult.tweets || metricResult.tweets.length === 0) {
      console.warn("[X-Heat-Pulse] No tweets returned or account not authenticated.");
      chrome.action.setBadgeText({ text: "ERR" });
      chrome.action.setBadgeBackgroundColor({ color: "#EF4444" });
      return null;
    }

    const currentData = metricResult.tweets;
    const accountInfo = metricResult.account;

    // Differential Calculation
    let totalDeltaHeat = 0;
    const deltaBreakdown = {
      views: 0,
      likes: 0,
      retweets: 0,
      replies: 0,
      bookmarks: 0
    };

    const tweetDeltas = [];

    if (lastMetrics && lastMetrics.data) {
      const prevMap = new Map(lastMetrics.data.map(t => [t.id, t.metrics]));
      const intervalMs = timestamp - lastMetrics.timestamp;

      // Avoid calculating huge delta if paused/offline for over 2x interval
      const maxInterval = (config.intervalMinutes * 2 + 2) * 60 * 1000;
      const isWindowValid = intervalMs <= maxInterval;

      if (isWindowValid) {
        for (const tweet of currentData) {
          const prev = prevMap.get(tweet.id) || { views: 0, likes: 0, retweets: 0, replies: 0, bookmarks: 0 };
          const curr = tweet.metrics;

          // Monotonic guard (Math.max(0, ...)) to suppress X eventual consistency jitter
          const dViews = Math.max(0, (curr.views || 0) - (prev.views || 0));
          const dLikes = Math.max(0, (curr.likes || 0) - (prev.likes || 0));
          const dRetweets = Math.max(0, (curr.retweets || 0) - (prev.retweets || 0));
          const dReplies = Math.max(0, (curr.replies || 0) - (prev.replies || 0));
          const dBookmarks = Math.max(0, (curr.bookmarks || 0) - (prev.bookmarks || 0));

          const tweetHeatDelta = Math.round(
            dViews * config.weights.views +
            dLikes * config.weights.likes +
            dRetweets * config.weights.retweets +
            dReplies * config.weights.replies +
            dBookmarks * config.weights.bookmarks
          );

          deltaBreakdown.views += dViews;
          deltaBreakdown.likes += dLikes;
          deltaBreakdown.retweets += dRetweets;
          deltaBreakdown.replies += dReplies;
          deltaBreakdown.bookmarks += dBookmarks;

          totalDeltaHeat += tweetHeatDelta;

          if (tweetHeatDelta > 0 || (curr.views || 0) > 0) {
            tweetDeltas.push({
              id: tweet.id,
              text: tweet.text,
              heatDelta: tweetHeatDelta,
              delta: { views: dViews, likes: dLikes, retweets: dRetweets, replies: dReplies, bookmarks: dBookmarks },
              current: curr
            });
          }
        }
      } else {
        console.log("[X-Heat-Pulse] Time gap exceeded threshold, resetting baseline.");
      }
    }

    // Sort tweets by heat delta descending
    tweetDeltas.sort((a, b) => b.heatDelta - a.heatDelta);

    // Record to time-series history
    const sampleRecord = {
      timestamp,
      heatDelta: totalDeltaHeat,
      breakdown: deltaBreakdown,
      monitoredTweetsCount: currentData.length,
      topTweet: tweetDeltas[0] || null
    };

    history.push(sampleRecord);
    // Keep 288 points (24 hours at 5-minute sampling)
    if (history.length > 288) {
      history.shift();
    }

    // Persist new state
    await chrome.storage.local.set({
      last_metrics: {
        timestamp,
        data: currentData
      },
      history,
      account_info: accountInfo,
      last_poll_status: {
        success: true,
        timestamp,
        totalDeltaHeat
      }
    });

    // Update Extension Badge
    updateBadge(totalDeltaHeat);

    // Burst Alert Notification
    if (config.enableNotification && totalDeltaHeat >= config.alertThreshold && lastMetrics) {
      triggerNotification(totalDeltaHeat, sampleRecord.topTweet);
    }

    return sampleRecord;
  } catch (error) {
    console.error("[X-Heat-Pulse] Polling cycle failed:", error);
    await chrome.storage.local.set({
      last_poll_status: {
        success: false,
        timestamp,
        error: error.message
      }
    });
    chrome.action.setBadgeText({ text: "ERR" });
    chrome.action.setBadgeBackgroundColor({ color: "#EF4444" });
    throw error;
  }
}

// 5. Update Action Badge UI
function updateBadge(heatDelta) {
  if (heatDelta > 0) {
    const text = heatDelta > 999 ? `${(heatDelta / 1000).toFixed(1)}k` : `+${heatDelta}`;
    chrome.action.setBadgeText({ text });
    if (heatDelta >= 50) {
      chrome.action.setBadgeBackgroundColor({ color: "#F59E0B" }); // Gold/High heat
    } else {
      chrome.action.setBadgeBackgroundColor({ color: "#10B981" }); // Emerald green
    }
  } else {
    chrome.action.setBadgeText({ text: "0" });
    chrome.action.setBadgeBackgroundColor({ color: "#64748B" }); // Slate grey
  }
}

// 6. Trigger Chrome Notification for traffic spikes
function triggerNotification(heatDelta, topTweet) {
  const tweetSnippet = topTweet ? `Top推文: "${topTweet.text.substring(0, 40)}..." (+${topTweet.heatDelta})` : "";
  chrome.notifications.create({
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: `🔥 X 热度激增提醒: +${heatDelta} (5min)`,
    message: `检测到您的账号推文在最近5分钟内热度显著爆发！\n${tweetSnippet}`,
    priority: 2
  });
}

// 7. Network Engine: Fetch metrics from X (Cookie Session or Bearer API)
async function fetchXMetrics(config) {
  // Method 1: If user provided Official X API Bearer Token
  if (config.apiToken && config.apiToken.trim() !== "") {
    return await fetchViaOfficialAPI(config.apiToken.trim());
  }

  // Method 2: Inspect active cookies on x.com or twitter.com
  let ct0Cookie = await chrome.cookies.get({ url: "https://x.com", name: "ct0" });
  let authTokenCookie = await chrome.cookies.get({ url: "https://x.com", name: "auth_token" });

  if (!ct0Cookie || !authTokenCookie) {
    ct0Cookie = await chrome.cookies.get({ url: "https://twitter.com", name: "ct0" });
    authTokenCookie = await chrome.cookies.get({ url: "https://twitter.com", name: "auth_token" });
  }

  if (ct0Cookie && authTokenCookie) {
    try {
      const data = await fetchViaWebSession(ct0Cookie.value);
      if (data) return data;
    } catch (e) {
      console.warn("[X-Heat-Pulse] Web session fetch failed, fallback to local buffer/mock:", e);
    }
  }

  // Method 3: Fallback / Mock Generator for testing if not logged in
  return generateDemoMetrics();
}

// Helper: Query X Web Internal GraphQL API
async function fetchViaWebSession(csrfToken) {
  // Query current user's profile to resolve screen_name
  const userResp = await fetch("https://x.com/i/api/1.1/account/settings.json", {
    headers: {
      "authorization": "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA",
      "x-csrf-token": csrfToken,
      "x-twitter-active-user": "yes"
    }
  });

  if (!userResp.ok) {
    throw new Error(`Account settings request returned HTTP ${userResp.status}`);
  }

  const userSettings = await userResp.json();
  const screenName = userSettings.screen_name;

  // Retrieve user's recent tweets
  const tweetsResp = await fetch(`https://x.com/i/api/1.1/statuses/user_timeline.json?screen_name=${screenName}&count=10&tweet_mode=extended`, {
    headers: {
      "authorization": "Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA",
      "x-csrf-token": csrfToken,
      "x-twitter-active-user": "yes"
    }
  });

  if (!tweetsResp.ok) {
    throw new Error(`Timeline fetch returned HTTP ${tweetsResp.status}`);
  }

  const timeline = await tweetsResp.json();
  const tweets = timeline.map(item => ({
    id: item.id_str,
    text: item.full_text || item.text,
    created_at: item.created_at,
    metrics: {
      views: item.ext_views ? parseInt(item.ext_views.count || 0) : 0,
      likes: item.favorite_count || 0,
      retweets: item.retweet_count || 0,
      replies: item.reply_count || 0,
      bookmarks: item.bookmark_count || 0
    }
  }));

  return {
    account: {
      screen_name: screenName,
      name: screenName,
      type: "session_authenticated"
    },
    tweets
  };
}

// Helper: Query via Official X API v2
async function fetchViaOfficialAPI(bearerToken) {
  const meResp = await fetch("https://api.twitter.com/2/users/me", {
    headers: { "Authorization": `Bearer ${bearerToken}` }
  });
  if (!meResp.ok) throw new Error(`API Me error: ${meResp.status}`);
  const meData = await meResp.json();
  const userId = meData.data.id;

  const tweetsResp = await fetch(
    `https://api.twitter.com/2/users/${userId}/tweets?max_results=10&tweet.fields=public_metrics,created_at`,
    { headers: { "Authorization": `Bearer ${bearerToken}` } }
  );
  if (!tweetsResp.ok) throw new Error(`API Tweets error: ${tweetsResp.status}`);
  const tweetsData = await tweetsResp.json();

  const tweets = (tweetsData.data || []).map(item => ({
    id: item.id,
    text: item.text,
    created_at: item.created_at,
    metrics: {
      views: item.public_metrics?.impression_count || 0,
      likes: item.public_metrics?.like_count || 0,
      retweets: item.public_metrics?.retweet_count || 0,
      replies: item.public_metrics?.reply_count || 0,
      bookmarks: item.public_metrics?.bookmark_count || 0
    }
  }));

  return {
    account: {
      screen_name: meData.data.username,
      name: meData.data.name,
      type: "api_v2_authenticated"
    },
    tweets
  };
}

// Helper: Realistic Demo Metrics Generator (When no session/API is detected)
let mockCache = null;
function generateDemoMetrics() {
  if (!mockCache) {
    mockCache = [
      {
        id: "mock_tweet_101",
        text: "深入剖析现代数据中心的 BGP EVPN 架构设计与状态同步机制 #Networking #BGP",
        created_at: new Date(Date.now() - 3600000).toISOString(),
        metrics: { views: 1840, likes: 62, retweets: 14, replies: 9, bookmarks: 28 }
      },
      {
        id: "mock_tweet_102",
        text: "写了一个检测自己 X 账号帖子热度一阶差分的 Chrome 插件，5分钟周期采样吞吐量！",
        created_at: new Date(Date.now() - 7200000).toISOString(),
        metrics: { views: 3200, likes: 145, retweets: 35, replies: 22, bookmarks: 64 }
      }
    ];
  } else {
    // Add realistic 5-min incremental drift
    mockCache.forEach(t => {
      t.metrics.views += Math.floor(Math.random() * 25) + 5;
      if (Math.random() > 0.4) t.metrics.likes += Math.floor(Math.random() * 3) + 1;
      if (Math.random() > 0.7) t.metrics.retweets += 1;
      if (Math.random() > 0.8) t.metrics.replies += 1;
      if (Math.random() > 0.6) t.metrics.bookmarks += 1;
    });
  }

  return {
    account: {
      screen_name: "NetworkEngineer_Demo",
      name: "Network Ops (Demo Mode)",
      type: "demo_simulation"
    },
    tweets: JSON.parse(JSON.stringify(mockCache))
  };
}
