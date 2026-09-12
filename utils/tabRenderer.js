/**
 * tabRenderer.js
 * ----------------------------------------------------------------------------
 * Shared by both price-checking and description-search: opens a URL in a
 * real, inactive Chrome tab, lets its JS run, grabs the rendered HTML, then
 * closes it. Living in one file because both features need the exact same
 * "give me what a genuine browser would actually see" behavior — this is
 * what makes both more resistant to bot detection than a bare fetch().
 *
 * Only usable from background.js (needs the "tabs" and "scripting"
 * permissions and the chrome.tabs/.scripting APIs, which only exist in
 * privileged extension contexts).
 */

/** Render `url` in a background tab and return its outerHTML, or null on any failure. */
export async function renderUrlToHtml(url, { renderDelayMs = 2500, loadTimeoutMs = 15000 } = {}) {
  let tab;
  try {
    tab = await chrome.tabs.create({ url, active: false });
    await waitForTabToLoad(tab.id, loadTimeoutMs);
    // Give client-side rendering a moment to finish painting content in.
    await sleep(renderDelayMs);

    const [{ result: html }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.documentElement.outerHTML,
    });

    return html;
  } catch {
    return null;
  } finally {
    if (tab?.id) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

/** Resolve once a tab finishes loading (or after a timeout, to avoid hanging forever). */
function waitForTabToLoad(tabId, timeoutMs) {
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

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
