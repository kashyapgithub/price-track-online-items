/**
 * contentScript.js
 * ----------------------------------------------------------------------------
 * Runs only on the four supported retailers (see manifest.json
 * content_scripts.matches). Tracks how long THIS TAB has actually been
 * visible on a product page — pausing while the tab is backgrounded, not
 * just "60 seconds since the page loaded" — and, once that hits 60s, sends
 * the page's own rendered HTML to background.js so it can offer to track it.
 *
 * The path-pattern check below is intentionally a small duplicate of
 * utils/productPageDetector.js's DETECTORS list — content scripts run
 * outside the extension's module graph, so re-implementing ~4 lines here is
 * simpler and more transparent than wiring up dynamic imports across a
 * content-script boundary. If you add a retailer to productPageDetector.js,
 * mirror the path pattern here too.
 */

(() => {
  const DWELL_MS = 60 * 1000;

  const PATH_PATTERNS = [
    { host: "amazon.", path: /\/(dp|gp\/product)\/[A-Z0-9]{10}/i },
    { host: "flipkart.com", path: /\/p\// },
    { host: "croma.com", path: /\/p\/\d+/ },
    { host: "reliancedigital.in", path: /\/p\/\d+/ },
  ];

  const match = PATH_PATTERNS.find((p) => location.hostname.includes(p.host));
  if (!match || !match.path.test(location.pathname)) return; // not a product page — do nothing

  let visibleSince = document.visibilityState === "visible" ? Date.now() : null;
  let accumulatedMs = 0;
  let fired = false;
  let timer = null;

  function currentVisibleTotal() {
    return accumulatedMs + (visibleSince !== null ? Date.now() - visibleSince : 0);
  }

  function scheduleCheck() {
    clearTimeout(timer);
    if (fired || visibleSince === null) return;

    const remaining = DWELL_MS - currentVisibleTotal();
    if (remaining <= 0) {
      reportDwell();
    } else {
      timer = setTimeout(scheduleCheck, remaining);
    }
  }

  function reportDwell() {
    if (fired) return;
    fired = true;
    chrome.runtime.sendMessage({
      type: "DWELL_THRESHOLD_REACHED",
      url: location.href,
      title: document.title,
      html: document.documentElement.outerHTML,
    });
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      visibleSince = Date.now();
      scheduleCheck();
    } else if (visibleSince !== null) {
      accumulatedMs += Date.now() - visibleSince;
      visibleSince = null;
      clearTimeout(timer);
    }
  });

  scheduleCheck();
})();
