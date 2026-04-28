export type LatLng = { lat: number; lng: number };

/**
 * Haversine great-circle distance between two coordinates, in kilometres.
 */
export function haversineKm(a: LatLng, b: LatLng): number {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export type DeliveryZone = { maxKm: number; flatFee: number };

export const DEFAULT_DELIVERY_ZONES: readonly DeliveryZone[] = [
  { maxKm: 10, flatFee: 25 },
  { maxKm: 25, flatFee: 45 },
  { maxKm: 50, flatFee: 85 },
];

/**
 * Compute a delivery fee given the straight-line distance from a depot to
 * the customer address. Returns null when the distance exceeds the
 * furthest configured zone (i.e. delivery not offered).
 */
export function deliveryFee(
  depot: LatLng,
  destination: LatLng,
  zones: readonly DeliveryZone[] = DEFAULT_DELIVERY_ZONES,
): { distanceKm: number; fee: number } | null {
  const distanceKm = haversineKm(depot, destination);
  const zone = zones.find((z) => distanceKm <= z.maxKm);
  if (!zone) return null;
  return { distanceKm: Math.round(distanceKm * 10) / 10, fee: zone.flatFee };
}

/**
 * Geocode a free-text Australian address via OpenStreetMap Nominatim (free,
 * no API key). Returns null on failure (no results, network error) — callers
 * must handle the null path.
 */
export async function geocodeAddress(address: string): Promise<LatLng | null> {
  const q = encodeURIComponent(address);
  const url = `https://nominatim.openstreetmap.org/search?q=${q}&countrycodes=au&format=json&limit=1`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Scootering/1.0" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { lat?: string; lon?: string }[];
    const result = data[0];
    if (!result?.lat || !result?.lon) return null;
    return { lat: parseFloat(result.lat), lng: parseFloat(result.lon) };
  } catch {
    return null;
  }
}

export type ResolvedAddress = {
  addressLine1: string;
  suburb: string;
  state: string;
  postcode: string;
  country: string;
  lat: number | null;
  lng: number | null;
  raw: string;
  source: "parsed" | "geocoded";
};

const AU_STATE_FULL_TO_ABBREV: Record<string, string> = {
  "new south wales": "NSW",
  "victoria": "VIC",
  "queensland": "QLD",
  "south australia": "SA",
  "western australia": "WA",
  "tasmania": "TAS",
  "northern territory": "NT",
  "australian capital territory": "ACT",
};

const AU_STATE_ABBREVS = new Set(
  Object.values(AU_STATE_FULL_TO_ABBREV),
);

function normalizeAuState(s: string): string | null {
  const t = s.trim();
  const upper = t.toUpperCase();
  if (AU_STATE_ABBREVS.has(upper)) return upper;
  return AU_STATE_FULL_TO_ABBREV[t.toLowerCase()] ?? null;
}

const COUNTRY_KEYWORDS = new Set([
  "australia",
  "au",
  "aus",
  "united states",
  "usa",
  "canada",
  "new zealand",
  "nz",
  "uk",
  "united kingdom",
]);

function titleCaseStreet(s: string): string {
  // Lower-case then capitalise the first letter of each word. Preserves
  // characters like "/" and "#" within tokens (e.g. "56/313" stays as-is).
  return s
    .toLowerCase()
    .replace(/(^|[\s/-])([a-z])/g, (_m, sep: string, ch: string) => sep + ch.toUpperCase());
}

/**
 * Pre-clean a raw address string before parsing or geocoding:
 *  - Trim and collapse internal whitespace
 *  - Dedupe a leading "N,N," pattern (legacy import bug where unit and
 *    street number were both written and happen to match)
 *  - Insert a space between an AU state abbrev and a 4-digit postcode
 *    glued together (e.g. "NSW2009" → "NSW 2009")
 */
