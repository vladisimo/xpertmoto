import type { MetadataRoute } from "next";
import { connection } from "next/server";
import { prisma } from "@/lib/prisma";
import { TOURS } from "@/content/tours";
import { getSiteUrl } from "@/lib/seo/site-url";
import { RENTABLE_MODEL_WHERE } from "@/lib/fleet/consumer-visibility";

/**
 * Static public routes that always exist (excludes auth/portal/admin/staff/api
 * and the transactional booking flow). Tuples: [path, changeFrequency, priority].
 */
const STATIC_ROUTES: Array<
  [string, MetadataRoute.Sitemap[number]["changeFrequency"], number]
> = [
  ["/", "daily", 1.0],
  ["/fleet", "weekly", 0.9],
  ["/tours", "weekly", 0.9],
  ["/pricing", "weekly", 0.9],
  ["/locations", "weekly", 0.9],
  ["/mechanic-services", "monthly", 0.7],
  ["/why-xpert", "monthly", 0.7],
  ["/reviews", "monthly", 0.7],
  ["/contact", "monthly", 0.6],
  ["/faq", "monthly", 0.6],
  ["/gift-cards", "monthly", 0.6],
  ["/trust", "yearly", 0.4],
  ["/terms", "yearly", 0.3],
  ["/privacy", "yearly", 0.3],
  ["/refund-policy", "yearly", 0.3],
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Opt into dynamic rendering (cacheComponents:true forbids `dynamic`/
  // `revalidate`); guarantees freshly-published fleet models appear at once.
  await connection();

  const base = getSiteUrl();
  const url = (path: string) => `${base}${path}`;
  const now = new Date();

  const staticEntries: MetadataRoute.Sitemap = STATIC_ROUTES.map(
    ([path, changeFrequency, priority]) => ({
      url: url(path),
      lastModified: now,
      changeFrequency,
      priority,
    }),
  );

  // Fleet model pages — only rentable models with at least one active unit,
  // mirroring the detail page's 404 rule so listed URLs never 404.
  const models = await prisma.vehicleModel.findMany({
    where: RENTABLE_MODEL_WHERE,
    select: { slug: true, updatedAt: true },
  });
  const fleetEntries: MetadataRoute.Sitemap = models.map((m) => ({
    url: url(`/fleet/${m.slug}`),
    lastModified: m.updatedAt,
    changeFrequency: "weekly",
    priority: 0.8,
  }));

  // Tour detail pages — sourced from the static content module.
  const tourEntries: MetadataRoute.Sitemap = TOURS.map((t) => ({
    url: url(`/tours/${t.slug}`),
    lastModified: now,
    changeFrequency: "monthly",
    priority: 0.6,
  }));

  return [...staticEntries, ...fleetEntries, ...tourEntries];
}
