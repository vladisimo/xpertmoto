/**
 * Server-only loader for help article bodies. Prose lives as markdown files
 * under `content/help/` (read at request time — the app does not use Next's
 * `output: standalone`, so the repo's content tree is present at runtime).
 *
 * Do not import this from a client component — it touches the file system.
 */
import "server-only";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { getArticle } from "./manifest";
import type { Branding } from "@/lib/branding";

const CONTENT_ROOT = path.join(process.cwd(), "content", "help");

/**
 * Read the raw markdown for an article. Returns null for an unknown slug or a
 * missing file so the route can render `notFound()`.
 */
export async function loadArticleBody(slug: string): Promise<string | null> {
  const article = getArticle(slug);
  if (!article) return null;
  try {
    return await readFile(path.join(CONTENT_ROOT, article.file), "utf8");
  } catch {
    return null;
  }
}

/**
 * Replace branding tokens so help prose never hardcodes a trading name / ABN
 * (see the branding rule in src/lib/CLAUDE.md). Supported tokens:
 * {{siteName}}, {{legalName}}, {{abn}}, {{supportEmail}}.
 */
export function applyBrandingTokens(body: string, branding: Branding): string {
  return body
    .replaceAll("{{siteName}}", branding.siteName)
    .replaceAll("{{legalName}}", branding.legalName)
    .replaceAll("{{abn}}", branding.abn)
    .replaceAll("{{supportEmail}}", branding.supportEmail ?? "our support team");
}
