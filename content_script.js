/**
 * X Heat Pulse - In-Page Tweet Heat Differential & Lifetime Tracker (v1.3.0)
 * 1. Default 3-minute high-sensitivity sampling interval (configurable).
 * 2. Directly inspects title, aria-label, and text for exact unrounded metric counts.
 * 3. Permanently retains initial baseline (First-Seen Metrics) to track lifetime delta.
 * 4. Dual-display badges and dynamic comparison tables with overflow protection.
 */

(function () {
  'use strict';

  console.log('[X-Heat-Pulse] v1.3.0 Content script active.');

  const DEFAULT_INTERVAL_MINUTES = 3;
  let isScanning = false;
  let scanTimeout = null;

  function scheduleScan() {
    if (scanTimeout) clearTimeout(scanTimeout);
    scanTimeout = setTimeout(processAllVisibleTweets, 250);
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

    // 1. Check title attribute (Twitter often puts full exact number like title="1,248" even when visible text is "1.2K")
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

  // Extract metrics from single tweet element
  function extractTweetMetrics(tweetArticle) {
    // 1. Tweet ID & Author
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

  // Format short delta text (e.g. "+18阅", "+2赞", "+5")
  function formatDeltaSummary(delta) {
    const parts = [];
    if (delta.likes > 0) parts.push(`+${delta.likes}赞`);
    if (delta.retweets > 0) parts.push(`+${delta.retweets}转`);
    if (delta.replies > 0) parts.push(`+${delta.replies}评`);
    if (delta.bookmarks > 0) parts.push(`+${delta.bookmarks}藏`);
    if (delta.views > 0) parts.push(`+${delta.views}阅`);

    if (parts.length === 0) return "0";
    return parts.join(" ");
  }

  // Format elapsed time (e.g. "3 分钟前", "2.5 小时前")
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
    isScanning = true;

    try {
      const tweetArticles = document.querySelectorAll('article[data-testid="tweet"]');
      if (tweetArticles.length === 0) {
        isScanning = false;
        return;
      }

      // Fetch stored tweet records and config
      const storage = await chrome.storage.local.get(["tweet_records", "config"]);
      const tweetRecords = storage.tweet_records || {};
      const config = storage.config || { intervalMinutes: DEFAULT_INTERVAL_MINUTES };
      const intervalMinutes = config.intervalMinutes || DEFAULT_INTERVAL_MINUTES;
      const targetIntervalMs = intervalMinutes * 60 * 1000;
      const now = Date.now();

      let hasNewRecords = false;

      tweetArticles.forEach((article) => {
        const data = extractTweetMetrics(article);
        if (!data || !data.actionGroup) return;

        const { tweetId, author, text, metrics, actionGroup } = data;

        // 1. Initial Baseline: First time user views this tweet
        if (!tweetRecords[tweetId]) {
          tweetRecords[tweetId] = {
            id: tweetId,
            author,
            text,
            firstSeenAt: now,
            firstSeenMetrics: { ...metrics }, // Immutable baseline from first view
            snapshots: [
              { t: now, ...metrics }
            ]
          };
          hasNewRecords = true;
        }

        const record = tweetRecords[tweetId];
        record.lastSeen = now;
        if (text && !record.text) record.text = text;

        // Guard: ensure firstSeenMetrics exists
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

          // Keep up to 60 snapshots per tweet (~3-5 hours of active tracking)
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
      if (hasNewRecords) {
        // Safe prune: keep active tweets
        const tweetKeys = Object.keys(tweetRecords);
        if (tweetKeys.length > 250) {
          tweetKeys.sort((a, b) => (tweetRecords[b].lastSeen || 0) - (tweetRecords[a].lastSeen || 0));
          const trimmed = {};
          tweetKeys.slice(0, 250).forEach(k => { trimmed[k] = tweetRecords[k]; });
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

  // Compute both Interval Delta and Total Deltas
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

    // --- 3. Determine Pill Text & Style ---
    let pillClass = "steady";
    let icon = "☕";

    if (dPeriod.likes > 0 || dPeriod.retweets > 0 || dPeriod.views >= 30) {
      pillClass = "hot";
      icon = "🔥";
    } else if (dPeriod.views > 0 || dTot.views > 0 || dTot.likes > 0) {
      pillClass = "growing";
      icon = "⚡";
    }

    let summaryPeriod = formatDeltaSummary(dPeriod);
    let summaryTot = formatDeltaSummary(dTot);

    let mainText = "";
    let subText = "";

    if (isNew) {
      pillClass = "recording";
      icon = "⏱️";
      mainText = "初始记录中";
      subText = "基准已锁定";
    } else {
      mainText = `${icon} ${intervalMinutes}m: ${summaryPeriod}`;
      subText = `总: ${summaryTot}`;
    }

    return {
      isNew,
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
          if (rect.top < 230) {
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

      tooltip.innerHTML = `
        <div class="x-heat-pulse-tooltip-header">
          <span>📊 X 帖子热度时序追踪</span>
          <span style="font-size:10px; color:#64748b;">已持续追踪 ${info.totalAgeStr}</span>
        </div>
        <table class="x-heat-pulse-tooltip-table">
          <thead>
            <tr>
              <th>互动指标</th>
              <th>近${info.intervalMinutes}分钟</th>
              <th>首次至今</th>
              <th>当前总量</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>👁️ 曝光浏览</td>
              <td>${formatVal(dp.views)}</td>
              <td>${formatVal(dt.views, true)}</td>
              <td class="x-val-raw">${c.views}</td>
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
          <span>首次捕获: ${info.firstSeenDateStr}</span>
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

  // User resets baseline for specific tweet
  async function resetTweetBaseline(tweetId, currentMetrics) {
    const storage = await chrome.storage.local.get("tweet_records");
    const tweetRecords = storage.tweet_records || {};
    if (tweetRecords[tweetId]) {
      const now = Date.now();
      tweetRecords[tweetId].firstSeenAt = now;
      tweetRecords[tweetId].firstSeenMetrics = { ...currentMetrics };
      tweetRecords[tweetId].snapshots = [{ t: now, ...currentMetrics }];
      await chrome.storage.local.set({ tweet_records: tweetRecords });
      console.log(`[X-Heat-Pulse] Tweet ${tweetId} baseline reset to now.`);
      scheduleScan();
    }
  }

  // Listen to DOM mutations for dynamic scrolling
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

  // Initial scan and quick periodic rescan (every 6 seconds)
  scheduleScan();
  setInterval(scheduleScan, 6000);

})();
