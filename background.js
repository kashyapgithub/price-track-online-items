/**
 * background.js
 * ----------------------------------------------------------------------------
 * The extension's service worker. Responsibilities:
 *   1. Set up a recurring alarm that checks all tracked products' prices.
 *   2. On each check: fetch the page HTML, extract the price (falling back
 *      to a real background tab for JS-rendered sites), save it, and queue
 *      a notification if the price genuinely dropped.
 *   3. Fire ONE notification per run, not one per product — see
 *      notifyDrops() for the anti-spam logic.
 *   4. Listen for a manual "check now" message from the popup.
 *
 * Runs as an ES module (see manifest.json "type": "module") so it can use
 * import/export instead of importScripts().
 */

import { getProducts, recordPriceCheck, setMeta } from "./utils/storage.js";
import { extractPrice } from "./utils/priceExtractor.js";
import { getSettings, isWithinQuietHours } from "./utils/settings.js";
import { logDrop } from "./utils/dropLog.js";

const ALARM_NAME = "daily-price-check";
const CHECK_INTERVAL_MINUTES = 60 * 24; // once a day

// Above this many drops in one run, collapse into a single summary
// notification instead of one per product.
const MAX_INDIVIDUAL_NOTIFICATIONS = 3;

// ---------------------------------------------------------------------------
// Setup: create the recurring alarm on install AND on every browser startup.
// chrome.alarms persists across service-worker restarts on its own, but NOT
// across the user disabling/re-enabling the extension or certain Chrome
// updates, so we re-arm it defensively every time Chrome starts rather than
// trusting a single onInstalled call to have been enough.
// ---------------------------------------------------------------------------
chrome.runtime.onInstalled.addListener(ensureAlarm);
chrome.runtime.onStartup.addListener(ensureAlarm);

async function ensureAlarm() {
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (!existing) {
    chrome.alarms.create(ALARM_NAME, {
      delayInMinutes: 1, // first check shortly after install/startup, not a full day later
      periodInMinutes: CHECK_INTERVAL_MINUTES,
    });
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    checkAllProducts();
  }
});

// ---------------------------------------------------------------------------
// Manual trigger from the popup ("Check now" button).
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CHECK_ALL_NOW") {
    checkAllProducts().then(() => sendResponse({ ok: true }));
    return true; // keep the message channel open for the async response
  }
});

// ---------------------------------------------------------------------------
// Core logic
// ---------------------------------------------------------------------------

/**
 * Loop through every tracked product, refresh its price, then record a
 * "run summary" in storage and reflect it on the toolbar badge — durable,
 * checkable proof that a daily check actually happened, even if the popup
 * is never opened. Notifications for any real drops go out at the very end,
 * batched, so a run with several drops sends one notification, not several.
 */
async function checkAllProducts() {
  const products = await getProducts();
  const settings = await getSettings();
  const drops = []; // { product, oldPrice, newPrice, percent }
  let errorCount = 0;

  // Sequential (not Promise.all) to avoid hammering multiple retailers at once.
  for (const product of products) {
    const result = await checkSingleProduct(product, settings.minDropPercent);
    if (result.failed) errorCount += 1;
    if (result.drop) drops.push(result.drop);
  }

  await setMeta({
    lastRunAt: Date.now(),
    lastRunDropCount: drops.length,
    lastRunProductCount: products.length,
    lastRunError: errorCount > 0 ? `${errorCount} product(s) failed to check` : null,
  });

  updateBadge(drops.length);

  // Quiet hours / the master on-off switch only affect the pop-up itself —
  // every drop is still written to the log below so nothing is ever lost,
  // just possibly silent until you open the popup.
  const suppressNotification = !settings.notificationsEnabled || isWithinQuietHours(settings);

  for (const drop of drops) {
    await logDrop({
      productId: drop.product.id,
      title: drop.product.title,
      url: drop.product.url,
      oldPrice: drop.oldPrice,
      newPrice: drop.newPrice,
      percent: drop.percent,
      notified: !suppressNotification,
    });
  }

  if (!suppressNotification) notifyDrops(drops);
}

/**
 * Check one product: try a plain fetch first (cheap, works for most sites
 * that publish SEO price metadata). If no price is found — typically a
 * JS-rendered single-page-app storefront like Flipkart, where the raw HTML
 * is just an empty shell — fall back to opening a real background tab,
 * letting it render, and reading the price from the live page.
 */
