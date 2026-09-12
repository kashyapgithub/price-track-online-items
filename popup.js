/**
 * popup.js
 * ----------------------------------------------------------------------------
 * Drives the popup UI: adding a new product link, rendering the tracked
 * list with current/lowest price, removing products, and triggering a
 * manual price check. All persistence goes through utils/storage.js and
 * all HTML fetching/parsing happens in background.js — this file only
 * touches the DOM.
 */

import { getProducts, addProduct, removeProduct, getMeta } from "./utils/storage.js";
import { extractTitle } from "./utils/priceExtractor.js";
import { getSettings, setSettings } from "./utils/settings.js";
import { getRecentDrops } from "./utils/dropLog.js";

const form = document.getElementById("addForm");
const urlInput = document.getElementById("urlInput");
const statusMsg = document.getElementById("statusMsg");
const productList = document.getElementById("productList");
const template = document.getElementById("productTemplate");
const checkNowBtn = document.getElementById("checkNowBtn");
const runDot = document.getElementById("runDot");
const runSummaryText = document.getElementById("runSummaryText");

const modeUrlBtn = document.getElementById("modeUrlBtn");
const modeSearchBtn = document.getElementById("modeSearchBtn");
const searchForm = document.getElementById("searchForm");
const descInput = document.getElementById("descInput");
const searchResultsList = document.getElementById("searchResultsList");
const searchResultTemplate = document.getElementById("searchResultTemplate");

const settingsBtn = document.getElementById("settingsBtn");
const settingsPanel = document.getElementById("settingsPanel");
const notifEnabled = document.getElementById("notifEnabled");
const minDropPercent = document.getElementById("minDropPercent");

const recentDropsSection = document.getElementById("recentDropsSection");
const recentDropsList = document.getElementById("recentDropsList");

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------
document.addEventListener("DOMContentLoaded", async () => {
  await renderRunSummary();
  await renderProducts();
  await initSettingsPanel();
  await renderRecentDrops();
  initAddModeToggle();
  // Clear the toolbar badge once the user has actually seen the drop count.
  chrome.action.setBadgeText({ text: "" });
});

// ---------------------------------------------------------------------------
// Add-mode toggle: paste-a-link vs. search-by-description
// ---------------------------------------------------------------------------
function initAddModeToggle() {
  modeUrlBtn.addEventListener("click", () => {
    modeUrlBtn.classList.add("active");
    modeSearchBtn.classList.remove("active");
    form.classList.remove("hidden");
    searchForm.classList.add("hidden");
    searchResultsList.classList.add("hidden");
    setStatus("");
  });

  modeSearchBtn.addEventListener("click", () => {
    modeSearchBtn.classList.add("active");
    modeUrlBtn.classList.remove("active");
    searchForm.classList.remove("hidden");
    form.classList.add("hidden");
    setStatus("");
  });
}

// ---------------------------------------------------------------------------
// Search by description — checks a small fixed list of retailers and shows
// the top match from each; the user picks which (if any) to track. See
// utils/siteSearch.js for exactly which retailers and how each is parsed.
// ---------------------------------------------------------------------------
searchForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const query = descInput.value.trim();
  if (!query) return;

  setStatus("Searching a few retailers — this takes a bit, one site at a time on purpose…");
  searchResultsList.innerHTML = "";
  searchResultsList.classList.add("hidden");
  searchForm.querySelector("button").disabled = true;

  const { results } = await chrome.runtime.sendMessage({ type: "SEARCH_RETAILERS", query });

  searchForm.querySelector("button").disabled = false;
  setStatus(`Done — checked ${results.length} retailer${results.length === 1 ? "" : "s"}.`);
  renderSearchResults(results);
});

function renderSearchResults(results) {
  searchResultsList.innerHTML = "";
  searchResultsList.classList.remove("hidden");

  for (const result of results) {
    const node = searchResultTemplate.content.cloneNode(true);
    node.querySelector(".sr-retailer").textContent = result.retailer;

    const titleEl = node.querySelector(".sr-title");
    const trackBtn = node.querySelector(".sr-track-btn");
    const priceEl = node.querySelector(".sr-price");

    if (result.error) {
      titleEl.textContent = result.error;
      titleEl.classList.add("sr-error");
      titleEl.removeAttribute("href");
      priceEl.textContent = "";
      trackBtn.disabled = true;
    } else {
      titleEl.textContent = result.title;
      titleEl.href = result.url;
      priceEl.textContent = `₹${result.price}`;

      trackBtn.addEventListener("click", async () => {
        trackBtn.disabled = true;
        trackBtn.textContent = "Adding…";
        const product = await addProduct({ url: result.url, title: result.title });
        await chrome.runtime.sendMessage({ type: "CHECK_ONE", productId: product.id });
        trackBtn.textContent = "Tracking ✓";
        await renderProducts();
        await renderRunSummary();
      });
    }

    searchResultsList.appendChild(node);
  }
}

