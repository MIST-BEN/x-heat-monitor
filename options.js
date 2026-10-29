/**
 * X Heat Pulse - Options Page Controller (v1.4.2)
 */

document.addEventListener("DOMContentLoaded", async () => {
  const storage = await chrome.storage.local.get(["config", "my_user_handle"]);
  const config = storage.config;
  const myHandle = storage.my_user_handle || (config ? config.myHandle : "") || "sben96001";

  document.getElementById("myHandle").value = myHandle;

  if (config) {
    document.getElementById("intervalMinutes").value = config.intervalMinutes || 3;
    document.getElementById("alertThreshold").value = config.alertThreshold || 40;
    document.getElementById("enableNotification").checked = config.enableNotification !== false;

    if (config.weights) {
      document.getElementById("w-likes").value = config.weights.likes ?? 2.0;
      document.getElementById("w-retweets").value = config.weights.retweets ?? 5.0;
      document.getElementById("w-replies").value = config.weights.replies ?? 3.0;
      document.getElementById("w-bookmarks").value = config.weights.bookmarks ?? 4.0;
      document.getElementById("w-views").value = config.weights.views ?? 0.01;
    }

    if (config.apiToken) {
      document.getElementById("apiToken").value = config.apiToken;
    }
  }

  // Save handler
  document.getElementById("btn-save").addEventListener("click", async () => {
    const cleanHandle = document.getElementById("myHandle").value.trim().replace(/^@/, '');
    const updated = {
      intervalMinutes: parseInt(document.getElementById("intervalMinutes").value, 10),
      alertThreshold: parseInt(document.getElementById("alertThreshold").value, 10),
      enableNotification: document.getElementById("enableNotification").checked,
      weights: {
        likes: parseFloat(document.getElementById("w-likes").value),
        retweets: parseFloat(document.getElementById("w-retweets").value),
        replies: parseFloat(document.getElementById("w-replies").value),
        bookmarks: parseFloat(document.getElementById("w-bookmarks").value),
        views: parseFloat(document.getElementById("w-views").value)
      },
      apiToken: document.getElementById("apiToken").value.trim(),
      myHandle: cleanHandle
    };

    if (cleanHandle) {
      const curStorage = await chrome.storage.local.get("tweet_records");
      const records = curStorage.tweet_records || {};
      for (const id in records) {
        if (records[id].author && records[id].author.toLowerCase() === cleanHandle.toLowerCase()) {
          records[id].isOwnTweet = true;
        }
      }
      await chrome.storage.local.set({
        my_user_handle: cleanHandle,
        tweet_records: records
      });

      chrome.tabs.query({ url: ["https://x.com/*", "https://twitter.com/*"] }, (tabs) => {
        tabs.forEach(tab => {
          if (tab.id) {
            chrome.tabs.sendMessage(tab.id, { action: "SET_HANDLE", handle: cleanHandle }, () => {
              const _ = chrome.runtime.lastError;
            });
          }
        });
      });
    }

    chrome.runtime.sendMessage({ action: "UPDATE_CONFIG", config: updated }, () => {
      const _ = chrome.runtime.lastError;
      const msg = document.getElementById("status-msg");
      msg.style.display = "inline-block";
      setTimeout(() => {
        msg.style.display = "none";
      }, 3000);
    });
  });
});