async function checkSingleProduct(product, minDropPercent) {
  try {
    let price = await extractPriceViaFetch(product.url);

    if (price === null) {
      price = await extractPriceViaTab(product.url);
    }

    if (price === null) {
      await recordPriceCheck(product.id, {
        price: null,
        error: "Couldn't find a price, even after rendering the page.",
      });
      return { failed: true, drop: null };
    }

    const { droppedFrom } = await recordPriceCheck(product.id, { price, error: null });

    if (droppedFrom !== null) {
      const percent = Math.round(((droppedFrom - price) / droppedFrom) * 100);
      if (percent >= minDropPercent) {
        return { failed: false, drop: { product, oldPrice: droppedFrom, newPrice: price, percent } };
      }
    }
    return { failed: false, drop: null };
  } catch (err) {
    await recordPriceCheck(product.id, { price: null, error: err.message });
    return { failed: true, drop: null };
  }
}

/** Fast path: fetch the raw HTML and look for price metadata. */
async function extractPriceViaFetch(url) {
  const response = await fetch(url, { credentials: "omit" });
  if (!response.ok) throw new Error(`Page returned HTTP ${response.status}`);
  const html = await response.text();
  return extractPrice(html, url);
}

/**
 * Slow path fallback: open the URL in a real (inactive) background tab so
 * its JS runs and the price actually renders, read the fully-rendered HTML
 * out of it via chrome.scripting, then close the tab. Needed for sites that
 * render price client-side and return an empty shell to a plain fetch.
 */
async function extractPriceViaTab(url) {
  let tab;
  try {
    tab = await chrome.tabs.create({ url, active: false });
    await waitForTabToLoad(tab.id);
    // Give client-side rendering a moment to finish painting the price in.
    await new Promise((resolve) => setTimeout(resolve, 2500));

    const [{ result: html }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.documentElement.outerHTML,
    });

    return extractPrice(html, url);
  } catch {
    return null;
  } finally {
    if (tab?.id) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

/** Resolve once a tab finishes loading (or after a timeout, to avoid hanging forever). */
function waitForTabToLoad(tabId, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      resolve();
    }, timeoutMs);

    function listener(updatedTabId, info) {
      if (updatedTabId === tabId && info.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

/** Toolbar badge: a green count of fresh drops, cleared once there are none. */
function updateBadge(dropCount) {
  if (dropCount > 0) {
    chrome.action.setBadgeText({ text: String(dropCount) });
    chrome.action.setBadgeBackgroundColor({ color: "#16a34a" });
  } else {
    chrome.action.setBadgeText({ text: "" });
  }
}

/**
 * The anti-spam core: at most ONE Chrome notification is shown per check
 * run, no matter how many products dropped.
 *  - 0 drops  -> nothing.
 *  - 1-3 drops -> one notification per product (still just a few, and each
 *    is genuinely useful — click it, it opens that exact product).
 *  - 4+ drops -> a single consolidated "N prices dropped" notification
 *    instead of a wall of pop-ups; open the popup to see which ones.
 */
function notifyDrops(drops) {
  if (drops.length === 0) return;

  if (drops.length <= MAX_INDIVIDUAL_NOTIFICATIONS) {
    for (const drop of drops) {
      chrome.notifications.create(`price-drop-${drop.product.id}`, {
        type: "basic",
        iconUrl: "icons/icon128.png",
        title: "Price drop! 📉",
        message: `${drop.product.title}\n₹${drop.oldPrice} → ₹${drop.newPrice} (-${drop.percent}%)`,
        priority: 2,
      });
    }
    return;
  }

  chrome.notifications.create("price-drop-summary", {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: "Price drop! 📉",
    message: `${drops.length} tracked products just got cheaper. Open the extension to see which.`,
    priority: 2,
  });
}

// Clicking a per-product notification opens that product's page.
// Clicking the summary notification opens the popup instead.
chrome.notifications.onClicked.addListener(async (notificationId) => {
  if (notificationId === "price-drop-summary") {
    chrome.action.openPopup().catch(() => {});
    return;
  }
  if (!notificationId.startsWith("price-drop-")) return;
  const id = notificationId.replace("price-drop-", "");
  const products = await getProducts();
  const product = products.find((p) => p.id === id);
  if (product) chrome.tabs.create({ url: product.url });
});
