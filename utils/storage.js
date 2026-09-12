/**
 * storage.js
 * ----------------------------------------------------------------------------
 * Thin wrapper around chrome.storage.local so the rest of the extension never
 * touches the raw chrome.storage API directly. Keeping all reads/writes in
 * one place makes it easy to change the storage shape later without hunting
 * through popup.js / background.js.
 *
 * Data shape stored under the key "products":
 * [
 *   {
 *     id: string            -> unique id (timestamp-based)
 *     url: string            -> product page URL the user pasted
 *     title: string          -> best-effort product name (from page <title> or og:title)
 *     currentPrice: number|null
 *     lowestPrice: number|null
 *     priceHistory: [{ price: number, checkedAt: number }]  -> capped list, newest last
 *     lastCheckedAt: number|null  -> epoch ms
 *     lastError: string|null      -> last scrape error, if any (shown in popup)
 *     addedAt: number             -> epoch ms
 *   },
 *   ...
 * ]
 */

const STORAGE_KEY = "products";
const META_KEY = "meta"; // { lastRunAt, lastRunDropCount, lastRunError, lastRunProductCount }
const MAX_HISTORY_POINTS = 60; // ~2 months of daily checks per product, keeps storage small

/** Fetch the full list of tracked products. Always returns an array. */
export async function getProducts() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return Array.isArray(result[STORAGE_KEY]) ? result[STORAGE_KEY] : [];
}

/** Overwrite the entire product list. Internal helper — prefer the specific functions below. */
async function saveProducts(products) {
  await chrome.storage.local.set({ [STORAGE_KEY]: products });
}

/** Add a new product to track. Returns the newly created product object. */
export async function addProduct({ url, title }) {
  const products = await getProducts();

  const newProduct = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    url,
    title: title || url,
    currentPrice: null,
    lowestPrice: null,
    priceHistory: [],
    lastCheckedAt: null,
    lastError: null,
    addedAt: Date.now(),
  };

  products.push(newProduct);
  await saveProducts(products);
  return newProduct;
}

/** Remove a tracked product by id. */
export async function removeProduct(id) {
  const products = await getProducts();
  const filtered = products.filter((p) => p.id !== id);
  await saveProducts(filtered);
}

/**
 * Update a product's price after a scrape attempt.
 * Handles history trimming and lowest-price tracking in one place.
 * Returns { product, droppedFrom } — droppedFrom is the previous price if
 * this update represents a genuine price drop, otherwise null.
 */
export async function recordPriceCheck(id, { price, error }) {
  const products = await getProducts();
  const index = products.findIndex((p) => p.id === id);
  if (index === -1) return { product: null, droppedFrom: null };

  const product = products[index];
  product.lastCheckedAt = Date.now();

  if (error) {
    product.lastError = error;
    products[index] = product;
    await saveProducts(products);
    return { product, droppedFrom: null };
  }

  product.lastError = null;
  const previousPrice = product.currentPrice;
  const isDrop = typeof previousPrice === "number" && price < previousPrice;

  product.currentPrice = price;
  product.lowestPrice =
    typeof product.lowestPrice === "number" ? Math.min(product.lowestPrice, price) : price;

  product.priceHistory.push({ price, checkedAt: Date.now() });
  if (product.priceHistory.length > MAX_HISTORY_POINTS) {
    product.priceHistory = product.priceHistory.slice(-MAX_HISTORY_POINTS);
  }

  products[index] = product;
  await saveProducts(products);

  return { product, droppedFrom: isDrop ? previousPrice : null };
}

/**
 * Meta info about the last full daily run — this is what lets the popup say
 * "checked 3h ago, 2 drops found" without recomputing anything, and it's
 * what proves (to the user, verifiably) that the daily check actually ran.
 */
export async function getMeta() {
  const result = await chrome.storage.local.get(META_KEY);
  return (
    result[META_KEY] || {
      lastRunAt: null,
      lastRunDropCount: 0,
      lastRunProductCount: 0,
      lastRunError: null,
    }
  );
}

export async function setMeta(partial) {
  const current = await getMeta();
  const merged = { ...current, ...partial };
  await chrome.storage.local.set({ [META_KEY]: merged });
  return merged;
}
