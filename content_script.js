/**
 * X Heat Pulse - In-Page Tweet Heat Differential & Lifetime Tracker (v1.4.2)
 * 1. Automatically detects logged-in user's own handle (@username).
 * 2. Tags user's own tweets with isOwnTweet: true to filter out feed/timeline noise.
 * 3. Default 3-minute high-sensitivity sampling interval.
 * 4. Dual-display badges and dynamic comparison tables with overflow protection.
 * 5. Pill badge exclusively highlights view increments (3m +XX | 累计 +XX) to keep action bar clean.
 * 6. Video/media player isolation ensures badges are always attached to the bottom tweet action bar.
 */

(function () {
  'use strict';

  // Prevent multiple injections in the same frame
  if (window.__X_HEAT_PULSE_LOADED__) {
    console.log('[X-Heat-Pulse] Content script already active. Triggering rescan.');
    if (typeof window.__X_HEAT_PULSE_SCAN__ === 'function') {
      window.__X_HEAT_PULSE_SCAN__();
    }
    return;
  }
  window.__X_HEAT_PULSE_LOADED__ = true;

  console.log('[X-Heat-Pulse] v1.4.2 Content script initialized.');

  const DEFAULT_INTERVAL_MINUTES = 3;
  let isScanning = false;
  let scanTimeout = null;
  let scanInterval = null;
  let observer = null;
  let myHandle = null;

  function isExtensionValid() {
    try {
      return (
        typeof chrome !== 'undefined' &&
        !!chrome.runtime &&
        !!chrome.runtime.id &&
        !!chrome.storage &&
        !!chrome.storage.local
      );
    } catch (e) {
      return false;
    }
  }

  function cleanupOnInvalidation() {
    if (scanInterval) {
      clearInterval(scanInterval);
      scanInterval = null;
    }
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (scanTimeout) {
      clearTimeout(scanTimeout);
      scanTimeout = null;
    }
  }

  async function safeStorageGet(keys) {
    if (!isExtensionValid()) {
      cleanupOnInvalidation();
      return null;
    }
    try {
      return await chrome.storage.local.get(keys);
    } catch (e) {
      cleanupOnInvalidation();
      return null;
    }
  }

  async function safeStorageSet(items) {
    if (!isExtensionValid()) {
      cleanupOnInvalidation();
      return false;
    }
    try {
      await chrome.storage.local.set(items);
      return true;
    } catch (e) {
      cleanupOnInvalidation();
      return false;
    }
  }

  function scheduleScan() {
    if (!isExtensionValid()) {
      cleanupOnInvalidation();
      return;
    }
    if (scanTimeout) clearTimeout(scanTimeout);
    scanTimeout = setTimeout(processAllVisibleTweets, 200);
  }
  window.__X_HEAT_PULSE_SCAN__ = scheduleScan;

  // Multi-tier detection for the logged-in user's handle
  function detectMyHandle() {
    // 1. Scan sidebar navigation links: find link matching /<handle> (100% reliable on desktop X)
    const navLinks = document.querySelectorAll('header[role="banner"] a[href], nav a[href]');
    for (const a of navLinks) {
      const href = a.getAttribute('href') || '';
      const cleanHref = href.replace(/^https?:\/\/[^\/]+/, '').replace(/^\//, '');
      const match = cleanHref.match(/^([a-zA-Z0-9_]{1,15})$/);
      if (match) {
        const handle = match[1];
        if (!['home', 'explore', 'notifications', 'messages', 'i', 'settings', 'search'].includes(handle.toLowerCase())) {
          return handle;
        }
      }
    }

    // 2. Check left navigation banner for user account switcher button
    const switcher = document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
    if (switcher) {
      const match = switcher.textContent?.match(/@([a-zA-Z0-9_]{1,15})/);
      if (match && match[1]) return match[1];
    }

    // 3. Search anywhere inside left navigation header for @username
    const headerBanner = document.querySelector('header[role="banner"]');
    if (headerBanner) {
      const match = headerBanner.textContent?.match(/@([a-zA-Z0-9_]{1,15})/);
      if (match && match[1]) return match[1];
    }

    // 4. Check profile page URL if currently viewing profile
    const pathParts = window.location.pathname.split('/').filter(Boolean);
    if (pathParts.length === 1 && !['home', 'explore', 'notifications', 'messages', 'search', 'settings', 'i'].includes(pathParts[0].toLowerCase())) {
      const editBtn = document.querySelector('[data-testid="editProfileButton"], a[href="/settings/profile"]');
      if (editBtn) {
        return pathParts[0];
      }
    }

    return null;
  }

  // Parse formatted numbers (e.g. 1,234, 1.2K, 3.5万, 1.5M, 97 Views)
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

  // Extract count from button or link (checks title, aria-label, and inner text)
  function extractElementCount(container) {
    if (!container) return 0;

    // 1. Check title attribute first (contains exact number)
    const title = container.getAttribute('title');
    if (title) {
      const match = title.match(/([\d.,]+)\s*([kKmMwW万亿])?/);
      if (match) return parseMetricNumber(match[0]);
    }
    const titleChild = container.querySelector('[title]');
    if (titleChild) {
      const t = titleChild.getAttribute('title');
      const match = t ? t.match(/([\d.,]+)\s*([kKmMwW万亿])?/) : null;
      if (match) return parseMetricNumber(match[0]);
    }

    // 2. Check aria-label
    const aria = container.getAttribute('aria-label');
    if (aria) {
      const numMatch = aria.match(/([\d.,]+)\s*([kKmMwW万亿])?/);
      if (numMatch) {
        return parseMetricNumber(numMatch[0]);
      }
    }

    // 3. Check direct visible text inside spans
    const textSpans = container.querySelectorAll('span');
    for (const span of textSpans) {
      const text = span.textContent?.trim();
      if (text && /^[\d.,KMwW万亿]+$/.test(text)) {
        return parseMetricNumber(text);
      }
    }

    // 4. Direct text content
    const directText = container.textContent?.trim();
    if (directText) {
      const numMatch = directText.match(/([\d.,]+)\s*([kKmMwW万亿])?/);
      if (numMatch) {
        return parseMetricNumber(numMatch[0]);
      }
    }

    return 0;
  }

  // Reliably locate the bottom tweet action bar (avoiding media player controls)
  function findTweetActionGroup(tweetArticle) {
    // 1. Anchor from known interaction buttons (reply, like, retweet, bookmark, analytics)
    const anchorBtn = tweetArticle.querySelector(
      'button[data-testid="reply"], button[data-testid="like"], button[data-testid="retweet"], a[href*="/analytics"], button[data-testid="bookmark"]'
    );
    if (anchorBtn) {
      const group = anchorBtn.closest('div[role="group"]');
      if (group) return group;
    }

    // 2. Fallback: inspect all div[role="group"] elements from bottom up
    const groups = tweetArticle.querySelectorAll('div[role="group"]');
    for (let i = groups.length - 1; i >= 0; i--) {
      const g = groups[i];
      const aria = (g.getAttribute('aria-label') || '').toLowerCase();
      // Exclude audio/video controls
      if (aria.includes('video') || aria.includes('audio') || aria.includes('media') || aria.includes('播放')) {
        continue;
      }
      if (g.querySelector('svg, button')) {
        return g;
      }
    }

    return null;
  }

  // Locate tweet header mount point (the red-box area in top right, immediately left of Grok / Caret ...)
  function findTweetHeaderMountPoint(tweetArticle) {
    const caret = tweetArticle.querySelector('[data-testid="caret"]');
    const userName = tweetArticle.querySelector('[data-testid="User-Name"]');

    if (caret && userName) {
      // Find common ancestor row in header that contains both userName and caret
      let headerRow = caret.parentElement;
      while (headerRow && headerRow !== tweetArticle && !headerRow.contains(userName)) {
        headerRow = headerRow.parentElement;
      }

      if (headerRow && headerRow !== tweetArticle) {
        // Find which top-level direct child of headerRow contains caret
        let rightActionChild = caret;
        while (rightActionChild.parentElement && rightActionChild.parentElement !== headerRow) {
          rightActionChild = rightActionChild.parentElement;
        }

        return {
          parent: headerRow,
          beforeElement: rightActionChild
        };
      }
    }

    if (caret) {
      const parent = caret.parentElement || tweetArticle;
      return {
        parent,
        beforeElement: caret
      };
    }

    if (userName && userName.parentElement) {
      return {
        parent: userName.parentElement,
        beforeElement: null
      };
    }

    return null;
  }

  // Unified mount point resolver prioritizing header top-right, falling back to action bar
  function findTweetMountPoint(tweetArticle) {
    const headerMount = findTweetHeaderMountPoint(tweetArticle);
    if (headerMount && headerMount.parent) {
      return headerMount;
    }

    const actionGroup = findTweetActionGroup(tweetArticle);
    if (actionGroup) {
      return {
        parent: actionGroup,
        beforeElement: null
      };
    }

    return null;
  }

  // Derive mathematically exact publication timestamp directly from Twitter's Snowflake ID
  function getTweetTimestampFromId(tweetId) {
    try {
      if (!tweetId) return null;
      const idBig = BigInt(tweetId);
      const twitterEpoch = 1288834974657n; // Twitter Epoch: 2010-11-04T01:42:54.657Z
      const timestamp = Number((idBig >> 22n) + twitterEpoch);
      if (timestamp > 1288834974657 && timestamp <= Date.now() + 60000) {
        return timestamp;
      }
    } catch (e) {}
    return null;
  }

  // Extract tweet ID, author, and publication timestamp reliably
  function extractTweetIdentity(tweetArticle) {
    let tweetId = null;
    let author = "";
    let publishedAt = null;

    // 0. Extract author directly from tweet header if available
    const userNameEl = tweetArticle.querySelector('[data-testid="User-Name"]');
    if (userNameEl) {
      const match = userNameEl.textContent?.match(/@([a-zA-Z0-9_]{1,15})/);
      if (match && match[1]) {
        author = match[1];
      }
    }

    // 1. Time element link points specifically to the tweet itself and contains ISO datetime
    const timeEl = tweetArticle.querySelector('time');
    if (timeEl) {
      const dtStr = timeEl.getAttribute('datetime');
      if (dtStr) {
        const parsed = new Date(dtStr).getTime();
        if (!isNaN(parsed) && parsed > 0) {
          publishedAt = parsed;
        }
      }
      const link = timeEl.closest('a[href*="/status/"]');
      if (link) {
        const href = link.getAttribute('href') || '';
        const match = href.match(/\/([^\/]+)\/status\/(\d+)/);
        if (match) {
          if (!author) author = match[1];
          tweetId = match[2];
        }
      }
    }

    // 2. Author-specific status link
    if (!tweetId && author) {
      const authorStatusLink = tweetArticle.querySelector(`a[href*="/${author}/status/"]`);
      if (authorStatusLink) {
        const href = authorStatusLink.getAttribute('href') || '';
        const match = href.match(/\/([^\/]+)\/status\/(\d+)/);
        if (match) {
          tweetId = match[2];
        }
      }
    }

    // 3. Check permalink URL if viewing single tweet status page
    if (!tweetId) {
      const pathMatch = window.location.pathname.match(/\/([^\/]+)\/status\/(\d+)/);
      if (pathMatch) {
        const isFocal = tweetArticle.querySelector('div[data-testid="tweetText"]') || tweetArticle.querySelector('h2');
        if (isFocal) {
          if (!author) author = pathMatch[1];
          tweetId = pathMatch[2];
        }
      }
    }

    // 4. Fallback: query status links outside of quoted tweet blocks
    if (!tweetId) {
      const statusLinks = tweetArticle.querySelectorAll('a[href*="/status/"]');
      for (const link of statusLinks) {
        if (link.closest('div[role="link"]') && link.closest('div[role="link"]') !== tweetArticle) {
          continue; // Skip quoted tweet cards
        }
        const href = link.getAttribute('href') || '';
        const match = href.match(/\/([^\/]+)\/status\/(\d+)/);
        if (match) {
          if (!author) author = match[1];
          tweetId = match[2];
          break;
        }
      }
    }

    // 5. Canonical Snowflake Ground-Truth: Extract true publication timestamp from Snowflake ID
    if (tweetId) {
      const snowflakeTime = getTweetTimestampFromId(tweetId);
      if (snowflakeTime) {
        publishedAt = snowflakeTime;
      }
    }

    return { tweetId, author, publishedAt };
  }

  // Extract metrics from single tweet element
  function extractTweetMetrics(tweetArticle) {
    // 1. Tweet ID, Author, and Published Time
    const identity = extractTweetIdentity(tweetArticle);
    if (!identity.tweetId) return null;

    const { tweetId, author, publishedAt } = identity;

    // 2. Tweet Text snippet
    const textNode = tweetArticle.querySelector('div[data-testid="tweetText"]');
    const text = textNode ? textNode.textContent.trim().substring(0, 80) : "";

    // 3. Action bar (strictly the tweet interaction toolbar)
    const actionGroup = findTweetActionGroup(tweetArticle);
    if (!actionGroup) return null;

    // 4. Extract Views
    const analyticsLink = tweetArticle.querySelector('a[href*="/analytics"]');
    const views = extractElementCount(analyticsLink);

    // 5. Extract Likes
    const likeBtn = tweetArticle.querySelector('button[data-testid="like"], button[data-testid="unlike"]');
    const likes = extractElementCount(likeBtn);

    // 6. Extract Retweets
    const rtBtn = tweetArticle.querySelector('button[data-testid="retweet"], button[data-testid="unretweet"]');
    const retweets = extractElementCount(rtBtn);

    // 7. Extract Replies
    const replyBtn = tweetArticle.querySelector('button[data-testid="reply"]');
    const replies = extractElementCount(replyBtn);

    // 8. Extract Bookmarks
    const bookmarkBtn = tweetArticle.querySelector('button[data-testid="bookmark"], button[data-testid="removeBookmark"]');
    const bookmarks = extractElementCount(bookmarkBtn);

    return {
      tweetId,
      author,
      publishedAt,
      text,
      metrics: { views, likes, retweets, replies, bookmarks },
      actionGroup
    };
  }

  function formatElapsedTime(ms) {
    const mins = Math.floor(ms / 60000);
    if (mins < 1) return "刚刚";
    if (mins < 60) return `${mins} 分钟`;
    const hours = (mins / 60).toFixed(1);
    return `${hours} 小时`;
  }

  // Main scanning routine
  async function processAllVisibleTweets() {
    if (isScanning) return;
    if (!isExtensionValid()) {
      return;
    }
    isScanning = true;

    try {
      const tweetArticles = document.querySelectorAll('article[data-testid="tweet"]');
      if (tweetArticles.length === 0) {
        isScanning = false;
        return;
      }

      // Check current user's handle
      const detected = detectMyHandle();

      // Fetch stored tweet records and config
      const storage = await safeStorageGet(["tweet_records", "config", "my_user_handle"]);
      if (!storage) {
        isScanning = false;
        return;
      }
      const tweetRecords = storage.tweet_records || {};
      const config = storage.config || { intervalMinutes: DEFAULT_INTERVAL_MINUTES };
      const intervalMinutes = config.intervalMinutes || DEFAULT_INTERVAL_MINUTES;
      const targetIntervalMs = intervalMinutes * 60 * 1000;
      let savedHandle = (storage.my_user_handle || config.myHandle || detected || myHandle || "sben96001").trim();
      const now = Date.now();

      let hasNewRecords = false;

      if (!storage.my_user_handle) {
        await safeStorageSet({ my_user_handle: savedHandle });
        hasNewRecords = true;
      }

      if (detected && detected.toLowerCase() !== savedHandle.toLowerCase()) {
        savedHandle = detected;
        myHandle = detected;
        await safeStorageSet({ my_user_handle: detected });
        console.log(`[X-Heat-Pulse] Logged-in creator account identified: @${detected}`);
        hasNewRecords = true;
      }

      tweetArticles.forEach((article) => {
        const data = extractTweetMetrics(article);
        if (!data || !data.actionGroup) return;

        const { tweetId, author, publishedAt, text, metrics, actionGroup } = data;

        // Check if tweet belongs to current user
        const isOwn = savedHandle
          ? author.toLowerCase() === savedHandle.toLowerCase()
          : false;

        // Monotonic hydration guard: if tweet was previously recorded with positive metrics,
        // do NOT allow unhydrated 0s during page reload to overwrite real values!
        const existingRecord = tweetRecords[tweetId];
        if (existingRecord) {
          const lastSnap = existingRecord.snapshots && existingRecord.snapshots.length > 0
            ? existingRecord.snapshots[existingRecord.snapshots.length - 1]
            : null;
          if (lastSnap) {
            if (metrics.views === 0 && lastSnap.views > 0) metrics.views = lastSnap.views;
            if (metrics.likes === 0 && lastSnap.likes > 0) metrics.likes = lastSnap.likes;
            if (metrics.retweets === 0 && lastSnap.retweets > 0) metrics.retweets = lastSnap.retweets;
            if (metrics.replies === 0 && lastSnap.replies > 0) metrics.replies = lastSnap.replies;
            if (metrics.bookmarks === 0 && lastSnap.bookmarks > 0) metrics.bookmarks = lastSnap.bookmarks;
          }
        }

        // 1. Initial Baseline: First time user views this tweet
        const canonicalPubTime = publishedAt || getTweetTimestampFromId(tweetId) || now;

        if (!tweetRecords[tweetId]) {
          tweetRecords[tweetId] = {
            id: tweetId,
            author,
            text,
            publishedAt: canonicalPubTime,
            isOwnTweet: isOwn,
            firstSeenAt: now,
            firstSeenMetrics: { ...metrics },
            snapshots: [
              { t: now, ...metrics }
            ]
          };
          hasNewRecords = true;
        } else {
          const rec = tweetRecords[tweetId];
          // Canonical repair: ensure tweet publishedAt reflects true tweet creation timestamp from Snowflake
          if (canonicalPubTime && (!rec.publishedAt || Math.abs(rec.publishedAt - canonicalPubTime) > 10000)) {
            rec.publishedAt = canonicalPubTime;
            hasNewRecords = true;
          }

          // If baseline was initially captured as 0 before React hydration, promote to first positive value
          if (rec.firstSeenMetrics && rec.firstSeenMetrics.views === 0 && metrics.views > 0) {
            rec.firstSeenMetrics.views = metrics.views;
            rec.firstSeenMetrics.likes = rec.firstSeenMetrics.likes || metrics.likes;
            rec.firstSeenMetrics.retweets = rec.firstSeenMetrics.retweets || metrics.retweets;
            rec.firstSeenMetrics.replies = rec.firstSeenMetrics.replies || metrics.replies;
            rec.firstSeenMetrics.bookmarks = rec.firstSeenMetrics.bookmarks || metrics.bookmarks;
            if (rec.snapshots && rec.snapshots[0] && rec.snapshots[0].views === 0) {
              rec.snapshots[0].views = metrics.views;
              rec.snapshots[0].likes = rec.snapshots[0].likes || metrics.likes;
              rec.snapshots[0].retweets = rec.snapshots[0].retweets || metrics.retweets;
              rec.snapshots[0].replies = rec.snapshots[0].replies || metrics.replies;
              rec.snapshots[0].bookmarks = rec.snapshots[0].bookmarks || metrics.bookmarks;
            }
            hasNewRecords = true;
          }
        }

        const record = tweetRecords[tweetId];
        record.lastSeen = now;
        if (text && !record.text) record.text = text;
        if (author && !record.author) record.author = author;

        // If author matches user handle, tag as own post
        if (isOwn && !record.isOwnTweet) {
          record.isOwnTweet = true;
          hasNewRecords = true;
        }

        if (!record.firstSeenMetrics) {
          record.firstSeenMetrics = record.snapshots && record.snapshots.length > 0
            ? { ...record.snapshots[0] }
            : { ...metrics };
          record.firstSeenAt = record.firstSeenAt || (record.snapshots?.[0]?.t) || now;
          hasNewRecords = true;
        }

        // 2. Append Snapshot if 25s elapsed or metrics changed
        const lastSnapshot = record.snapshots[record.snapshots.length - 1];
        const shouldSaveNewSnapshot =
          !lastSnapshot ||
          (now - lastSnapshot.t >= 25 * 1000) ||
          metricsChanged(lastSnapshot, metrics);

        if (shouldSaveNewSnapshot) {
          record.snapshots.push({
            t: now,
            ...metrics
          });

          if (record.snapshots.length > 60) {
            record.snapshots.shift();
          }
          hasNewRecords = true;
        }

        // 3. Compute Period Delta and Total Lifetime Delta
        const deltaInfo = computeDeltas(record, now, targetIntervalMs, metrics, intervalMinutes);

        // 4. Inject or Update Badge in top-right header location
        injectOrUpdateBadge(article, tweetId, deltaInfo, record);
      });

      // Persist to local storage
      if (hasNewRecords && isExtensionValid()) {
        const tweetKeys = Object.keys(tweetRecords);
        if (tweetKeys.length > 350) {
          // Prioritize keeping user's own tweets
          tweetKeys.sort((a, b) => {
            if (tweetRecords[b].isOwnTweet && !tweetRecords[a].isOwnTweet) return 1;
            if (!tweetRecords[b].isOwnTweet && tweetRecords[a].isOwnTweet) return -1;
            return (tweetRecords[b].lastSeen || 0) - (tweetRecords[a].lastSeen || 0);
          });
          const trimmed = {};
          tweetKeys.slice(0, 350).forEach(k => { trimmed[k] = tweetRecords[k]; });
          await safeStorageSet({ tweet_records: trimmed });
        } else {
          await safeStorageSet({ tweet_records: tweetRecords });
        }
      }
    } catch (err) {
      if (!isExtensionValid() || err.message?.includes('local') || err.message?.includes('Extension context invalidated')) {
        cleanupOnInvalidation();
        return;
      }
      console.warn('[X-Heat-Pulse] Error during tweet scan:', err);
    } finally {
      isScanning = false;
    }
  }

  function metricsChanged(a, b) {
    return a.views !== b.views || a.likes !== b.likes || a.retweets !== b.retweets || a.replies !== b.replies || a.bookmarks !== b.bookmarks;
  }

  function computeDeltas(record, now, targetIntervalMs, currMetrics, intervalMinutes) {
    const snapshots = record.snapshots || [];
    const firstMetrics = record.firstSeenMetrics || currMetrics;
    const firstSeenAt = record.firstSeenAt || now;
    const publishedAt = record.publishedAt || firstSeenAt;

    // --- 1. Total Delta since first seen ---
    const dTot = {
      views: Math.max(0, currMetrics.views - (firstMetrics.views || 0)),
      likes: Math.max(0, currMetrics.likes - (firstMetrics.likes || 0)),
      retweets: Math.max(0, currMetrics.retweets - (firstMetrics.retweets || 0)),
      replies: Math.max(0, currMetrics.replies - (firstMetrics.replies || 0)),
      bookmarks: Math.max(0, currMetrics.bookmarks - (firstMetrics.bookmarks || 0))
    };
    const totalAgeMs = now - firstSeenAt;
    const totalAgeStr = formatElapsedTime(totalAgeMs);

    // --- 2. Interval Delta (e.g. 3m) ---
    const targetTimestamp = now - targetIntervalMs;
    let basePeriodSnapshot = snapshots[0] || currMetrics;
    let minDiff = Infinity;

    for (const snap of snapshots) {
      const diff = Math.abs(snap.t - targetTimestamp);
      if (diff < minDiff) {
        minDiff = diff;
        basePeriodSnapshot = snap;
      }
    }

    const agePeriodMs = now - (basePeriodSnapshot.t || now);
    const isNew = totalAgeMs < 35 * 1000 && snapshots.length <= 1;

    const dPeriod = {
      views: Math.max(0, currMetrics.views - (basePeriodSnapshot.views || 0)),
      likes: Math.max(0, currMetrics.likes - (basePeriodSnapshot.likes || 0)),
      retweets: Math.max(0, currMetrics.retweets - (basePeriodSnapshot.retweets || 0)),
      replies: Math.max(0, currMetrics.replies - (basePeriodSnapshot.replies || 0)),
      bookmarks: Math.max(0, currMetrics.bookmarks - (basePeriodSnapshot.bookmarks || 0))
    };

    // --- 3. Hourly Velocity (全周期总时速 vs 监控期间增量时速 vs 近期实时推流时速) ---
    // A. 全周期发帖时均增速 (浏览总量 ÷ 发帖总时长)
    const publishAgeMs = Math.max(now - publishedAt, 60 * 1000); // 至少 1 分钟防止除以 0
    const publishAgeHours = publishAgeMs / (1000 * 60 * 60);
    const hourlyVelocity = publishAgeHours > 0 ? Math.round(currMetrics.views / publishAgeHours) : 0;
    const hourlyLikesRate = publishAgeHours > 0 ? (currMetrics.likes / publishAgeHours).toFixed(1) : "0.0";
    const hourlyRtsRate = publishAgeHours > 0 ? (currMetrics.retweets / publishAgeHours).toFixed(1) : "0.0";
    const hourlyRepliesRate = publishAgeHours > 0 ? (currMetrics.replies / publishAgeHours).toFixed(1) : "0.0";
    const hourlyBookmarksRate = publishAgeHours > 0 ? (currMetrics.bookmarks / publishAgeHours).toFixed(1) : "0.0";

    // B. 监控期间时均增量速度 (实际观察到的累计增量 ÷ 持续监控时长)
    const trackingAgeMs = Math.max(now - firstSeenAt, 60 * 1000);
    const trackingAgeHours = trackingAgeMs / (1000 * 60 * 60);
    const trackingDeltaVelocity = trackingAgeHours > 0 ? Math.round(dTot.views / trackingAgeHours) : 0;

    // C. 近期瞬时推流时速 (近 N 分钟增量折算为时速)
    const periodMinutes = Math.max(1, Math.round(agePeriodMs / 60000));
    const recentBurstRate = periodMinutes > 0 ? Math.round(dPeriod.views * (60 / periodMinutes)) : 0;

    let publishAgeStr = "";
    if (publishAgeHours < 1) {
      publishAgeStr = `${Math.max(1, Math.round(publishAgeMs / 60000))}分钟`;
    } else if (publishAgeHours < 24) {
      publishAgeStr = `${publishAgeHours.toFixed(1)}小时`;
    } else {
      const days = (publishAgeHours / 24).toFixed(1);
      publishAgeStr = `${days}天`;
    }

    const formattedHourlyRate = hourlyVelocity >= 10000
      ? `${(hourlyVelocity / 1000).toFixed(1)}k/h`
      : `${hourlyVelocity}/h`;

    // --- 4. Algorithm Push Momentum (推流态势精准判断) ---
    const vPeriod = dPeriod.views || 0;
    const vTot = dTot.views || 0;
    const vCurr = currMetrics.views || 0;

    let pillClass = "steady";
    let icon = "☕";
    let pushStatus = "☕ 平稳分发";

    // 推流态势综合瞬时爆发时速与监控增量时速判断
    if (recentBurstRate >= 400 || trackingDeltaVelocity >= 400 || hourlyVelocity >= 500) {
      pillClass = "hot";
      icon = "🔥";
      pushStatus = "🔥 爆款推流中";
    } else if (recentBurstRate >= 50 || trackingDeltaVelocity >= 40 || hourlyVelocity >= 60 || vTot > 0) {
      pillClass = "growing";
      icon = "⚡";
      pushStatus = "⚡ 正在加速推流";
    }

    let mainText = "";
    let subText = "";

    if (isNew) {
      pillClass = "recording";
      icon = "⏱️";
      mainText = `${icon} ${vCurr} 阅 · ${formattedHourlyRate}`;
      subText = `${intervalMinutes}m 监测中`;
    } else {
      mainText = `${icon} ${vCurr} 阅 · ${formattedHourlyRate}`;
      subText = vTot > 0 && vTot !== vPeriod
        ? `${intervalMinutes}m +${vPeriod} · 累计 +${vTot}`
        : `${intervalMinutes}m +${vPeriod}`;
    }

    return {
      isNew,
      isOwnTweet: record.isOwnTweet || false,
      intervalMinutes,
      pillClass,
      pushStatus,
      mainText,
      subText,
      dPeriod,
      dTot,
      curr: currMetrics,
      firstMetrics,
      publishedAt,
      publishAgeStr,
      publishDateStr: new Date(publishedAt).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
      hourlyVelocity,
      formattedHourlyRate,
      trackingDeltaVelocity,
      recentBurstRate,
      hourlyLikesRate,
      hourlyRtsRate,
      hourlyRepliesRate,
      hourlyBookmarksRate,
      firstSeenAt,
      firstSeenDateStr: new Date(firstSeenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      samplePeriodDateStr: new Date(basePeriodSnapshot.t || now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      totalAgeStr,
      intervalPeriodStr: Math.max(1, Math.round(agePeriodMs / 60000))
    };
  }

  // Inject or update in-page pill badge (placed in top-right header, adjacent to caret)
  function injectOrUpdateBadge(tweetArticle, tweetId, info, record) {
    const mount = findTweetMountPoint(tweetArticle);
    if (!mount || !mount.parent) return;

    let container = tweetArticle.querySelector(`.x-heat-pulse-badge-container[data-id="${tweetId}"]`);

    // Migration / Relocation Guard:
    // If container exists but is not in the desired mount parent (e.g. was previously in bottom action bar), remove and remount
    if (container && container.parentElement !== mount.parent) {
      container.remove();
      container = null;
    }

    if (!container) {
      container = document.createElement('div');
      container.className = 'x-heat-pulse-badge-container';
      container.setAttribute('data-id', tweetId);

      container.innerHTML = `
        <div class="x-heat-pulse-pill ${info.pillClass}">
          <span class="x-heat-pulse-dot"></span>
          <span class="x-heat-pulse-main">${info.mainText}</span>
          <span class="x-heat-pulse-divider"></span>
          <span class="x-heat-pulse-sub">${info.subText}</span>
        </div>
        <div class="x-heat-pulse-tooltip">
          <!-- Dynamic Tooltip Table -->
        </div>
      `;

      // Prevent tweet card click navigation when interacting with badge or reset button
      container.addEventListener('click', (e) => {
        e.stopPropagation();
      });

      // Elevate stacking context of all ancestor elements so tweet text & video players stay behind
      container.addEventListener('mouseenter', () => {
        let parent = container.parentElement;
        while (parent && parent !== document.body) {
          parent.style.setProperty('z-index', '99999', 'important');
          parent.style.setProperty('position', 'relative', 'important');
          if (parent.tagName === 'ARTICLE') break;
          parent = parent.parentElement;
        }

        const tooltipEl = container.querySelector('.x-heat-pulse-tooltip');
        if (tooltipEl) {
          // Reset transform before measuring
          tooltipEl.style.transform = '';

          const rect = container.getBoundingClientRect();
          const spaceBelow = window.innerHeight - rect.bottom;
          if (spaceBelow < 440 && rect.top > 440) {
            tooltipEl.classList.add('flipped');
          } else {
            tooltipEl.classList.remove('flipped');
          }

          // Measure against tweet article & viewport left to prevent left-side clipping
          const tweetRect = tweetArticle.getBoundingClientRect();
          const tooltipRect = tooltipEl.getBoundingClientRect();
          const safeMinLeft = Math.max(12, tweetRect.left + 4);

          if (tooltipRect.left < safeMinLeft) {
            const shiftRight = Math.ceil(safeMinLeft - tooltipRect.left);
            tooltipEl.style.transform = `translateX(${shiftRight}px)`;
          } else if (tooltipRect.right > window.innerWidth - 12) {
            const shiftLeft = Math.floor((window.innerWidth - 12) - tooltipRect.right);
            tooltipEl.style.transform = `translateX(${shiftLeft}px)`;
          }
        }
      });

      container.addEventListener('mouseleave', () => {
        let parent = container.parentElement;
        while (parent && parent !== document.body) {
          parent.style.removeProperty('z-index');
          if (parent.tagName === 'ARTICLE') break;
          parent = parent.parentElement;
        }
      });

      if (mount.beforeElement && mount.beforeElement.parentElement === mount.parent) {
        mount.parent.insertBefore(container, mount.beforeElement);
      } else {
        mount.parent.appendChild(container);
      }
    }

    // Update pill
    const pill = container.querySelector('.x-heat-pulse-pill');
    const mainSpan = container.querySelector('.x-heat-pulse-main');
    const subSpan = container.querySelector('.x-heat-pulse-sub');

    if (pill && mainSpan && subSpan) {
      pill.className = `x-heat-pulse-pill ${info.pillClass}`;
      mainSpan.textContent = info.mainText;
      subSpan.textContent = info.subText;
    }

    // Render Full Table Tooltip
    const tooltip = container.querySelector('.x-heat-pulse-tooltip');
    if (tooltip) {
      const dp = info.dPeriod;
      const dt = info.dTot;
      const c = info.curr;

      const renderDelta = (val) => {
        if (val > 0) {
          return `<span class="val-highlight">+${val}</span>`;
        }
        return `<span class="val-zero">+0</span>`;
      };

      const ownTag = info.isOwnTweet ? `<span class="header-badge">我的专属帖子</span>` : '';

      // Calculate speed rating & 4-bar scale
      let gaugeLevel = 1;
      let gaugeText = '平稳推流';
      let gaugeClass = 'steady';
      if (info.hourlyVelocity >= 500) {
        gaugeLevel = 4;
        gaugeText = '爆款推流 (Lv.4)';
        gaugeClass = 'hot';
      } else if (info.hourlyVelocity >= 100) {
        gaugeLevel = 3;
        gaugeText = '加速推流 (Lv.3)';
        gaugeClass = 'growing';
      } else if (info.hourlyVelocity >= 30) {
        gaugeLevel = 2;
        gaugeText = '活跃释放 (Lv.2)';
        gaugeClass = 'growing';
      } else {
        gaugeLevel = 1;
        gaugeText = '平稳推流 (Lv.1)';
        gaugeClass = 'steady';
      }

      const bar1 = gaugeLevel >= 1 ? `active ${gaugeClass}` : '';
      const bar2 = gaugeLevel >= 2 ? `active ${gaugeClass}` : '';
      const bar3 = gaugeLevel >= 3 ? `active ${gaugeClass}` : '';
      const bar4 = gaugeLevel >= 4 ? `active ${gaugeClass}` : '';

      tooltip.innerHTML = `
        <div class="x-heat-pulse-tooltip-header">
          <div class="header-left">
            <span class="header-title">X 帖子热度时序追踪</span>
            ${ownTag}
          </div>
          <div class="header-right">
            发帖 ${info.publishAgeStr}前 · 持续监控 ${info.totalAgeStr}
          </div>
        </div>

        <!-- Hourly Velocity & Push Momentum Meter (时速增数仪表) -->
        <div class="x-velocity-meter-card">
          <!-- 1. 全帖总时均 (总浏览 ÷ 发帖时长) -->
          <div class="x-meter-col">
            <div class="x-meter-icon-pill" title="全帖总均速 = 总浏览量 ÷ 发帖时长">
              <svg class="x-speedometer-icon" viewBox="0 0 24 24">
                <path d="M12 14v-4"></path>
                <path d="M3.34 17a10 10 0 1 1 17.32 0"></path>
              </svg>
            </div>
            <div>
              <div class="x-meter-label">全帖总均速</div>
              <div class="x-meter-number-row">
                <span class="x-meter-value">${info.hourlyVelocity}</span>
                <span class="x-meter-unit">阅/h</span>
              </div>
              <div class="x-meter-subtext">${c.views} ÷ ${info.publishAgeStr}</div>
            </div>
          </div>

          <div class="x-meter-divider"></div>

          <!-- 2. 监控期间增量时速 (实际增量 ÷ 监控时长) -->
          <div class="x-meter-col">
            <div>
              <div class="x-meter-label">监控增量时速</div>
              <div class="x-meter-number-row">
                <span class="x-meter-value">${info.trackingDeltaVelocity}</span>
                <span class="x-meter-unit">阅/h</span>
              </div>
              <div class="x-meter-subtext">+${dt.views} ÷ ${info.totalAgeStr}</div>
            </div>
          </div>

          <div class="x-meter-divider"></div>

          <!-- 3. 算法推流态势 & 近期实时推流 -->
          <div class="x-meter-col">
            <div>
              <div class="x-meter-label">当前推流态势</div>
              <div class="x-push-status-badge ${gaugeClass}">
                <span class="x-status-pulse-dot"></span>
                <span>${info.pushStatus}</span>
              </div>
              <div class="x-meter-subtext">近${info.intervalPeriodStr}分 +${dp.views} (瞬时 ~${info.recentBurstRate}/h)</div>
            </div>
          </div>
        </div>

        <table class="x-heat-pulse-tooltip-table">
          <thead>
            <tr>
              <th class="col-left">互动指标</th>
              <th class="col-right">近${info.intervalPeriodStr || 3}分钟增量</th>
              <th class="col-right">监控累计增量</th>
              <th class="col-right">当前总量</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>
                <div class="metric-name-wrap">
                  <svg class="metric-icon" viewBox="0 0 24 24"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                  <span>曝光浏览</span>
                </div>
              </td>
              <td class="col-right">${renderDelta(dp.views)}</td>
              <td class="col-right">${renderDelta(dt.views)}</td>
              <td class="col-right val-total">${c.views}</td>
            </tr>
            <tr>
              <td>
                <div class="metric-name-wrap">
                  <svg class="metric-icon" viewBox="0 0 24 24"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z"></path></svg>
                  <span>获得点赞</span>
                </div>
              </td>
              <td class="col-right">${renderDelta(dp.likes)}</td>
              <td class="col-right">${renderDelta(dt.likes)}</td>
              <td class="col-right val-total">${c.likes}</td>
            </tr>
            <tr>
              <td>
                <div class="metric-name-wrap">
                  <svg class="metric-icon" viewBox="0 0 24 24"><path d="m17 1 4 4-4 4"></path><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><path d="m7 23-4-4 4-4"></path><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg>
                  <span>转发推文</span>
                </div>
              </td>
              <td class="col-right">${renderDelta(dp.retweets)}</td>
              <td class="col-right">${renderDelta(dt.retweets)}</td>
              <td class="col-right val-total">${c.retweets}</td>
            </tr>
            <tr>
              <td>
                <div class="metric-name-wrap">
                  <svg class="metric-icon" viewBox="0 0 24 24"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                  <span>参与回复</span>
                </div>
              </td>
              <td class="col-right">${renderDelta(dp.replies)}</td>
              <td class="col-right">${renderDelta(dt.replies)}</td>
              <td class="col-right val-total">${c.replies}</td>
            </tr>
            <tr>
              <td>
                <div class="metric-name-wrap">
                  <svg class="metric-icon" viewBox="0 0 24 24"><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z"></path></svg>
                  <span>书签收藏</span>
                </div>
              </td>
              <td class="col-right">${renderDelta(dp.bookmarks)}</td>
              <td class="col-right">${renderDelta(dt.bookmarks)}</td>
              <td class="col-right val-total">${c.bookmarks}</td>
            </tr>
          </tbody>
        </table>
        <div class="x-heat-pulse-tooltip-footer">
          <span class="footer-benchmark">首次捕获基准：${info.firstMetrics.views || 0} 阅（${info.firstSeenDateStr}）</span>
          <button class="x-heat-pulse-reset-btn" data-reset-id="${tweetId}" title="将当前数值重设为新的监控起点">↻ 重设此帖基准</button>
        </div>
      `;

      // Bind Reset Baseline button with instant UI feedback
      const resetBtn = tooltip.querySelector(`.x-heat-pulse-reset-btn[data-reset-id="${tweetId}"]`);
      if (resetBtn) {
        resetBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          resetBtn.textContent = '✓ 已设为新基准';
          resetBtn.style.color = '#00ba7c';
          resetBtn.style.borderColor = '#00ba7c';
          await resetTweetBaseline(tweetId, c);
          setTimeout(scheduleScan, 300);
        });
      }
    }
  }

  async function resetTweetBaseline(tweetId, currentMetrics) {
    if (!isExtensionValid()) return;
    const storage = await safeStorageGet("tweet_records");
    if (!storage) return;
    const tweetRecords = storage.tweet_records || {};
    if (tweetRecords[tweetId]) {
      const now = Date.now();
      tweetRecords[tweetId].firstSeenAt = now;
      tweetRecords[tweetId].firstSeenMetrics = { ...currentMetrics };
      tweetRecords[tweetId].snapshots = [{ t: now, ...currentMetrics }];
      await safeStorageSet({ tweet_records: tweetRecords });
      console.log(`[X-Heat-Pulse] Tweet ${tweetId} baseline reset.`);
      scheduleScan();
    }
  }

  // Listen for message triggers from popup or background
  if (isExtensionValid()) {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === "RESCAN") {
        scheduleScan();
        sendResponse({ status: "scanning" });
      } else if (request.action === "SET_HANDLE") {
        if (request.handle) {
          myHandle = request.handle;
          scheduleScan();
          sendResponse({ status: "handle_updated" });
        }
      }
    });
  }

  // DOM Mutation Observer for infinite scroll
  observer = new MutationObserver((mutations) => {
    if (!isExtensionValid()) {
      cleanupOnInvalidation();
      return;
    }
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

  scheduleScan();
  scanInterval = setInterval(scheduleScan, 5000);

})();
