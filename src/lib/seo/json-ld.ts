import type { Branding } from "@/lib/branding";

/**
 * Typed builders for schema.org JSON-LD. Each returns a plain object ready to
 * pass to the <JsonLd> component. Branding-derived fields (name, ABN, legal
 * name, socials) are always passed in by the caller from getBranding() — these
 * builders never hardcode a trading name/ABN (multi-tenant rule).
 *
 * All inputs are decoupled from Prisma models (callers map their data in) so
 * the builders stay pure and unit-testable.
 */
export type JsonLdNode = Record<string, unknown>;

const SCHEMA_CONTEXT = "https://schema.org";

function withContext(node: JsonLdNode): JsonLdNode {
  return { "@context": SCHEMA_CONTEXT, ...node };
}

const truthy = <T>(v: T | null | undefined | ""): v is T => Boolean(v);

// ── Organization ────────────────────────────────────────────────────────────

export type OrgBranding = Pick<
  Branding,
  "siteName" | "legalName" | "abn" | "supportPhone" | "supportEmail" | "social"
>;

export interface OrganizationInput {
  branding: OrgBranding;
  /** Site origin, e.g. https://xpertmoto.com.au */
  url: string;
  logoUrl?: string | null;
}

export function organizationLd(input: OrganizationInput): JsonLdNode {
  const { branding, url } = input;
  const sameAs = [
    branding.social.facebook,
    branding.social.instagram,
    branding.social.tiktok,
    branding.social.youtube,
  ].filter(truthy);
  return withContext({
    "@type": "Organization",
    "@id": `${url}/#organization`,
    name: branding.siteName,
    url,
    ...(branding.legalName ? { legalName: branding.legalName } : {}),
    ...(branding.abn ? { taxID: branding.abn } : {}),
    ...(input.logoUrl ? { logo: input.logoUrl } : {}),
    ...(branding.supportEmail ? { email: branding.supportEmail } : {}),
    ...(branding.supportPhone ? { telephone: branding.supportPhone } : {}),
    ...(sameAs.length ? { sameAs } : {}),
  });
}

// ── LocalBusiness (one per depot) ────────────────────────────────────────────

export interface DepotLd {
  name: string;
  slug: string;
  addressLine1: string;
  addressLine2?: string | null;
  suburb: string;
  state: string;
  postcode: string;
  country: string;
  latitude?: number | null;
  longitude?: number | null;
  phone?: string | null;
  email?: string | null;
}

export interface LocalBusinessInput {
  depot: DepotLd;
  siteName: string;
  /** Site origin. */
  url: string;
}

export function localBusinessLd(input: LocalBusinessInput): JsonLdNode {
  const { depot, url, siteName } = input;
  const streetAddress = [depot.addressLine1, depot.addressLine2].filter(truthy).join(", ");
  const hasGeo = depot.latitude != null && depot.longitude != null;
  return withContext({
    // AutoRental is the LocalBusiness subtype for a vehicle-hire location.
    "@type": "AutoRental",
    "@id": `${url}/locations#${depot.slug}`,
    name: `${siteName} — ${depot.name}`,
    url: `${url}/locations`,
    parentOrganization: { "@id": `${url}/#organization` },
    address: {
      "@type": "PostalAddress",
      streetAddress,
      addressLocality: depot.suburb,
      addressRegion: depot.state,
      postalCode: depot.postcode,
      addressCountry: depot.country,
    },
    ...(depot.phone ? { telephone: depot.phone } : {}),
    ...(depot.email ? { email: depot.email } : {}),
    ...(hasGeo
      ? {
          geo: {
            "@type": "GeoCoordinates",
            latitude: depot.latitude,
            longitude: depot.longitude,
          },
        }
      : {}),
  });
}

// ── Product (one fleet model) ────────────────────────────────────────────────

export interface ProductInput {
  name: string;
  description: string;
  /** Absolute URL of the fleet detail page. */
  url: string;
  images?: string[];
  /** Manufacturer / make. */
  brand?: string | null;
  /** "From" price — the GST-inclusive daily rate in AUD. */
  dailyRate: number;
  inStock: boolean;
}

export function productLd(input: ProductInput): JsonLdNode {
  return withContext({
    "@type": "Product",
    name: input.name,
    description: input.description,
    url: input.url,
    ...(input.images?.length ? { image: input.images } : {}),
    ...(input.brand ? { brand: { "@type": "Brand", name: input.brand } } : {}),
    offers: {
      "@type": "Offer",
      url: input.url,
      priceCurrency: "AUD",
      price: input.dailyRate.toFixed(2),
      // Displayed prices are GST-inclusive (CLAUDE.md rule #1).
      valueAddedTaxIncluded: true,
      availability: `https://schema.org/${input.inStock ? "InStock" : "OutOfStock"}`,
    },
  });
}

// ── BreadcrumbList ───────────────────────────────────────────────────────────

export interface Crumb {
  name: string;
  /** Absolute URL. */
  url: string;
}

export function breadcrumbLd(items: Crumb[]): JsonLdNode {
  return withContext({
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: item.url,
    })),
  });
}

// ── FAQPage ──────────────────────────────────────────────────────────────────

export interface FaqEntry {
  question: string;
  answer: string;
}

export function faqPageLd(items: FaqEntry[]): JsonLdNode {
  return withContext({
    "@type": "FAQPage",
    mainEntity: items.map((f) => ({
      "@type": "Question",
      name: f.question,
      acceptedAnswer: { "@type": "Answer", text: f.answer },
    })),
  });
}

// ── AggregateRating + Review ─────────────────────────────────────────────────

export interface ReviewEntry {
  author: string;
  rating: number;
  body: string;
  /** ISO-8601 date if available. */
  datePublished?: string;
}

export interface ReviewsInput {
  siteName: string;
  /** Site origin. */
  url: string;
  reviews: ReviewEntry[];
  ratingValue: number;
  reviewCount: number;
}

/**
 * Attaches genuine on-page reviews + their aggregate to the Organization.
 *
 * NOTE: per Google policy these MUST mirror reviews actually rendered on the
 * page (they do — the reviews page lists them). Self-serving Organization
 * reviews may not produce star rich-results in Google (they can for Product),
 * but the markup is valid and consumed by other crawlers; we keep it.
 */
export function reviewsLd(input: ReviewsInput): JsonLdNode {
  return withContext({
    "@type": "Organization",
    "@id": `${input.url}/#organization`,
    name: input.siteName,
    url: input.url,
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: input.ratingValue.toFixed(1),
      reviewCount: input.reviewCount,
      bestRating: 5,
      worstRating: 1,
    },
    review: input.reviews.map((r) => ({
      "@type": "Review",
      author: { "@type": "Person", name: r.author },
      reviewRating: {
        "@type": "Rating",
        ratingValue: r.rating,
        bestRating: 5,
        worstRating: 1,
      },
      reviewBody: r.body,
      ...(r.datePublished ? { datePublished: r.datePublished } : {}),
    })),
  });
}