export function cleanAddressString(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^(\d+),\s*\1,/, "$1,");
  s = s.replace(
    /\b(NSW|VIC|QLD|SA|WA|TAS|NT|ACT)(\d{4})\b/gi,
    (_, st: string, pc: string) => `${st.toUpperCase()} ${pc}`,
  );
  s = s.replace(/[ \t]+/g, " ");
  return s;
}

export type ParsedAuAddress = {
  addressLine1: string;
  suburb: string;
  state: string;
  postcode: string;
  country: string;
};

/**
 * Best-effort parse of a comma-separated Australian address string into
 * canonical components. Designed for legacy imports where the whole address
 * was concatenated with commas. Returns null if the string can't be parsed
 * with high confidence — callers should fall back to geocoding.
 *
 * Recognised shapes (after cleaning):
 *   "<street>, <suburb>, <STATE> <postcode>[, <country>]"
 *   "<street>, <suburb>, <STATE>, <postcode>[, <country>]"
 *   "<unit>, <street>, <suburb>, <STATE>, <postcode>[, <country>]"
 */
export function parseAuAddressString(raw: string): ParsedAuAddress | null {
  const cleaned = cleanAddressString(raw);
  const parts = cleaned
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length < 3) return null;

  let country = "Australia";
  if (COUNTRY_KEYWORDS.has(parts[parts.length - 1]!.toLowerCase())) {
    const popped = parts.pop()!;
    country = /^au[s]?$/i.test(popped) ? "Australia" : popped;
  }
  if (parts.length < 3) return null;

  let state: string | null = null;
  let postcode: string | null = null;

  // Tail = single part containing both state and postcode
  const tail = parts[parts.length - 1]!;
  const stateAndPc = tail.match(/^([A-Za-z][A-Za-z\s]*?)\s+(\d{4})$/);
  if (stateAndPc) {
    const cs = normalizeAuState(stateAndPc[1]!);
    if (cs) {
      state = cs;
      postcode = stateAndPc[2]!;
      parts.pop();
    }
  }

  // Tail = postcode, penultimate = state
  if (!state && parts.length >= 2 && /^\d{4}$/.test(parts[parts.length - 1]!)) {
    const cs = normalizeAuState(parts[parts.length - 2]!);
    if (cs) {
      postcode = parts[parts.length - 1]!;
      state = cs;
      parts.pop();
      parts.pop();
    }
  }

  if (!state || !postcode) return null;

  // Remaining parts must include at least street + suburb
  if (parts.length < 2) return null;

  const suburb = parts.pop()!;
  const streetParts = parts;

  // If the first remaining part is purely numeric (or unit-style like
  // "56/313" / "12A"), join it to the next part with a space rather than
  // a comma — that's how an import would have written "417,Pitt Street".
  let addressLine1: string;
  if (streetParts.length === 1) {
    addressLine1 = streetParts[0]!;
  } else if (/^[\d/]+[A-Za-z]?$/.test(streetParts[0]!)) {
    addressLine1 = `${streetParts[0]} ${streetParts.slice(1).join(", ")}`;
  } else {
    addressLine1 = streetParts.join(", ");
  }

  return {
    addressLine1: titleCaseStreet(addressLine1),
    suburb: titleCaseStreet(suburb),
    state,
    postcode,
    country,
  };
}

export type ParsedInternationalTail = {
  head: string; // everything before the state+postcode tail
  state: string;
  postcode: string;
  country: string;
};

const CANADIAN_POSTCODE = /([A-Za-z]\d[A-Za-z])\s*(\d[A-Za-z]\d)/;
const US_POSTCODE = /\d{5}(?:-\d{4})?/;
const UK_POSTCODE = /[A-Z]{1,2}\d{1,2}[A-Z]?\s?\d[A-Z]{2}/i;

/**
 * Detect a non-AU postcode pattern at the tail of a free-text address and
 * extract { head, state, postcode, country }. Returns null when no known
 * international pattern matches. The head string still contains the street
 * (and possibly the city) — caller is expected to enrich via postcode lookup.
 */
