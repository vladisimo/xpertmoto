import { describe, it, expect } from "vitest";
import {
  organizationLd,
  localBusinessLd,
  productLd,
  breadcrumbLd,
  faqPageLd,
  reviewsLd,
  type OrgBranding,
} from "@/lib/seo/json-ld";

const BRANDING: OrgBranding = {
  siteName: "XPERT Moto",
  legalName: "XPERT Moto Group Pty Ltd",
  abn: "72 629 456 408",
  supportPhone: "+61 2 1234 5678",
  supportEmail: "hello@example.com",
  social: {
    facebook: "https://facebook.com/x",
    instagram: null,
    tiktok: null,
    youtube: "https://youtube.com/x",
  },
};

describe("organizationLd", () => {
  it("emits a contextful Organization with ABN, contacts and filtered sameAs", () => {
    const ld = organizationLd({ branding: BRANDING, url: "https://x.com", logoUrl: "https://x.com/l.png" });
    expect(ld).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": "https://x.com/#organization",
      name: "XPERT Moto",
      legalName: "XPERT Moto Group Pty Ltd",
      taxID: "72 629 456 408",
      logo: "https://x.com/l.png",
      email: "hello@example.com",
      telephone: "+61 2 1234 5678",
      sameAs: ["https://facebook.com/x", "https://youtube.com/x"],
    });
  });

  it("omits optional fields when absent", () => {
    const ld = organizationLd({
      branding: { ...BRANDING, abn: "", legalName: "", supportPhone: null, supportEmail: null, social: { facebook: null, instagram: null, tiktok: null, youtube: null } },
      url: "https://x.com",
    });
    expect(ld).not.toHaveProperty("taxID");
    expect(ld).not.toHaveProperty("sameAs");
    expect(ld).not.toHaveProperty("telephone");
    expect(ld).not.toHaveProperty("logo");
  });
});

describe("localBusinessLd", () => {
  const depot = {
    name: "Lewisham",
    slug: "lewisham",
    addressLine1: "798 Parramatta Rd",
    addressLine2: "Unit 2",
    suburb: "Lewisham",
    state: "NSW",
    postcode: "2049",
    country: "Australia",
    latitude: -33.89,
    longitude: 151.14,
    phone: "+61 2 0000",
    email: "depot@example.com",
  };

  it("builds an AutoRental with composed street address and geo", () => {
    const ld = localBusinessLd({ depot, siteName: "XPERT Moto", url: "https://x.com" });
    expect(ld).toMatchObject({
      "@type": "AutoRental",
      "@id": "https://x.com/locations#lewisham",
      name: "XPERT Moto — Lewisham",
      parentOrganization: { "@id": "https://x.com/#organization" },
      address: {
        "@type": "PostalAddress",
        streetAddress: "798 Parramatta Rd, Unit 2",
        addressLocality: "Lewisham",
        addressRegion: "NSW",
        postalCode: "2049",
        addressCountry: "Australia",
      },
      geo: { "@type": "GeoCoordinates", latitude: -33.89, longitude: 151.14 },
    });
  });

  it("omits geo when coordinates are missing", () => {
    const ld = localBusinessLd({
      depot: { ...depot, latitude: null, longitude: null, addressLine2: null },
      siteName: "X",
      url: "https://x.com",
    });
    expect(ld).not.toHaveProperty("geo");
    expect(ld).toMatchObject({ address: { streetAddress: "798 Parramatta Rd" } });
  });
});

describe("productLd", () => {
  it("formats the GST-inclusive AUD offer and InStock availability", () => {
    const ld = productLd({
      name: "2023 Honda Dio",
      description: "d",
      url: "https://x.com/fleet/honda-dio",
      images: ["https://x.com/a.jpg"],
      brand: "Honda",
      dailyRate: 69,
      inStock: true,
    });
    expect(ld).toMatchObject({
      "@type": "Product",
      brand: { "@type": "Brand", name: "Honda" },
      offers: {
        "@type": "Offer",
        priceCurrency: "AUD",
        price: "69.00",
        valueAddedTaxIncluded: true,
        availability: "https://schema.org/InStock",
      },
    });
  });

  it("marks OutOfStock when not available", () => {
    const ld = productLd({ name: "x", description: "d", url: "u", dailyRate: 10, inStock: false });
    expect(ld).toMatchObject({ offers: { availability: "https://schema.org/OutOfStock" } });
  });
});

describe("breadcrumbLd", () => {
  it("numbers positions from 1", () => {
    const ld = breadcrumbLd([
      { name: "Fleet", url: "https://x.com/fleet" },
      { name: "Dio", url: "https://x.com/fleet/dio" },
    ]);
    expect(ld).toMatchObject({
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Fleet", item: "https://x.com/fleet" },
        { "@type": "ListItem", position: 2, name: "Dio", item: "https://x.com/fleet/dio" },
      ],
    });
  });
});

describe("faqPageLd", () => {
  it("maps Q&A to Question/Answer entities", () => {
    const ld = faqPageLd([{ question: "Q1?", answer: "A1" }]);
    expect(ld).toMatchObject({
      "@type": "FAQPage",
      mainEntity: [
        { "@type": "Question", name: "Q1?", acceptedAnswer: { "@type": "Answer", text: "A1" } },
      ],
    });
  });
});

describe("reviewsLd", () => {
  it("emits AggregateRating with one-decimal value and individual reviews", () => {
    const ld = reviewsLd({
      siteName: "XPERT Moto",
      url: "https://x.com",
      ratingValue: 4.95,
      reviewCount: 2,
      reviews: [
        { author: "A", rating: 5, body: "Great", datePublished: "2025-04-16" },
        { author: "B", rating: 5, body: "Good" },
      ],
    });
    expect(ld).toMatchObject({
      "@type": "Organization",
      aggregateRating: { "@type": "AggregateRating", ratingValue: "5.0", reviewCount: 2 },
    });
    const review = (ld.review as Array<Record<string, unknown>>)[0];
    expect(review).toMatchObject({
      "@type": "Review",
      author: { "@type": "Person", name: "A" },
      reviewRating: { "@type": "Rating", ratingValue: 5 },
      datePublished: "2025-04-16",
    });
    expect((ld.review as Array<Record<string, unknown>>)[1]).not.toHaveProperty("datePublished");
  });
});
