/**
 * siteSearch.js
 * ----------------------------------------------------------------------------
 * Powers "search by description" instead of pasting a link. This is
 * deliberately scoped, not a general web search:
 *   - It only checks a small, fixed list of named retailers below.
 *   - It shows you the top match from EACH one so you pick which to track —
 *     it never silently decides "the best" price for you.
 *
 * Each retailer needs two things:
 *   buildSearchUrl(query) -> the retailer's own search results URL
 *   parseFirstResult(html, searchUrl) -> { title, price, url } | null,
 *     pulled from the rendered search results page.
 *
 * Amazon and Flipkart use fairly stable result markup, so their parsers are
 * reasonably reliable. Croma and Reliance Digital use a more generic
 * heuristic (first product link + nearest ₹ amount) — best-effort, and the
 * first place to improve if their markup changes. Adding a new retailer is
 * just adding one more entry to RETAILERS.
 */

export const RETAILERS = [
  {
    name: "Amazon",
    buildSearchUrl: (query) => `https://www.amazon.in/s?k=${encodeURIComponent(query)}`,
    parseFirstResult: (html, searchUrl) => {
      // First product card links to /dp/<ASIN>. Grab that, then the nearest
      // a-price-whole after it for the price, and the nearest h2 text for title.
      const linkMatch = html.match(/href="(\/[^"]*\/dp\/[A-Z0-9]{10}[^"]*)"/);
      if (!linkMatch) return null;

      const afterLink = html.slice(html.indexOf(linkMatch[0]));
      const priceMatch = afterLink.match(/a-price-whole">([\d,]+)/);
      const titleMatch = afterLink.match(/<h2[^>]*>[\s\S]*?>([^<]{5,150})<\/[a-z]+>[\s\S]*?<\/h2>/i);

      if (!priceMatch) return null;

      return {
        title: titleMatch ? decodeHtml(titleMatch[1].trim()) : "Amazon result",
        price: parseFloat(priceMatch[1].replace(/,/g, "")),
        url: new URL(linkMatch[1], searchUrl).toString(),
      };
    },
  },
  {
    name: "Flipkart",
    buildSearchUrl: (query) => `https://www.flipkart.com/search?q=${encodeURIComponent(query)}`,
    parseFirstResult: (html, searchUrl) => {
      const linkMatch = html.match(/href="(\/[^"]+\/p\/[^"?]+)/);
      if (!linkMatch) return null;

      const afterLink = html.slice(html.indexOf(linkMatch[0]));
      const priceMatch = afterLink.match(/₹([\d,]+)/);
      const titleMatch = html.match(/<title>([^<]+)<\/title>/i);

      if (!priceMatch) return null;

      return {
        title: titleMatch ? decodeHtml(titleMatch[1].replace(/\s*-\s*Buy.*$/i, "").trim()) : "Flipkart result",
        price: parseFloat(priceMatch[1].replace(/,/g, "")),
        url: new URL(linkMatch[1], searchUrl).toString(),
      };
    },
  },
  {
    name: "Croma",
    buildSearchUrl: (query) => `https://www.croma.com/searchB?q=${encodeURIComponent(query)}%3Arelevance`,
    parseFirstResult: (html, searchUrl) => genericFirstResult(html, searchUrl, "Croma"),
  },
  {
    name: "Reliance Digital",
    buildSearchUrl: (query) => `https://www.reliancedigital.in/search?q=${encodeURIComponent(query)}`,
    parseFirstResult: (html, searchUrl) => genericFirstResult(html, searchUrl, "Reliance Digital"),
  },
];

/**
 * Best-effort generic fallback for retailers without a dedicated parser:
 * take the first internal product-looking link, then the nearest ₹ amount
 * after it in the page. Rougher than the site-specific parsers above —
 * expect this to misfire more often on layout changes.
 */
function genericFirstResult(html, searchUrl, label) {
  const linkMatch = html.match(/href="(\/(?:p|product)\/[^"?]+)/i);
  if (!linkMatch) return null;

  const afterLink = html.slice(html.indexOf(linkMatch[0]));
  const priceMatch = afterLink.match(/₹\s?([\d,]+)/);
  if (!priceMatch) return null;

  return {
    title: `${label} result`,
    price: parseFloat(priceMatch[1].replace(/,/g, "")),
    url: new URL(linkMatch[1], searchUrl).toString(),
  };
}

function decodeHtml(str) {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');
}
