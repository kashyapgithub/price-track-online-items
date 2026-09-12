/**
 * productPageDetector.js
 * ----------------------------------------------------------------------------
 * Powers the "Track this page" banner: when the popup opens, it checks the
 * active tab's URL against these patterns to decide whether it's looking at
 * an actual product page (not a homepage, search results, or category
 * listing) on one of the four supported retailers.
 *
 * Each pattern targets the part of the URL that's specific to a real
 * product page — an ASIN for Amazon, a "/p/" product-slug segment for the
 * other three — so a homepage or search URL correctly matches nothing.
 */

const DETECTORS = [
  {
    retailer: "Amazon",
    hostPattern: /(^|\.)amazon\.[a-z.]+$/i,
    pathPattern: /\/(dp|gp\/product)\/[A-Z0-9]{10}/i,
  },
  {
    retailer: "Flipkart",
    hostPattern: /(^|\.)flipkart\.com$/i,
    pathPattern: /\/p\//i,
  },
  {
    retailer: "Croma",
    hostPattern: /(^|\.)croma\.com$/i,
    pathPattern: /\/p\/\d+/i,
  },
  {
    retailer: "Reliance Digital",
    hostPattern: /(^|\.)reliancedigital\.in$/i,
    pathPattern: /\/p\/\d+/i,
  },
];

/**
 * @param {string} url
 * @returns {{ retailer: string } | null} — the matching retailer, or null if
 *          this isn't a recognized product page (includes non-product pages
 *          on a supported retailer, like its homepage or search results).
 */
export function detectProductPage(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  for (const detector of DETECTORS) {
    if (detector.hostPattern.test(parsed.hostname) && detector.pathPattern.test(parsed.pathname)) {
      return { retailer: detector.retailer };
    }
  }
  return null;
}
