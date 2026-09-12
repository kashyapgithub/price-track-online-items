# Price Drop Tracker (Chrome Extension)

Paste in product links, and it checks their price once a day (plus on-demand
via the ↻ button) and pings you with a notification the moment the price drops.

## How to install (unpacked, no Chrome Web Store needed)

1. Unzip this folder somewhere permanent (don't delete it after — Chrome loads it live from disk).
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the unzipped `price-tracker` folder.
5. Pin the extension from the puzzle-piece icon so it's easy to reach.

## How it works

- **popup.html/js/css** — the UI. Add a link, see your tracked products, remove one, or force a check.
- **background.js** — a service worker that runs once a day via `chrome.alarms`, fetches each product page, and compares the price.
- **utils/priceExtractor.js** — pulls the price out of the page HTML. It checks, in order: JSON-LD product schema → OpenGraph/itemprop meta tags → a couple of hardcoded fallbacks for Amazon/Flipkart.
- **utils/storage.js** — all reads/writes to the tracked product list and the daily `meta` run summary.
- **utils/settings.js** — user notification preferences (on/off, drop threshold, quiet hours).
- **utils/dropLog.js** — a rolling history of every detected drop, notified or not.

## How you're kept in the loop (and kept spam-free)

- **Every check is written to disk, always** — even if the price didn't change, `priceHistory` gets a new entry and `lastCheckedAt` updates. Nothing is silently skipped.
- **The alarm re-arms itself on every browser startup**, not just on install — so it survives a Chrome restart, an update, or the extension being toggled off and back on.
- **Notifications are batched per run, not per product.** 1–3 drops in a single daily run → one notification each (still useful, click opens that product). 4+ drops in the same run → one consolidated "N prices dropped" notification instead of a wall of pop-ups.
- **A ⚙ settings panel in the popup** lets you control the pop-ups directly:
  - Turn notifications fully on/off.
  - Set a minimum drop percentage to notify on (Any / 1% / 3% / 5% / 10%) — filters out ₹1–2 noise from dynamic pricing.
  - Set quiet hours (e.g. 22:00–08:00) during which no pop-up fires at all.
- **Nothing is ever truly lost.** Every detected drop is written to a small rolling log (`utils/dropLog.js`, last 20 entries) regardless of whether a pop-up was actually shown — visible under "Recent drops" in the popup, marked `(muted)` if it happened during quiet hours or with notifications off.
- **Same price never re-notifies** — a drop only counts when the new price is strictly below the last *stored* price.
- **A green badge number on the toolbar icon** appears the moment a check finds a drop, and clears once you open the popup.
- **The status strip in the popup** always shows "Checked N products Xh ago · N drops found" — proof the daily run happened, with a red dot if anything failed to fetch.

## What actually makes price detection work (and its real limit)

Two-tier extraction, in `background.js`:
1. **Fast path** — plain `fetch()` of the page, looking for JSON-LD/meta price tags. Works for most sites that render server-side or publish SEO metadata (this covers Amazon in most cases).
2. **Fallback path** — if the fast path finds nothing (typical for a JS-heavy single-page storefront like Flipkart, where a plain fetch returns an empty HTML shell), the extension opens the product URL in a real, inactive background tab, lets it render, reads the live DOM, then closes the tab. Slower and slightly more visible (a tab briefly opens), but far more reliable for React/Vue-rendered sites.

This needed two new permissions — `tabs` and `scripting` — added to `manifest.json`. You'll see Chrome ask for these on re-install.

**Still not bulletproof:** sites with bot detection (CAPTCHAs, login walls, region-locked pricing) can block both paths. If a product keeps failing, the popup's per-product error line will tell you why — worth checking before assuming it's silently working.

## Known limitations (worth knowing upfront)

- **Price detection isn't universal.** Most e-commerce sites publish price metadata for SEO (which this reads), but some heavily JS-rendered sites (prices injected by React/Vue after load) won't show a price in the raw HTML at all. If a product shows "Couldn't find a price," that site likely needs a site-specific fix.
- **Daily granularity.** Checks run once every 24h by default (`CHECK_INTERVAL_MINUTES` in `background.js`) — set it lower if you want tighter checks, but be considerate of the sites you're pinging.
- **The browser must be open** for `chrome.alarms` to fire — this isn't a server-side tracker, it won't check prices while Chrome is fully closed.
- **No login/session support.** It fetches pages anonymously, so member-only or region-locked prices won't be picked up.

## Extending it

Adding support for a new site is just adding one more regex to
`extractFromKnownSites()` in `utils/priceExtractor.js` — no need to touch
anything else.
