# Price Drop Tracker (Chrome Extension)

Paste in product links — or just search by description — and it checks
prices once a day (plus on-demand via the ↻ button) and pings you with a
notification the moment a price drops.

## How to install (unpacked, no Chrome Web Store needed)

1. Unzip this folder somewhere permanent (don't delete it after — Chrome loads it live from disk).
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the unzipped `price-tracker` folder.
5. Pin the extension from the puzzle-piece icon so it's easy to reach.

## How it works

- **popup.html/js/css** — the UI. Add a link (or search by description), see your tracked products, remove one, or force a check.
- **background.js** — a service worker that runs once a day via `chrome.alarms`, checks each product's price, and handles retailer search requests from the popup.
- **utils/priceExtractor.js** — pulls the price out of a product page's HTML. Checks, in order: JSON-LD product schema → OpenGraph/itemprop meta tags → hardcoded fallbacks for Amazon/Flipkart. Also detects anti-bot interstitials (`isBlockedPage`).
- **utils/tabRenderer.js** — shared helper (used by both price-checking and description-search) that renders a URL in a real, inactive Chrome tab and returns the rendered HTML. This is the core defense against bot-blocking — see below.
- **utils/siteSearch.js** — the "search by description" feature: the fixed list of retailers, how to build each one's search URL, and how to parse its first result.
- **utils/storage.js** — all reads/writes to the tracked product list and the daily `meta` run summary.
- **utils/settings.js** — user notification preferences (on/off, minimum drop % to notify on).
- **utils/dropLog.js** — a rolling history of every detected drop, notified or not.

## How prices are found (and why it holds up against blocking)

Two-tier extraction, in `background.js`:
1. **Fast path** — plain `fetch()` of the page, looking for JSON-LD/meta price tags. Works for most sites that render server-side or publish SEO metadata (covers Amazon in most cases).
2. **Fallback path** — if the fast path finds nothing (typical for a JS-heavy single-page storefront like Flipkart, where a plain fetch returns an empty HTML shell), the extension renders the URL in a real, inactive background tab via `utils/tabRenderer.js` and reads the price from the live DOM. This needed two extra permissions — `tabs` and `scripting` — in `manifest.json`.

A real Chrome tab has genuine cookies, a real JS engine, and a real browser fingerprint, so it's inherently far less likely to get flagged than a bare `fetch()` request. That's the legitimate half of dealing with bot detection. The other half is being gentle about it:

- **Distinguishes a block from a broken link.** If a page looks like a CAPTCHA/verification interstitial rather than just missing a price, the product card says so explicitly (🚫 icon) instead of the generic "couldn't find a price."
- **Tracks consecutive failures per product**, so "blocked once" and "blocked 6 days running" read differently in the UI.
- **Randomized delay (3–8s) between each product check** in a run, instead of firing requests back-to-back — a fixed-interval burst is exactly the pattern anti-bot systems are tuned to catch.
- **Checks once a day, not more** — frequency itself is a major signal; daily is deliberately conservative.

**What this won't do:** proxy rotation, fingerprint spoofing, or CAPTCHA-solving to force through an active block. That's not a code-quality tradeoff, it's a "circumventing a site's security controls" line, and it stays out regardless of intent. If a specific product stays blocked for days, the realistic options are: check it manually now and then, or (for Amazon specifically) use Amazon's own Product Advertising API or a service like Keepa, which get price data through the front door instead of around it. There's no equivalent official option for Flipkart, so Flipkart links will always be the more fragile side of this tool.

## Search by description

The popup's "Search by description" tab is an alternative to pasting a link. Type something like `Sony WH-1000XM5 headphones` and it checks a **small, fixed list of retailers** — currently Amazon, Flipkart, Croma, Reliance Digital, defined in `utils/siteSearch.js` — and shows the top match + price from each. You pick which one (if any) to start tracking; it never silently decides "the best" price for you.

**What this deliberately is NOT:** a general web search or a "find the best deal anywhere" engine. That would mean scraping Google/Bing search results, which are defended far more aggressively than product pages — out of scope on purpose.

**Reliability varies by site:**
- **Amazon and Flipkart** have dedicated parsers matched to their current result-page markup — reasonably reliable, but may need a small update in `utils/siteSearch.js` if either site's layout changes (search-result markup shifts more often than product-page markup).
- **Croma and Reliance Digital** use a generic best-effort heuristic (first product link + nearest ₹ amount), since they don't have dedicated parsers yet — expect more misfires here.
- Uses the same real-tab rendering and inter-request jitter as the daily price checks, for the same bot-detection reasons.

Adding a fifth retailer is one new entry in the `RETAILERS` array in `utils/siteSearch.js` — a `buildSearchUrl()` and a `parseFirstResult()`, nothing else needs to change.

## How you're kept in the loop (and kept spam-free)

- **Every check is written to disk, always** — even if the price didn't change, `priceHistory` gets a new entry and `lastCheckedAt` updates. Nothing is silently skipped.
- **The alarm re-arms itself on every browser startup**, not just on install — so it survives a Chrome restart, an update, or the extension being toggled off and back on.
- **Notifications are batched per run, not per product.** 1–3 drops in a single daily run → one notification each (click opens that product). 4+ drops in the same run → one consolidated "N prices dropped" notification instead of a wall of pop-ups.
- **A ⚙ settings panel in the popup** controls the pop-ups directly:
  - Turn notifications fully on/off.
  - Set a minimum drop percentage to notify on (Any / 1% / 3% / 5% / 10%) — filters out ₹1–2 noise from dynamic pricing.
- **Nothing is ever truly lost.** Every detected drop is written to a small rolling log (`utils/dropLog.js`, last 20 entries) regardless of whether a pop-up was actually shown — visible under "Recent drops" in the popup, marked `(muted)` if notifications happened to be off.
- **Same price never re-notifies** — a drop only counts when the new price is strictly below the last *stored* price.
- **A green badge number on the toolbar icon** appears the moment a check finds a drop, and clears once you open the popup.
- **The status strip in the popup** always shows "Checked N products Xh ago · N drops found" — proof the daily run happened, with a red dot if anything failed to fetch.

## Reference price for the drop %

The notification-triggering drop % is always **day-over-day**: today's price vs. yesterday's stored price (`product.currentPrice` before the check). This keeps the anti-spam threshold meaningful and simple — "did it move since I last saw it."

The popup shows two more numbers as *context only* (they never trigger a notification on their own):
- **vs. all-time low** — "at all-time low" or "N% above lowest."
- **vs. when added** — "down N% since added" / "up N% since added," comparing to the very first price recorded for that product.

So a slow bleed that never trips the daily threshold (₹2000 → ₹1990 → ₹1980…) still shows up honestly as "down X% since added," even though no single day's move was big enough to notify on.

## Known limitations (worth knowing upfront)

- **Flipkart-style JS-rendered sites lean on the slower tab-based fallback**, which briefly opens a real (inactive) tab — a bit more visible and a few seconds slower than a plain fetch, but far more reliable than trying to parse an empty HTML shell.
- **Daily granularity.** Checks run once every 24h by default (`CHECK_INTERVAL_MINUTES` in `background.js`) — you can lower it, but more frequent checks mean more automated traffic to the same sites, which raises block risk.
- **The browser must be open** for `chrome.alarms` to fire — this isn't a server-side tracker, it won't check prices while Chrome is fully closed.
- **No login/session support.** It checks pages anonymously, so member-only or region-locked prices won't be picked up.
- **Persistent blocks need a different tool, not a more aggressive scraper** — see "How prices are found" above.
- **Search-by-description accuracy varies by retailer** — see "Search by description" above.

## Extending it

- **New site for direct price tracking** — add one regex to `extractFromKnownSites()` in `utils/priceExtractor.js`.
- **New retailer for description search** — add one entry (`buildSearchUrl` + `parseFirstResult`) to the `RETAILERS` array in `utils/siteSearch.js`.