export function parseInternationalAddressTail(
  raw: string,
): ParsedInternationalTail | null {
  const trimmed = raw.trim();

  // Canadian: optional 2-letter province + Canadian postcode at the end.
  // Examples: "... Airdrie, AB T4A 0T3" or "... Airdrie AB T4A0T3"
  const ca = trimmed.match(
    new RegExp(
      `^(.+?)[,\\s]+([A-Z]{2})[\\s,]+(${CANADIAN_POSTCODE.source})\\s*$`,
      "i",
    ),
  );
  if (ca) {
    const [, head, prov, , a, b] = ca;
    return {
      head: head!.trim().replace(/,$/, "").trim(),
      state: prov!.toUpperCase(),
      postcode: `${a!.toUpperCase()} ${b!.toUpperCase()}`,
      country: "Canada",
    };
  }

  // US: 2-letter state + ZIP (5 or ZIP+4) at the end.
  const us = trimmed.match(
    new RegExp(
      `^(.+?)[,\\s]+([A-Z]{2})[\\s,]+(${US_POSTCODE.source})\\s*$`,
    ),
  );
  if (us) {
    const [, head, st, zip] = us;
    return {
      head: head!.trim().replace(/,$/, "").trim(),
      state: st!.toUpperCase(),
      postcode: zip!,
      country: "United States",
    };
  }

  // UK: postcode at the end (no state).
  const uk = trimmed.match(
    new RegExp(`^(.+?)[,\\s]+(${UK_POSTCODE.source})\\s*$`, "i"),
  );
  if (uk) {
    const [, head, pc] = uk;
    return {
      head: head!.trim().replace(/,$/, "").trim(),
      state: "",
      postcode: pc!.toUpperCase(),
      country: "United Kingdom",
    };
  }

  return null;
}

type NominatimAddress = {
  house_number?: string;
  road?: string;
  suburb?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  county?: string;
  region?: string;
  state?: string;
  postcode?: string;
  country?: string;
};

type NominatimResult = {
  lat?: string;
  lon?: string;
  display_name?: string;
  address?: NominatimAddress;
};

const COUNTRY_NAME_NORMALISE: Record<string, string> = {
  "éire / ireland": "Ireland",
  "éire": "Ireland",
  "nederland": "Netherlands",
  "new zealand / aotearoa": "New Zealand",
};

function normalizeCountry(c: string): string {
  return COUNTRY_NAME_NORMALISE[c.toLowerCase()] ?? c;
}

function trimAdministrativeSuffix(s: string): string {
  return s
    .replace(/^County\s+/i, "")
    .replace(/\s+(Borough|County|Region|District|Municipality|Council)$/i, "")
    .trim();
}

async function nominatimSearch(raw: string): Promise<NominatimResult | null> {
  // Nominatim is comma-sensitive — replace commas with spaces.
  const cleaned = raw.replace(/,/g, " ").replace(/\s+/g, " ").trim();
  const params = new URLSearchParams({
    q: cleaned,
    format: "json",
    addressdetails: "1",
    limit: "1",
  });
  const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Scootering/1.0" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as NominatimResult[];
    return data[0] ?? null;
  } catch {
    return null;
  }
}

async function nominatimPostcodeLookup(
  postcode: string,
  country: string,
): Promise<NominatimResult | null> {
  const params = new URLSearchParams({
    postalcode: postcode,
    country,
    format: "json",
    addressdetails: "1",
    limit: "1",
  });
  const url = `https://nominatim.openstreetmap.org/search?${params.toString()}`;
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Scootering/1.0" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as NominatimResult[];
    return data[0] ?? null;
  } catch {
    return null;
  }
}

type LocalityFromResult = {
  suburb: string;
  state: string;
  postcode: string;
  country: string;
  lat: number;
  lng: number;
  raw: string;
};

