/**
 * Pure, client-safe helpers over the help manifest. No file-system access —
 * safe to import into client components (the ⌘K palette, the PageHeader `?`).
 */
import { HELP_ARTICLES, type HelpArticle } from "./manifest";
import { BACK_OFFICE_NAV } from "@/lib/nav";

const MAX_RESULTS = 8;

/**
 * Rank a query against an article. Higher is better; 0 means no match.
 * Title hits outrank keyword hits, which outrank summary hits — a "fleet"
 * query should put the "Fleet" article above one that merely mentions fleet.
 */
function score(article: HelpArticle, q: string): number {
  const title = article.title.toLowerCase();
  const summary = article.summary.toLowerCase();
  const keywords = article.keywords.map((k) => k.toLowerCase());

  let s = 0;
  if (title === q) s += 100;
  if (title.includes(q)) s += 40;
  if (keywords.some((k) => k === q)) s += 30;
  if (keywords.some((k) => k.includes(q))) s += 15;
  if (summary.includes(q)) s += 8;
  return s;
}

/** Case-insensitive ranked search over title, keywords and summary. */
export function searchArticles(query: string): HelpArticle[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return HELP_ARTICLES.map((a) => ({ a, s: score(a, q) }))
    .filter((x) => x.s > 0)
    .sort((x, y) => y.s - x.s || x.a.title.localeCompare(y.a.title))
    .slice(0, MAX_RESULTS)
    .map((x) => x.a);
}

/**
 * Resolve the most specific help article for a back-office route. Mirrors the
 * shell's active-route logic: longest matching `relatedNav` prefix wins, so
 * `/staff/bookings/abc/check-out` resolves to the check-out article over a
 * generic `/staff` one. Returns null when nothing maps (e.g. customer pages).
 *
 * Getting-started guides are excluded — they're orientation reading, browsed
 * from the index, not the answer to "help for *this* page".
 */
export function getContextualHelpSlug(pathname: string): string | null {
  let best: { slug: string; len: number } | null = null;
  for (const article of HELP_ARTICLES) {
    if (article.category === "getting-started") continue;
    for (const nav of article.relatedNav) {
      const matches = pathname === nav || pathname.startsWith(nav + "/");
      if (matches && (!best || nav.length > best.len)) {
        best = { slug: article.slug, len: nav.length };
      }
    }
  }
  return best?.slug ?? null;
}

/**
 * Human label for a related-page href. Prefers the back-office nav label (so
 * "/staff/fleet" reads "Fleet"), then a nav child label, then a humanised last
 * path segment for routes that aren't in the sidebar (maintenance, incidents…).
 */
export function navLabelForHref(href: string): string {
  for (const item of BACK_OFFICE_NAV) {
    if (item.href === href) return item.label;
    const child = item.children?.find((c) => c.href === href);
    if (child) return child.label;
  }
  const pathPart = href.split("?")[0] ?? href;
  const segment = pathPart.split("/").filter(Boolean).pop() ?? href;
  return segment
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
