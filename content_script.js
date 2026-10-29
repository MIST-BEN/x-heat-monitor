/**
 * X Heat Pulse - In-Page Tweet Heat Differential Injector
 * Directly reads rendered DOM metrics on x.com / twitter.com,
 * computes 5-minute first-order deltas, and injects real-time badges onto tweets.
 */

(function () {
  'use strict';

  console.log('[X-Heat-Pulse] Content script active on X.com.');

  const WEIGHTS = {
    views: 0.01,
    likes: 2.0,
    retweets: 5.0,
    replies: 3.0,
    bookmarks: 4.0
  };

  // Debounce helper
  let isScanning = false;
  let scanTimeout = null;

  function scheduleScan() {
    if (scanTimeout) clearTimeout(scanTimeout);
    scanTimeout = setTimeout(processAllVisibleTweets, 300);
  }

  // Number parser: handles 1,234, 1.2K, 3.5万, 1.5M, etc.
  function parseMetricNumber(rawText) {
    if (!rawText) return 0;
    const clean = rawText.trim().replace(/,/g, '');
    const match = clean.match(/([\d.]+)\s*([kKmMwW万亿])?/);
    if (!match) {
      const digits = clean.replace(/[^\d]/g, '');
      return digits ? parseInt(digits, 10) : 0;
    }

    let num = parseFloat(match[1]);
    const unit = match[2];
    if (unit === 'k' || unit === 'K') num *= 1000;
    else if (unit === 'w' || unit === 'W' || unit === '万') num *= 10000;
    else if (unit === 'm' || unit === 'M') num *= 1000000;
    else if (unit === '亿') num *= 100000000;

    return Math.round(num);
  }

  // Extract count from button or link (checks inner text and aria-label)
  function extractElementCount(container) {
    if (!container) return 0;

    // 1. Check direct visible text inside spans
    const textSpans = container.querySelectorAll('span');
    for (const span of textSpans) {
      const text = span.textContent?.trim();
      if (text && /^[\d.,KMwW万亿]+$/.test(text)) {
        return parseMetricNumber(text);
      }
    }

    // 2. Check aria-label
    const aria = container.getAttribute('aria-label');
    if (aria) {
      const numMatch = aria.match(/([\d.,]+)\s*([kKmMwW万亿])?/);
      if (numMatch) {
        return parseMetricNumber(numMatch[0]);
      }
    }

    return 0;
  }

  // Extract metrics from single tweet element
  function extractTweetMetrics(tweetArticle) {
    // 1. Tweet ID
    const statusLinks = tweetArticle.querySelectorAll('a[href*="/status/"]');
    let tweetId = null;
    let author = "";

    for (const link of statusLinks) {
      const href = link.getAttribute('href') || '';
      const match = href.match(/\/([^\/]+)\/status\/(\d+)/);
      if (match) {
        author = match[1];
        tweetId = match[2];
        break;
      }
    }

    if (!tweetId) return null;

    // 2. Tweet Text snippet
    const textNode = tweetArticle.querySelector('div[data-testid="tweetText"]');
    const text = textNode ? textNode.textContent.trim().substring(0, 80) : "";

    // 3. Extract Views
    const analyticsLink = tweetArticle.querySelector('a[href*="/analytics"]');
    const views = extractElementCount(analyticsLink);

    // 4. Extract Likes
    const likeBtn = tweetArticle.querySelector('button[data-testid="like"], button[data-testid="unlike"]');
    const likes = extractElementCount(likeBtn);

    // 5. Extract Retweets
    const rtBtn = tweetArticle.querySelector('button[data-testid="retweet"], button[data-testid="unretweet"]');
    const retweets = extractElementCount(rtBtn);

    // 6. Extract Replies
    const replyBtn = tweetArticle.querySelector('button[data-testid="reply"]');
    const replies = extractElementCount(replyBtn);

    // 7. Extract Bookmarks
    const bookmarkBtn = tweetArticle.querySelector('button[data-testid="bookmark"], button[data-testid="removeBookmark"]');
    const bookmarks = extractElementCount(bookmarkBtn);

    // 8. Action bar
    const actionGroup = tweetArticle.querySelector('div[role="group"]');

    return {
      tweetId,
      author,
      text,
      metrics: { views, likes, retweets, replies, bookmarks },
      actionGroup
    };
  }

  // Main scanning and injection routine
  async function processAllVisibleTweets() {
    if (isScanning) return;
    isScanning = true;

    try {
      const tweetArticles = document.querySelectorAll('article[data-testid="tweet"]');
      if (tweetArticles.length === 0) {
        isScanning = false;
        return;
      }

      // Read current storage cache
      const storage = await chrome.storage.local.get(["tweet_records", "config"]);
      const tweetRecords = storage.tweet_records || {};
      const config = storage.config || { weights: WEIGHTS, intervalMinutes: 5 };
      const weights = config.weights || WEIGHTS;
      const targetIntervalMs = (config.intervalMinutes || 5) * 60 * 1000;
      const now = Date.now();

      let hasNewRecords = false;

      tweetArticles.forEach((article) => {
        const data = extractTweetMetrics(article);
        if (!data || !data.actionGroup) return;

        const { tweetId, author, text, metrics, actionGroup } = data;

        // Initialize or update tweet record
        if (!tweetRecords[tweetId]) {
          tweetRecords[tweetId] = {
            id: tweetId,
            author,
            text,
            firstSeen: now,
            snapshots: []
          };
        }

        const record = tweetRecords[tweetId];
        record.lastSeen = now;
        if (text && !record.text) record.text = text;

        // Determine if we should append a new snapshot
        const lastSnapshot = record.snapshots[record.snapshots.length - 1];
        const shouldSaveNewSnapshot =
          !lastSnapshot ||
          (now - lastSnapshot.t >= 45 * 1000) || // At least 45 seconds between snapshots
          metricsChanged(lastSnapshot, metrics);

        if (shouldSaveNewSnapshot) {
          record.snapshots.push({
            t: now,
            ...metrics
          });

          // Keep max 30 snapshots per tweet
          if (record.snapshots.length > 30) {
            record.snapshots.shift();
          }
          hasNewRecords = true;
        }

        // Calculate 5-minute Delta
        const deltaInfo = compute5MinDelta(record.snapshots, now, targetIntervalMs, weights, metrics);

        // Inject or update visual badge in tweet action bar
        injectOrUpdateBadge(actionGroup, tweetId, deltaInfo);
      });

      // Persist updated records if changed
      if (hasNewRecords) {
        // Limit total stored tweets to most recent 120
        const tweetKeys = Object.keys(tweetRecords);
        if (tweetKeys.length > 120) {
          tweetKeys.sort((a, b) => (tweetRecords[b].lastSeen || 0) - (tweetRecords[a].lastSeen || 0));
          const trimmed = {};
          tweetKeys.slice(0, 120).forEach(k => { trimmed[k] = tweetRecords[k]; });
          await chrome.storage.local.set({ tweet_records: trimmed });
        } else {
          await chrome.storage.local.set({ tweet_records: tweetRecords });
        }
      }
    } catch (err) {
      console.warn('[X-Heat-Pulse] Error during tweet scan:', err);
    } finally {
      isScanning = false;
    }
  }

  function metricsChanged(a, b) {
    return a.views !== b.views || a.likes !== b.likes || a.retweets !== b.retweets || a.replies !== b.replies || a.bookmarks !== b.bookmarks;
  }

  // Calculate 5-min (or nearest) delta
  function compute5MinDelta(snapshots, now, targetIntervalMs, weights, currMetrics) {
    if (!snapshots || snapshots.length === 0) {
      return { status: "INIT", text: "基准建立中", heatDelta: 0, delta: {} };
    }

    // Find snapshot closest to (now - targetIntervalMs)
    const targetTimestamp = now - targetIntervalMs;
    let baseSnapshot = null;
    let minDiff = Infinity;

    // Look for snapshot in acceptable window: [targetTimestamp - 5m, targetTimestamp + 2m]
    for (const snap of snapshots) {
      const diff = Math.abs(snap.t - targetTimestamp);
      if (diff < minDiff) {
        minDiff = diff;
        baseSnapshot = snap;
      }
    }

    // If all snapshots are too fresh (< 1.5 min), compare with earliest snapshot if > 20s old
    const earliest = snapshots[0];
    const ageMs = now - earliest.t;

    let deltaIntervalMin = 0;
    let prev = null;

    if (ageMs < 90 * 1000) {
      // First minute of observation
      return {
        status: "RECORDING",
        pillText: "⏱️ 采样记录中",
        pillClass: "recording",
        heatDelta: 0,
        delta: { views: 0, likes: 0, retweets: 0, replies: 0, bookmarks: 0 },
        current: currMetrics,
        elapsedMinutes: (ageMs / 60000).toFixed(1)
      };
    }

    if (minDiff < targetIntervalMs * 0.7) {
      prev = baseSnapshot;
      deltaIntervalMin = Math.round((now - prev.t) / 60000);
    } else {
      prev = earliest;
      deltaIntervalMin = Math.max(1, Math.round(ageMs / 60000));
    }

    // Calculate first-order deltas with monotonic guard
    const dViews = Math.max(0, currMetrics.views - prev.views);
    const dLikes = Math.max(0, currMetrics.likes - prev.likes);
    const dRetweets = Math.max(0, currMetrics.retweets - prev.retweets);
    const dReplies = Math.max(0, currMetrics.replies - prev.replies);
    const dBookmarks = Math.max(0, currMetrics.bookmarks - prev.bookmarks);

    const heatDelta = Math.round(
      dViews * weights.views +
      dLikes * weights.likes +
      dRetweets * weights.retweets +
      dReplies * weights.replies +
      dBookmarks * weights.bookmarks
    );

    let pillClass = "steady";
    let icon = "☕";
    let pillText = `+0 (${deltaIntervalMin}m)`;

    if (heatDelta >= 30) {
      pillClass = "hot";
      icon = "🔥";
      pillText = `+${heatDelta} (${deltaIntervalMin}m)`;
    } else if (heatDelta > 0) {
      pillClass = "growing";
      icon = "⚡";
      pillText = `+${heatDelta} (${deltaIntervalMin}m)`;
    }

    return {
      status: "ACTIVE",
      pillText: `${icon} ${pillText}`,
      pillClass,
      heatDelta,
      deltaIntervalMin,
      delta: { views: dViews, likes: dLikes, retweets: dRetweets, replies: dReplies, bookmarks: dBookmarks },
      current: currMetrics,
      prevMetrics: prev,
      lastSampleTime: new Date(prev.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };
  }

  // Inject or update in-page pill badge
  function injectOrUpdateBadge(actionGroup, tweetId, info) {
    let container = actionGroup.querySelector(`.x-heat-pulse-badge-container[data-id="${tweetId}"]`);

    if (!container) {
      container = document.createElement('div');
      container.className = 'x-heat-pulse-badge-container';
      container.setAttribute('data-id', tweetId);

      container.innerHTML = `
        <div class="x-heat-pulse-pill ${info.pillClass || 'steady'}">
          <span class="x-heat-pulse-label">${info.pillText}</span>
        </div>
        <div class="x-heat-pulse-tooltip">
          <!-- Dynamic Tooltip -->
        </div>
      `;

      actionGroup.appendChild(container);
    }

    // Update pill text & style class
    const pill = container.querySelector('.x-heat-pulse-pill');
    const label = container.querySelector('.x-heat-pulse-label');
    if (pill && label) {
      pill.className = `x-heat-pulse-pill ${info.pillClass || 'steady'}`;
      label.textContent = info.pillText;
    }

    // Update Tooltip Content
    const tooltip = container.querySelector('.x-heat-pulse-tooltip');
    if (tooltip) {
      if (info.status === "RECORDING") {
        tooltip.innerHTML = `
          <div class="x-heat-pulse-tooltip-header">
            <span>X Heat Pulse 监控中</span>
            <span>刚接入</span>
          </div>
          <div style="color:#e2e8f0; font-size:11px; margin-bottom:4px;">
            已锁定该推文当前基准指标。<br>每 5 分钟将自动计算差分增量。
          </div>
          <div class="x-heat-pulse-tooltip-footer">已观察时长: ${info.elapsedMinutes} 分钟</div>
        `;
      } else {
        const d = info.delta || {};
        const c = info.current || {};
        tooltip.innerHTML = `
          <div class="x-heat-pulse-tooltip-header">
            <span>🔥 5分钟热度差分</span>
            <span style="color:#00ba7c;">+${info.heatDelta} pts</span>
          </div>
          <div class="x-heat-pulse-tooltip-grid">
            <div class="x-heat-pulse-tooltip-item">❤️ 点赞: <b>+${d.likes || 0}</b> <span style="font-size:9px;color:#536471;">(${c.likes})</span></div>
            <div class="x-heat-pulse-tooltip-item">🔁 转发: <b>+${d.retweets || 0}</b> <span style="font-size:9px;color:#536471;">(${c.retweets})</span></div>
            <div class="x-heat-pulse-tooltip-item">💬 回复: <b>+${d.replies || 0}</b> <span style="font-size:9px;color:#536471;">(${c.replies})</span></div>
            <div class="x-heat-pulse-tooltip-item">🔖 收藏: <b>+${d.bookmarks || 0}</b> <span style="font-size:9px;color:#536471;">(${c.bookmarks})</span></div>
            <div class="x-heat-pulse-tooltip-item" style="grid-column: span 2;">👁️ 曝光浏览: <b>+${d.views || 0}</b> <span style="font-size:9px;color:#536471;">(${c.views})</span></div>
          </div>
          <div class="x-heat-pulse-tooltip-footer">
            基准采样: ${info.lastSampleTime || '--'} (约 ${info.deltaIntervalMin} 分钟前)
          </div>
        `;
      }
    }
  }

  // Set up MutationObserver to detect new tweets as user scrolls
  const observer = new MutationObserver((mutations) => {
    let hasRelevantMutation = false;
    for (const m of mutations) {
      if (m.addedNodes.length > 0) {
        hasRelevantMutation = true;
        break;
      }
    }
    if (hasRelevantMutation) {
      scheduleScan();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  // Run initial scan
  scheduleScan();

  // Periodic rescan every 15 seconds to update badges live
  setInterval(scheduleScan, 15000);

})();