function extractLocality(result: NominatimResult): LocalityFromResult | null {
  if (!result.lat || !result.lon || !result.address) return null;
  const a = result.address;

  const rawSuburb =
    a.suburb ?? a.city ?? a.town ?? a.village ?? a.municipality ?? a.county;
  const suburb = rawSuburb ? trimAdministrativeSuffix(rawSuburb) : undefined;
  const postcode = a.postcode;
  if (!suburb || !postcode) return null;

  const country = normalizeCountry(a.country ?? "Australia");
  let state: string | undefined;
  if (country.toLowerCase() === "australia") {
    state = a.state ? AU_STATE_FULL_TO_ABBREV[a.state.toLowerCase()] : undefined;
  } else {
    const rawState = a.state ?? a.county ?? a.region;
    state = rawState ? trimAdministrativeSuffix(rawState) : undefined;
  }
  if (!state) return null;

  return {
    suburb,
    state,
    postcode,
    country,
    lat: parseFloat(result.lat),
    lng: parseFloat(result.lon),
    raw: result.display_name ?? "",
  };
}

function nominatimToResolved(
  result: NominatimResult,
  cleaned: string,
): ResolvedAddress | null {
  const locality = extractLocality(result);
  if (!locality) return null;
  const a = result.address!;
  const street = [a.house_number, a.road].filter(Boolean).join(" ").trim();
  if (!street) return null;

  return {
    addressLine1: street,
    suburb: locality.suburb,
    state: locality.state,
    postcode: locality.postcode,
    country: locality.country,
    lat: locality.lat,
    lng: locality.lng,
    raw: result.display_name ?? cleaned,
    source: "geocoded",
  };
}

async function resolveInternationalByTail(
  cleaned: string,
): Promise<ResolvedAddress | null> {
  const tail = parseInternationalAddressTail(cleaned);
  if (!tail) return null;

  // Use Nominatim's postcode lookup to validate and pull the city. Street-
  // level data often isn't in OSM for international suburbs, but postcodes
  // almost always are.
  const lookup = await nominatimPostcodeLookup(tail.postcode, tail.country);
  const a = lookup?.address;
  const city = a?.city ?? a?.town ?? a?.suburb ?? a?.village ?? a?.municipality;
  if (!lookup?.lat || !lookup?.lon || !a || !city) return null;

  // Strip the city from the tail's head (e.g. "... #139 Airdrie" → "... #139").
  const cityRe = new RegExp(`[\\s,]+${escapeRegex(city)}\\s*$`, "i");
  const addressLine1 = tail.head.replace(cityRe, "").replace(/,$/, "").trim();

  // Prefer the resolver's full-name state when present; otherwise keep the
  // 2-letter code we extracted from the input. UK has no state at all.
  const state = a.state ?? tail.state;

  return {
    addressLine1,
    suburb: city,
    state,
    postcode: tail.postcode,
    country: a.country ?? tail.country,
    lat: parseFloat(lookup.lat),
    lng: parseFloat(lookup.lon),
    raw: lookup.display_name ?? cleaned,
    source: "geocoded",
  };
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function geocodeWithRetries(
  cleaned: string,
): Promise<ResolvedAddress | null> {
  // Try 1 — full cleaned input.
  let result = await nominatimSearch(cleaned);
  let resolved = result ? nominatimToResolved(result, cleaned) : null;
  if (resolved) return resolved;

  // Try 2 — drop one leading numeric token. Handles a unit prefix
  // ("84 344 bulwara road …") or an unindexed house number ("24635 105A
  // Avenue …" where 24635 isn't in OSM but the road is).
  const prefixMatch = cleaned.match(/^(\d+)\s+(.+)$/);
  if (prefixMatch) {
    const remainder = prefixMatch[2]!;
    result = await nominatimSearch(remainder);
    resolved = result ? nominatimToResolved(result, cleaned) : null;
    if (resolved) {
      const prefix = prefixMatch[1]!;
      // If Nominatim returned a house_number of its own, the input's prefix
      // is likely a unit — render as "84/344 Bulwara Road". Otherwise the
      // input prefix is the house number Nominatim couldn't find — render
      // as "24635 105A Avenue".
      const nominatimHadHouseNumber = Boolean(result?.address?.house_number);
      const newAddressLine1 = nominatimHadHouseNumber
        ? `${prefix}/${resolved.addressLine1}`
        : `${prefix} ${resolved.addressLine1}`;
      return { ...resolved, addressLine1: newAddressLine1 };
    }
  }

  // Try 3 — locality fallback. Search just the last N tokens; if Nominatim
  // returns suburb + state + postcode, reconstruct addressLine1 from the
  // input by stripping the matched suburb forward.
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  const lower = cleaned.toLowerCase();
  for (const n of [3, 4, 2]) {
    if (tokens.length <= n) continue;
    const localityQuery = tokens.slice(-n).join(" ");
    const localityResult = await nominatimSearch(localityQuery);
    const locality = localityResult ? extractLocality(localityResult) : null;
    if (!locality) continue;

    // Sanity check: the resolved suburb must overlap with the input.
    // Without this, a query like "level 4" can resolve to a "Cape Town
    // Ward 71" suburb that has nothing to do with the customer.
    const suburbWords = locality.suburb
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length >= 4);
    if (suburbWords.length === 0 || !suburbWords.some((w) => lower.includes(w))) {
      continue;
    }

    const suburbIdx = lower.lastIndexOf(locality.suburb.toLowerCase());
    let street: string;
    if (suburbIdx > 0) {
      street = cleaned.slice(0, suburbIdx).trim().replace(/,$/, "").trim();
    } else {
      street = tokens.slice(0, -n).join(" ").trim();
    }
    if (!street) continue;

    return {
      addressLine1: street,
      suburb: locality.suburb,
      state: locality.state,
      postcode: locality.postcode,
      country: locality.country,
      lat: locality.lat,
      lng: locality.lng,
      raw: locality.raw || cleaned,
      source: "geocoded",
    };
  }

  return null;
}

