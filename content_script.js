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

  // Extract tweet ID and author reliably, without confusing quoted tweets
  function extractTweetIdentity(tweetArticle) {
    let tweetId = null;
    let author = "";

    // 0. Extract author directly from tweet header if available
    const userNameEl = tweetArticle.querySelector('[data-testid="User-Name"]');
    if (userNameEl) {
      const match = userNameEl.textContent?.match(/@([a-zA-Z0-9_]{1,15})/);
      if (match && match[1]) {
        author = match[1];
      }
    }

    // 1. Time element link points specifically to the tweet itself
    const timeEl = tweetArticle.querySelector('time');
    if (timeEl) {
      const link = timeEl.closest('a[href*="/status/"]');
      if (link) {
        const href = link.getAttribute('href') || '';
        const match = href.match(/\/([^\/]+)\/status\/(\d+)/);
        if (match) {
          if (!author) author = match[1];
          tweetId = match[2];
          return { tweetId, author };
        }
      }
    }

    // 2. Author-specific status link
    if (author) {
      const authorStatusLink = tweetArticle.querySelector(`a[href*="/${author}/status/"]`);
      if (authorStatusLink) {
        const href = authorStatusLink.getAttribute('href') || '';
        const match = href.match(/\/([^\/]+)\/status\/(\d+)/);
        if (match) {
          tweetId = match[2];
          return { tweetId, author };
        }
      }
    }

    // 3. Check permalink URL if viewing single tweet status page
    const pathMatch = window.location.pathname.match(/\/([^\/]+)\/status\/(\d+)/);
    if (pathMatch) {
      const isFocal = tweetArticle.querySelector('div[data-testid="tweetText"]') || tweetArticle.querySelector('h2');
      if (isFocal) {
        if (!author) author = pathMatch[1];
        tweetId = pathMatch[2];
        return { tweetId, author };
      }
    }

    // 4. Fallback: query status links outside of quoted tweet blocks
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

    return { tweetId, author };
  }

  // Extract metrics from single tweet element
  function extractTweetMetrics(tweetArticle) {
    // 1. Tweet ID & Author
    const identity = extractTweetIdentity(tweetArticle);
    if (!identity.tweetId) return null;

    const { tweetId, author } = identity;

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

        const { tweetId, author, text, metrics, actionGroup } = data;

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
        if (!tweetRecords[tweetId]) {
          tweetRecords[tweetId] = {
            id: tweetId,
            author,
            text,
            isOwnTweet: isOwn,
            firstSeenAt: now,
            firstSeenMetrics: { ...metrics },
            snapshots: [
              { t: now, ...metrics }
            ]
          };
          hasNewRecords = true;
        } else {
          // If baseline was initially captured as 0 before React hydration, promote to first positive value
          const rec = tweetRecords[tweetId];
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

        // 4. Inject or Update Badge
        injectOrUpdateBadge(actionGroup, tweetId, deltaInfo, record);
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

    // --- 3. Determine Pill Text & Style (Focused on Total Views + Increments) ---
    const vPeriod = dPeriod.views || 0;
    const vTot = dTot.views || 0;
    const vCurr = currMetrics.views || 0;

    let pillClass = "steady";
    let icon = "☕";

    if (vPeriod >= 50) {
      pillClass = "hot";
      icon = "🔥";
    } else if (vPeriod > 0 || vTot > 0) {
      pillClass = "growing";
      icon = "⚡";
    }

    let mainText = "";
    let subText = "";

    if (isNew) {
      pillClass = "recording";
      icon = "⏱️";
      mainText = `${icon} ${vCurr} 阅 · 基准已锁定`;
      subText = `${intervalMinutes}m 增量待更新`;
    } else {
      mainText = `${icon} ${vCurr} 阅 · ${intervalMinutes}m +${vPeriod}`;
      subText = `累计 +${vTot}`;
    }

    return {
      isNew,
      isOwnTweet: record.isOwnTweet || false,
      intervalMinutes,
      pillClass,
      mainText,
      subText,
      dPeriod,
      dTot,
      curr: currMetrics,
      firstMetrics,
      firstSeenAt,
      firstSeenDateStr: new Date(firstSeenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      samplePeriodDateStr: new Date(basePeriodSnapshot.t || now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      totalAgeStr,
      intervalPeriodStr: Math.max(1, Math.round(agePeriodMs / 60000))
    };
  }

  // Inject or update in-page pill badge
  function injectOrUpdateBadge(actionGroup, tweetId, info, record) {
    let container = actionGroup.querySelector(`.x-heat-pulse-badge-container[data-id="${tweetId}"]`);

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

      // Smart flip: flip tooltip if near top of window
      container.addEventListener('mouseenter', () => {
        const rect = container.getBoundingClientRect();
        const tooltipEl = container.querySelector('.x-heat-pulse-tooltip');
        if (tooltipEl) {
          if (rect.top < 240) {
            tooltipEl.classList.add('flipped');
          } else {
            tooltipEl.classList.remove('flipped');
          }
        }
      });

      actionGroup.appendChild(container);
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

      const formatVal = (val, isTotal = false) => {
        if (val > 0) {
          return `<span class="${isTotal ? 'x-val-total' : 'x-val-pos'}">+${val}</span>`;
        }
        return `<span class="x-val-zero">+0</span>`;
      };

      const ownTag = info.isOwnTweet ? `<span style="font-size:9.5px; background:rgba(56,189,248,0.18); color:#38bdf8; border:1px solid rgba(56,189,248,0.3); padding:1px 5px; border-radius:4px; margin-left:6px;">我的专属帖子</span>` : '';

      tooltip.innerHTML = `
        <div class="x-heat-pulse-tooltip-header">
          <span>📊 X 帖子热度时序追踪 ${ownTag}</span>
          <span style="font-size:10px; color:#64748b;">持续追踪 ${info.totalAgeStr}</span>
        </div>
        <table class="x-heat-pulse-tooltip-table">
          <thead>
            <tr>
              <th>互动指标</th>
              <th>近${info.intervalMinutes}分钟增量</th>
              <th>监控累计增量</th>
              <th>当前总量</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>👁️ 曝光浏览</td>
              <td>${formatVal(dp.views)}</td>
              <td>${formatVal(dt.views, true)}</td>
              <td class="x-val-raw" style="font-weight:700; color:#38bdf8;">${c.views}</td>
            </tr>
            <tr>
              <td>❤️ 获得点赞</td>
              <td>${formatVal(dp.likes)}</td>
              <td>${formatVal(dt.likes, true)}</td>
              <td class="x-val-raw">${c.likes}</td>
            </tr>
            <tr>
              <td>🔁 转发推文</td>
              <td>${formatVal(dp.retweets)}</td>
              <td>${formatVal(dt.retweets, true)}</td>
              <td class="x-val-raw">${c.retweets}</td>
            </tr>
            <tr>
              <td>💬 参与回复</td>
              <td>${formatVal(dp.replies)}</td>
              <td>${formatVal(dt.replies, true)}</td>
              <td class="x-val-raw">${c.replies}</td>
            </tr>
            <tr>
              <td>🔖 书签收藏</td>
              <td>${formatVal(dp.bookmarks)}</td>
              <td>${formatVal(dt.bookmarks, true)}</td>
              <td class="x-val-raw">${c.bookmarks}</td>
            </tr>
          </tbody>
        </table>
        <div class="x-heat-pulse-tooltip-footer">
          <span>首次捕获基准: ${info.firstMetrics.views || 0} 阅 (${info.firstSeenDateStr})</span>
          <button class="x-heat-pulse-reset-btn" data-reset-id="${tweetId}" title="将当前数值重设为新的监控起点">🔄 重设此帖基准</button>
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
