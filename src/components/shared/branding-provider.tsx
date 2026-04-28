"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { Branding } from "@/lib/branding";

const FALLBACK: Branding = {
  siteName: "XPERT Moto",
  tagline: "Ride Australia's best scooters & motorbikes.",
  legalName: "XPERT Moto Pty Ltd",
  abn: "",
  brandColor: "#1B6B4A",
  supportEmail: null,
  supportPhone: null,
  privacyEmail: null,
  postalAddress: null,
  logoWideUrl: null,
  logoBlackUrl: null,
  logoSquareUrl: null,
  faviconUrl: null,
  social: {
    facebook: null,
    instagram: null,
    tiktok: null,
    youtube: null,
  },
};

const BrandingContext = createContext<Branding>(FALLBACK);

export function BrandingProvider({
  value,
  children,
}: {
  value: Branding;
  children: ReactNode;
}) {
  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function useBranding(): Branding {
  return useContext(BrandingContext);
}
