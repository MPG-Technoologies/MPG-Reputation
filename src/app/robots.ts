import type { MetadataRoute } from "next";

/**
 * Prelaunch crawling policy.
 *
 * Allow bots to retrieve existing page-level/root <meta name="robots">
 * noindex directives. Disallowing all paths here would stop responsible
 * crawlers from observing those noindex directives.
 *
 * This is not public publication authorization or access control.
 * Do not add a sitemap or canonical domain until the owner approves
 * public indexing, the real domain, and the MR-11 release gates.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
  };
}