// ---------------------------------------------------------------------------
// Settings panel
// ---------------------------------------------------------------------------
async function initSettingsPanel() {
  const settings = await getSettings();
  notifEnabled.checked = settings.notificationsEnabled;
  minDropPercent.value = String(settings.minDropPercent);

  settingsBtn.addEventListener("click", () => {
    settingsPanel.classList.toggle("hidden");
    settingsBtn.classList.toggle("active");
  });

  // Every control saves immediately — no separate "Save" button to forget to click.
  for (const [el, key, isNumber] of [
    [notifEnabled, "notificationsEnabled", false],
    [minDropPercent, "minDropPercent", true],
  ]) {
    el.addEventListener("change", async () => {
      const value = el.type === "checkbox" ? el.checked : isNumber ? Number(el.value) : el.value;
      await setSettings({ [key]: value });
    });
  }
}

// ---------------------------------------------------------------------------
// Recent drops log — visible even if a notification was suppressed/missed
// ---------------------------------------------------------------------------
async function renderRecentDrops() {
  const drops = await getRecentDrops();
  if (drops.length === 0) {
    recentDropsSection.classList.add("hidden");
    return;
  }

  recentDropsSection.classList.remove("hidden");
  recentDropsList.innerHTML = "";

  for (const drop of drops.slice(0, 10)) {
    const li = document.createElement("li");
    const mutedTag = drop.notified ? "" : ` <span class="drop-muted">(muted)</span>`;
    li.innerHTML = `
      <span class="drop-title">${escapeHtml(drop.title)}${mutedTag}</span>
      <span class="drop-amount">₹${drop.oldPrice} → ₹${drop.newPrice}</span>
    `;
    recentDropsList.appendChild(li);
  }
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ---------------------------------------------------------------------------
// Add a new product
// ---------------------------------------------------------------------------
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const url = urlInput.value.trim();
  if (!url) return;

  setStatus("Fetching product info…");

  let title = url;
  try {
    // Best-effort title fetch so the list shows a readable name instead of a raw URL.
    // If this fails (CORS, network), we still add the product and try again on the
    // next scheduled background check.
    const response = await fetch(url);
    const html = await response.text();
    title = extractTitle(html) || url;
  } catch {
    // Silently fall back to the raw URL as the title.
  }

  await addProduct({ url, title });
  urlInput.value = "";
  setStatus("Tracking added. First price check happens shortly.");
  await renderProducts();
});

// ---------------------------------------------------------------------------
// Manual "check now"
// ---------------------------------------------------------------------------
checkNowBtn.addEventListener("click", async () => {
  setStatus("Checking all prices…");
  checkNowBtn.disabled = true;
  await chrome.runtime.sendMessage({ type: "CHECK_ALL_NOW" });
  checkNowBtn.disabled = false;
  setStatus("Done.");
  await renderRunSummary();
  await renderProducts();
  await renderRecentDrops();
});

