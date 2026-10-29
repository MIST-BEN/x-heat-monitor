/**
 * X Heat Pulse - Options Page Controller
 */

document.addEventListener("DOMContentLoaded", async () => {
  const { config } = await chrome.storage.local.get("config");

  if (config) {
    document.getElementById("intervalMinutes").value = config.intervalMinutes || 5;
    document.getElementById("alertThreshold").value = config.alertThreshold || 50;
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
  document.getElementById("btn-save").addEventListener("click", () => {
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
      apiToken: document.getElementById("apiToken").value.trim()
    };

    chrome.runtime.sendMessage({ action: "UPDATE_CONFIG", config: updated }, () => {
      const msg = document.getElementById("status-msg");
      msg.style.display = "inline-block";
      setTimeout(() => {
        msg.style.display = "none";
      }, 3000);
    });
  });
});
