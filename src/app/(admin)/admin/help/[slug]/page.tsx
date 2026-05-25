import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getArticle, HELP_ARTICLES } from "@/lib/help/manifest";
import { loadArticleBody, applyBrandingTokens } from "@/lib/help/content";
import { getBranding } from "@/lib/branding";
import { HelpShell } from "@/components/help/help-shell";
import { HelpArticleView } from "@/components/help/help-article-view";

export function generateStaticParams() {
  return HELP_ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const article = getArticle(slug);
  return { title: article ? `${article.title} · Help` : "Help" };
}

export default async function AdminHelpArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const article = getArticle(slug);
  const body = await loadArticleBody(slug);
  if (!article || body == null) notFound();

  const branding = await getBranding();
  return (
    <HelpShell basePath="/admin/help">
      <HelpArticleView
        article={article}
        body={applyBrandingTokens(body, branding)}
        basePath="/admin/help"
      />
    </HelpShell>
  );
}