// ---------------------------------------------------------------------------
// Run summary strip — proof the daily check is actually happening
// ---------------------------------------------------------------------------
async function renderRunSummary() {
  const meta = await getMeta();

  if (!meta.lastRunAt) {
    runDot.className = "run-dot";
    runSummaryText.textContent = "Not checked yet — first check runs shortly after install.";
    return;
  }

  const when = formatRelativeTime(meta.lastRunAt);
  const dropPart =
    meta.lastRunDropCount > 0
      ? `${meta.lastRunDropCount} price drop${meta.lastRunDropCount > 1 ? "s" : ""} found 🎉`
      : "no drops";

  if (meta.lastRunError) {
    runDot.className = "run-dot warn";
    runSummaryText.textContent = `Checked ${when} · ${dropPart} · ${meta.lastRunError}`;
  } else {
    runDot.className = "run-dot ok";
    runSummaryText.textContent = `Checked ${meta.lastRunProductCount} product${
      meta.lastRunProductCount === 1 ? "" : "s"
    } ${when} · ${dropPart}`;
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Redraw the full product list from storage. */
async function renderProducts() {
  const products = await getProducts();
  productList.innerHTML = "";

  if (products.length === 0) {
    productList.innerHTML = `
      <li class="empty-state">
        <span class="empty-icon">🛒</span>
        No products tracked yet.<br />Paste a link above to start.
      </li>`;
    return;
  }

  // Newest first so recently added items are easy to find.
  for (const product of [...products].reverse()) {
    productList.appendChild(buildProductRow(product));
  }
}

/** Build a single <li> for a product using the <template> markup. */
function buildProductRow(product) {
  const node = template.content.cloneNode(true);

  const titleEl = node.querySelector(".product-title");
  titleEl.textContent = product.title;
  titleEl.href = product.url;

  const currentEl = node.querySelector(".current-price");
  const badgeEl = node.querySelector(".price-badge");
  const lowestEl = node.querySelector(".lowest-price");
  const metaEl = node.querySelector(".product-meta");
  const sparklineWrap = node.querySelector(".sparkline-wrap");

  if (product.currentPrice !== null) {
    currentEl.textContent = `₹${product.currentPrice}`;
    if (hasRecentDrop(product)) currentEl.classList.add("dropped");
  } else {
    currentEl.textContent = "—";
  }

  const dropPercent = computeDropPercent(product);
  if (dropPercent !== null) {
    badgeEl.textContent = `↓${dropPercent}%`;
    badgeEl.classList.add("show");
  }

  lowestEl.textContent =
    product.lowestPrice !== null ? `lowest ₹${product.lowestPrice}` : "";

  node.querySelector(".product-context").appendChild(buildContextLine(product));

  sparklineWrap.appendChild(buildSparkline(product.priceHistory));

  if (product.lastError) {
    metaEl.textContent = product.blocked
      ? `🚫 ${product.lastError}${product.consecutiveFailures > 1 ? ` (${product.consecutiveFailures} days running)` : ""}`
      : product.lastError;
    metaEl.classList.add("error");
  } else if (product.lastCheckedAt) {
    metaEl.textContent = `Checked ${formatRelativeTime(product.lastCheckedAt)}`;
  } else {
    metaEl.textContent = "Not checked yet";
  }

  node.querySelector(".remove-btn").addEventListener("click", async () => {
    await removeProduct(product.id);
    await renderProducts();
  });

  return node;
}

/**
 * Extra context beyond the day-over-day drop %: where today's price sits
 * relative to the all-time low, and relative to the price when you first
 * started tracking it. The day-over-day number (computeDropPercent, above)
 * is what actually decides whether a notification fires — this is just
 * additional context shown in the popup, not a second trigger.
 */
function buildContextLine(product) {
  const el = document.createElement("div");
  el.className = "context-line";

  if (product.currentPrice === null || product.priceHistory.length < 1) {
    return el; // nothing to compare yet
  }

  const parts = [];

  if (product.lowestPrice !== null) {
    if (product.currentPrice <= product.lowestPrice) {
      parts.push("at all-time low");
    } else {
      const aboveLowPct = Math.round(
        ((product.currentPrice - product.lowestPrice) / product.lowestPrice) * 100
      );
      parts.push(`${aboveLowPct}% above lowest`);
    }
  }

  const firstPrice = product.priceHistory[0].price;
  if (firstPrice !== product.currentPrice) {
    const vsAddedPct = Math.round(((firstPrice - product.currentPrice) / firstPrice) * 100);
    parts.push(
      vsAddedPct > 0 ? `down ${vsAddedPct}% since added` : `up ${Math.abs(vsAddedPct)}% since added`
    );
  }

  el.textContent = parts.join(" · ");
  return el;
}

/** True if the current price is the lowest ever seen (a good visual cue for "it dropped"). */
function hasRecentDrop(product) {
  return (
    product.currentPrice !== null &&
    product.lowestPrice !== null &&
    product.currentPrice === product.lowestPrice &&
    product.priceHistory.length > 1
  );
}

/** % drop from the price just before this one, for the little green "↓X%" badge. */
function computeDropPercent(product) {
  const history = product.priceHistory;
  if (history.length < 2) return null;

  const previous = history[history.length - 2].price;
  const latest = history[history.length - 1].price;
  if (latest >= previous) return null;

  return Math.round(((previous - latest) / previous) * 100);
}

/** Build a tiny inline SVG sparkline from a product's price history. No libraries needed. */
function buildSparkline(history) {
  const wrapper = document.createElement("div");
  if (history.length < 2) return wrapper; // not enough points for a trend line yet

  const width = 300;
  const height = 24;
  const padding = 2;

  const prices = history.map((h) => h.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const range = max - min || 1; // avoid divide-by-zero when price never changed

  const points = prices.map((price, i) => {
    const x = (i / (prices.length - 1)) * (width - padding * 2) + padding;
    const y = height - padding - ((price - min) / range) * (height - padding * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const trendColor = prices[prices.length - 1] <= prices[0] ? "#16a34a" : "#dc2626";

  wrapper.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
      <polyline points="${points.join(" ")}" fill="none" stroke="${trendColor}" stroke-width="1.5" />
    </svg>
  `;
  return wrapper;
}

/** Turn an epoch-ms timestamp into a short "x ago" string. */
function formatRelativeTime(timestamp) {
  const diffMs = Date.now() - timestamp;
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function setStatus(text) {
  statusMsg.textContent = text;
}
