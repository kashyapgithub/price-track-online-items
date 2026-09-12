/**
 * dropLog.js
 * ----------------------------------------------------------------------------
 * A short rolling history of detected price drops, independent of whether a
 * notification was actually shown for each one (quiet hours, notifications
 * disabled, or the OS silently swallowing it can all mean a Chrome
 * notification never reached the user). The popup reads this so a drop is
 * never truly missed — worst case, you see it here instead of as a pop-up.
 */

const LOG_KEY = "dropLog";
const MAX_ENTRIES = 20;

export async function getRecentDrops() {
  const result = await chrome.storage.local.get(LOG_KEY);
  return Array.isArray(result[LOG_KEY]) ? result[LOG_KEY] : [];
}

/** Record a drop. `notified` marks whether a Chrome notification was actually fired for it. */
export async function logDrop({ productId, title, url, oldPrice, newPrice, percent, notified }) {
  const log = await getRecentDrops();
  log.unshift({
    productId,
    title,
    url,
    oldPrice,
    newPrice,
    percent,
    notified,
    at: Date.now(),
  });
  await chrome.storage.local.set({ [LOG_KEY]: log.slice(0, MAX_ENTRIES) });
}
