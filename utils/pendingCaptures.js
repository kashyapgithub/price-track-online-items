/**
 * pendingCaptures.js
 * ----------------------------------------------------------------------------
 * A tiny holding area for dwell-detection: when the content script reports
 * "user has been looking at this product for 60s," background.js captures
 * the page snapshot (title + price, already extracted from the HTML the
 * content script sent) and needs somewhere to put it until the user reacts
 * to the notification — which could be seconds or minutes later, longer
 * than a service worker reliably stays alive in memory. So it goes here,
 * in chrome.storage.local, instead of a plain JS variable.
 */

const KEY = "pendingDwellCaptures"; // { [notificationId]: { url, title, price, capturedAt } }

async function getAll() {
  const result = await chrome.storage.local.get(KEY);
  return result[KEY] || {};
}

export async function savePendingCapture(id, data) {
  const all = await getAll();
  all[id] = { ...data, capturedAt: Date.now() };
  await chrome.storage.local.set({ [KEY]: all });
}

export async function getPendingCapture(id) {
  const all = await getAll();
  return all[id] || null;
}

export async function clearPendingCapture(id) {
  const all = await getAll();
  delete all[id];
  await chrome.storage.local.set({ [KEY]: all });
}