/**
 * Resolve a free-text address (AU or international) to canonical components.
 *
 * Strategy (first hit wins):
 *   1. Parse the comma-separated AU structure ourselves — fast, no network,
 *      preserves the input's house-number / unit notation.
 *   2. Detect a non-AU postcode tail (Canadian/US/UK), then enrich the city
 *      via Nominatim postcode lookup. Handles cases where street-level data
 *      isn't in OSM but the postcode is.
 *   3. Free-text Nominatim with up to three passes:
 *        a) full cleaned input,
 *        b) input with leading numeric token(s) dropped,
 *        c) locality-only (last N tokens) — supplies street from input.
 *      Commas are converted to spaces in queries (Nominatim is comma-sensitive).
 *
 * Returns null if no path yields all of street/suburb/state/postcode.
 */
export async function resolveAddressComponents(
  raw: string,
): Promise<ResolvedAddress | null> {
  const cleaned = cleanAddressString(raw);

  const parsed = parseAuAddressString(cleaned);
  if (parsed) {
    return {
      ...parsed,
      lat: null,
      lng: null,
      raw: cleaned,
      source: "parsed",
    };
  }

  const intlByTail = await resolveInternationalByTail(cleaned);
  if (intlByTail) return intlByTail;

  return geocodeWithRetries(cleaned);
}

/**
 * Check whether a point is inside an arbitrary polygon defined by an array
 * of lat/lng vertices. Ray-casting algorithm. Used for geo-fenced delivery
 * zones that aren't perfect circles.
 */
export function pointInPolygon(point: LatLng, polygon: LatLng[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    const intersect =
      a.lat > point.lat !== b.lat > point.lat &&
      point.lng < ((b.lng - a.lng) * (point.lat - a.lat)) / (b.lat - a.lat) + a.lng;
    if (intersect) inside = !inside;
  }
  return inside;
}
