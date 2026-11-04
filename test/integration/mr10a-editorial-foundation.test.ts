import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  EDITORIAL_ARTICLES,
  findEditorialArticle,
} from "../../src/components/marketing/editorial-library";

const root = process.cwd();

describe("MR-10A editorial foundation", () => {
  it("contains two uniquely identified educational guides", () => {
    expect(EDITORIAL_ARTICLES).toHaveLength(2);

    const slugs = EDITORIAL_ARTICLES.map(article => article.slug);

    expect(new Set(slugs).size).toBe(slugs.length);
    expect(slugs).toContain("a-repeatable-review-request-workflow");
    expect(slugs).toContain("understanding-review-request-activity");
  });

  it("provides meaningful content for each article", () => {
    for (const article of EDITORIAL_ARTICLES) {
      expect(article.title.trim().length).toBeGreaterThan(10);
      expect(article.summary.trim().length).toBeGreaterThan(20);
      expect(article.sections.length).toBeGreaterThanOrEqual(3);

      for (const section of article.sections) {
        expect(section.heading.trim().length).toBeGreaterThan(3);
        expect(section.paragraphs.length).toBeGreaterThan(0);
        expect(
          section.paragraphs.every(p => p.trim().length > 20)
        ).toBe(true);
      }
    }
  });

  it("resolves known articles and rejects unknown slugs", () => {
    for (const article of EDITORIAL_ARTICLES) {
      expect(findEditorialArticle(article.slug)).toBe(article);
    }

    expect(findEditorialArticle("unknown-article")).toBeUndefined();
  });

  it("distinguishes request activity from published reviews", () => {
    const content = JSON.stringify(EDITORIAL_ARTICLES);

    expect(content).toContain("A completion is not a review");
    expect(content).toContain("Clicks are not published reviews");
    expect(content).toContain("30 Free Review Requests");
    expect(content).toContain("does not guarantee positive reviews");
  });

  it("links the guides from the existing Resources page", () => {
    const source = readFileSync(
      path.join(root, "src/components/marketing/Resources.tsx"),
      "utf8"
    );

    expect(source).toContain("EDITORIAL_ARTICLES.map");
    expect(source).toContain("href={`/resources/${article.slug}`}");
    expect(source).toContain("Educational guides");
  });

  it("keeps article pages non-indexed during prelaunch", () => {
    const source = readFileSync(
      path.join(root, "src/app/resources/[slug]/page.tsx"),
      "utf8"
    );

    expect(source).toContain("generateStaticParams");
    expect(source).toContain("generateMetadata");
    expect(source).toContain("index: false");
    expect(source).toContain("follow: false");
    expect(source).toContain("notFound()");
  });

  it("does not introduce data collection or external APIs", () => {
    const articlePage = readFileSync(
      path.join(root, "src/app/resources/[slug]/page.tsx"),
      "utf8"
    );

    expect(articlePage).not.toMatch(
      /fetch\(|supabase|localStorage|sessionStorage|navigator\.sendBeacon/
    );
  });
});