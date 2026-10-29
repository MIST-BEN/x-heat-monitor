/**
 * X Heat Pulse - In-Page Tweet Heat Differential & Lifetime Tracker (v1.2.0)
 * 1. Accurately extracts real DOM metrics from x.com.
 * 2. Permanently retains initial baseline (First-Seen Metrics) to track lifetime delta.
 * 3. Accurately tracks 5-minute delta without rounding views to zero.
 * 4. Injects clear, dual-display badges and detailed comparison tables directly onto tweets.
 */

(function () {
  'use strict';

  console.log('[X-Heat-Pulse] v1.2.0 Content script active.');

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

  // Extract count from button or link (checks inner text and aria-label)
  function extractElementCount(container) {
    if (!container) return 0;

    // Check inner text
    const textSpans = container.querySelectorAll('span');
    for (const span of textSpans) {
      const text = span.textContent?.trim();
      if (text && /^[\d.,KMwW万亿]+$/.test(text)) {
        return parseMetricNumber(text);
      }
    }

    // Check aria-label
    const aria = container.getAttribute('aria-label');
    if (aria) {
      const numMatch = aria.match(/([\d.,]+)\s*([kKmMwW万亿])?/);
      if (numMatch) {
        return parseMetricNumber(numMatch[0]);
      }
    }

    // Direct text content
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

      // Fetch stored tweet records
      const storage = await chrome.storage.local.get(["tweet_records", "config"]);
      const tweetRecords = storage.tweet_records || {};
      const config = storage.config || { intervalMinutes: 5 };
      const targetIntervalMs = (config.intervalMinutes || 5) * 60 * 1000;
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

        // Guard: ensure firstSeenMetrics exists (for records created in previous version)
        if (!record.firstSeenMetrics) {
          record.firstSeenMetrics = record.snapshots && record.snapshots.length > 0
            ? { ...record.snapshots[0] }
            : { ...metrics };
          record.firstSeenAt = record.firstSeenAt || (record.snapshots?.[0]?.t) || now;
          hasNewRecords = true;
        }

        // 2. Append Snapshot if 30s elapsed or metrics changed
        const lastSnapshot = record.snapshots[record.snapshots.length - 1];
        const shouldSaveNewSnapshot =
          !lastSnapshot ||
          (now - lastSnapshot.t >= 30 * 1000) ||
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

        // 3. Compute 5-minute Delta and Total Lifetime Delta
        const deltaInfo = computeDeltas(record, now, targetIntervalMs, metrics);

        // 4. Inject or Update Badge
        injectOrUpdateBadge(actionGroup, tweetId, deltaInfo, record);
      });

      // Persist to local storage
      if (hasNewRecords) {
        await chrome.storage.local.set({ tweet_records: tweetRecords });
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

  // Compute both 5m and Total Deltas
  function computeDeltas(record, now, targetIntervalMs, currMetrics) {
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

    // --- 2. 5-Minute Delta ---
    const targetTimestamp = now - targetIntervalMs;
    let base5mSnapshot = snapshots[0] || currMetrics;
    let minDiff = Infinity;

    for (const snap of snapshots) {
      const diff = Math.abs(snap.t - targetTimestamp);
      if (diff < minDiff) {
        minDiff = diff;
        base5mSnapshot = snap;
      }
    }

    const age5mMs = now - (base5mSnapshot.t || now);
    const isNew = totalAgeMs < 45 * 1000 && snapshots.length <= 1;

    const d5 = {
      views: Math.max(0, currMetrics.views - (base5mSnapshot.views || 0)),
      likes: Math.max(0, currMetrics.likes - (base5mSnapshot.likes || 0)),
      retweets: Math.max(0, currMetrics.retweets - (base5mSnapshot.retweets || 0)),
      replies: Math.max(0, currMetrics.replies - (base5mSnapshot.replies || 0)),
      bookmarks: Math.max(0, currMetrics.bookmarks - (base5mSnapshot.bookmarks || 0))
    };

    // --- 3. Determine Pill Text & Style ---
    const sum5m = d5.views + d5.likes * 10 + d5.retweets * 20 + d5.replies * 10 + d5.bookmarks * 15;
    const sumTot = dTot.views + dTot.likes * 10 + dTot.retweets * 20 + dTot.replies * 10 + dTot.bookmarks * 15;

    let pillClass = "steady";
    let icon = "☕";

    if (d5.likes > 0 || d5.retweets > 0 || d5.views >= 50) {
      pillClass = "hot";
      icon = "🔥";
    } else if (d5.views > 0 || dTot.views > 0 || dTot.likes > 0) {
      pillClass = "growing";
      icon = "⚡";
    }

    let summary5m = formatDeltaSummary(d5);
    let summaryTot = formatDeltaSummary(dTot);

    let mainText = "";
    let subText = "";

    if (isNew) {
      pillClass = "recording";
      icon = "⏱️";
      mainText = "初始记录中";
      subText = "基准已锁定";
    } else {
      mainText = `${icon} 5m: ${summary5m}`;
      subText = `总: ${summaryTot}`;
    }

    return {
      isNew,
      pillClass,
      mainText,
      subText,
      d5,
      dTot,
      curr: currMetrics,
      firstMetrics,
      firstSeenAt,
      firstSeenDateStr: new Date(firstSeenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      sample5mDateStr: new Date(base5mSnapshot.t || now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      totalAgeStr,
      interval5mStr: Math.max(1, Math.round(age5mMs / 60000))
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
          <span class="x-heat-pulse-main">${info.mainText}</span>
          <span class="x-heat-pulse-divider"></span>
          <span class="x-heat-pulse-sub">${info.subText}</span>
        </div>
        <div class="x-heat-pulse-tooltip">
          <!-- Dynamic Tooltip Table -->
        </div>
      `;

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
      const d5 = info.d5;
      const dt = info.dTot;
      const c = info.curr;

      tooltip.innerHTML = `
        <div class="x-heat-pulse-tooltip-header">
          <span>📊 X 帖子热度时序追踪</span>
          <span style="font-size:10px; color:#71767b;">已监控 ${info.totalAgeStr}</span>
        </div>
        <table class="x-heat-pulse-tooltip-table">
          <thead>
            <tr>
              <th>互动指标</th>
              <th>近5分钟</th>
              <th>首次至今</th>
              <th>当前总量</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>👁️ 曝光浏览</td>
              <td class="${d5.views > 0 ? 'pos' : 'neutral'}">+${d5.views}</td>
              <td class="${dt.views > 0 ? 'total' : 'neutral'}">+${dt.views}</td>
              <td class="raw">${c.views}</td>
            </tr>
            <tr>
              <td>❤️ 获得点赞</td>
              <td class="${d5.likes > 0 ? 'pos' : 'neutral'}">+${d5.likes}</td>
              <td class="${dt.likes > 0 ? 'total' : 'neutral'}">+${dt.likes}</td>
              <td class="raw">${c.likes}</td>
            </tr>
            <tr>
              <td>🔁 转发推文</td>
              <td class="${d5.retweets > 0 ? 'pos' : 'neutral'}">+${d5.retweets}</td>
              <td class="${dt.retweets > 0 ? 'total' : 'neutral'}">+${dt.retweets}</td>
              <td class="raw">${c.retweets}</td>
            </tr>
            <tr>
              <td>💬 参与回复</td>
              <td class="${d5.replies > 0 ? 'pos' : 'neutral'}">+${d5.replies}</td>
              <td class="${dt.replies > 0 ? 'total' : 'neutral'}">+${dt.replies}</td>
              <td class="raw">${c.replies}</td>
            </tr>
            <tr>
              <td>🔖 书签收藏</td>
              <td class="${d5.bookmarks > 0 ? 'pos' : 'neutral'}">+${d5.bookmarks}</td>
              <td class="${dt.bookmarks > 0 ? 'total' : 'neutral'}">+${dt.bookmarks}</td>
              <td class="raw">${c.bookmarks}</td>
            </tr>
          </tbody>
        </table>
        <div class="x-heat-pulse-tooltip-footer">
          <span>首次看到: ${info.firstSeenDateStr}</span>
          <button class="x-heat-pulse-reset-btn" data-reset-id="${tweetId}" title="将当前数值重设为新的监控起点">🔄 重置基准</button>
        </div>
      `;

      // Bind Reset Baseline button
      const resetBtn = tooltip.querySelector(`.x-heat-pulse-reset-btn[data-reset-id="${tweetId}"]`);
      if (resetBtn) {
        resetBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          await resetTweetBaseline(tweetId, c);
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

  // Listen to DOM mutations for scrolling
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

  // Initial scan and periodic refresh
  scheduleScan();
  setInterval(scheduleScan, 12000);

})();
