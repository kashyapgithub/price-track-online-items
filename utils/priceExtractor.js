/**
 * priceExtractor.js
 * ----------------------------------------------------------------------------
 * Extracts a price (and title) from a raw HTML string.
 *
 * Why regex on raw text instead of DOMParser?
 * MV3 background service workers have no `document`, so we can't parse HTML
 * into a real DOM there. Regex over structured metadata (JSON-LD, OpenGraph,
 * itemprop) covers the vast majority of e-commerce sites because they all
 * publish this metadata for SEO / rich snippets — it's more reliable than
 * scraping visual CSS classes, which change often and differ per site.
 *
 * Extraction order (first match wins):
 *   1. JSON-LD "offers.price"        (schema.org Product markup)
 *   2. <meta property="og:price:amount">
 *   3. <meta itemprop="price" content="...">
 *   4. Site-specific fallback regex (Amazon, Flipkart) for pages without the above
 */

/** Try to pull a price out of JSON-LD <script type="application/ld+json"> blocks. */
function extractFromJsonLd(html) {
  const scriptMatches = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );

  for (const match of scriptMatches) {
    try {
      const json = JSON.parse(match[1].trim());
      const candidates = Array.isArray(json) ? json : [json];

      for (const node of candidates) {
        const offers = node?.offers ?? node?.["@graph"]?.find((n) => n?.offers)?.offers;
        const offer = Array.isArray(offers) ? offers[0] : offers;
        const price = offer?.price ?? offer?.lowPrice;
        if (price !== undefined) {
          const numeric = parseFloat(String(price).replace(/,/g, ""));
          if (!Number.isNaN(numeric)) return numeric;
        }
      }
    } catch {
      // Malformed JSON-LD is common (trailing commas, comments) — just skip it.
      continue;
    }
  }
  return null;
}

/** Try <meta property="og:price:amount" content="..."> style tags. */
function extractFromMeta(html) {
  const metaPatterns = [
    /<meta[^>]+property=["']og:price:amount["'][^>]+content=["']([\d,.]+)["']/i,
    /<meta[^>]+itemprop=["']price["'][^>]+content=["']([\d,.]+)["']/i,
    /<meta[^>]+content=["']([\d,.]+)["'][^>]+itemprop=["']price["']/i,
  ];

  for (const pattern of metaPatterns) {
    const match = html.match(pattern);
    if (match) {
      const numeric = parseFloat(match[1].replace(/,/g, ""));
      if (!Number.isNaN(numeric)) return numeric;
    }
  }
  return null;
}

/** Last-resort fallback: known CSS-class patterns for a couple of big Indian retailers. */
function extractFromKnownSites(html, url) {
  const host = new URL(url).hostname;

  if (host.includes("amazon.")) {
    const match = html.match(/class="a-price-whole">([\d,]+)/);
    if (match) return parseFloat(match[1].replace(/,/g, ""));
  }

  if (host.includes("flipkart.")) {
    const match = html.match(/class="_30jeq3[^"]*">₹([\d,]+)/);
    if (match) return parseFloat(match[1].replace(/,/g, ""));
  }

  return null;
}

/** Pull a human-readable title from og:title or <title>, used only when adding a product. */
export function extractTitle(html) {
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (ogTitle) return ogTitle[1].trim();

  const titleTag = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleTag) return titleTag[1].trim();

  return null;
}

/**
 * Main entry point. Returns a numeric price, or null if nothing could be found.
 * @param {string} html - raw HTML text of the product page
 * @param {string} url - the page URL (used for site-specific fallbacks)
 */
export function extractPrice(html, url) {
  return (
    extractFromJsonLd(html) ??
    extractFromMeta(html) ??
    extractFromKnownSites(html, url)
  );
}
