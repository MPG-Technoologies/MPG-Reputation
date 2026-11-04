import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { SiteNav } from "@/components/marketing/site/SiteNav";
import { SiteFooter } from "@/components/marketing/site/SiteFooter";
import {
  EDITORIAL_ARTICLES,
  findEditorialArticle
} from "@/components/marketing/editorial-library";

type Props = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return EDITORIAL_ARTICLES.map(article => ({
    slug: article.slug
  }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const article = findEditorialArticle(slug);

  return {
    title: article
      ? `${article.title} | MPG Reputation`
      : "Resource Not Found | MPG Reputation",
    description: article?.summary,
    robots: { index: false, follow: false }
  };
}

export default async function ArticlePage({ params }: Props) {
  const { slug } = await params;
  const article = findEditorialArticle(slug);

  if (!article) notFound();

  return (
    <div className="mr9-site min-h-screen bg-paper">
      <SiteNav />

      <main className="mx-auto max-w-4xl px-5 py-16 sm:px-8">
        <Link
          href="/resources"
          className="text-sm font-medium text-ember hover:underline"
        >
          Back to Resources
        </Link>

        <header className="mt-10 border-b border-line pb-10">
          <p className="kicker text-ember">
            {article.category} · Internal Preview
          </p>

          <h1 className="mt-4 font-display text-4xl font-bold text-ink">
            {article.title}
          </h1>

          <p className="mt-5 text-lg leading-8 text-ink-soft">
            {article.summary}
          </p>
        </header>

        <article className="mt-12 space-y-12">
          {article.sections.map(section => (
            <section key={section.heading}>
              <h2 className="font-display text-2xl font-semibold text-ink">
                {section.heading}
              </h2>

              {section.paragraphs.map(paragraph => (
                <p
                  key={paragraph}
                  className="mt-4 leading-8 text-ink-soft"
                >
                  {paragraph}
                </p>
              ))}
            </section>
          ))}
        </article>

        <aside className="mt-16 rounded-xl border border-line bg-card p-8">
          <h2 className="text-xl font-semibold text-ink">
            Explore MPG Reputation
          </h2>

          <p className="mt-3 text-ink-soft">
            Learn how our existing application supports honest,
            consistent review-request workflows.
          </p>

          <div className="mt-6 flex flex-wrap gap-4">
            <Link href="/features" className="font-semibold text-ember hover:underline">
              Explore Features
            </Link>
            <Link href="/reputation-check" className="font-semibold text-ember hover:underline">
              Free Reputation Check
            </Link>
          </div>

          <p className="mt-6 text-xs text-ink-mute">
            Prelaunch preview. No live billing, marketing tracking,
            or customer messaging is activated.
          </p>
        </aside>
      </main>

      <SiteFooter />
    </div>
  );
}