import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  cleanAddressString,
  parseAuAddressString,
  parseInternationalAddressTail,
  resolveAddressComponents,
} from "@/lib/geo";

type FetchMock = ReturnType<typeof vi.fn>;

function mockFetchOnce(body: unknown, ok = true) {
  const fetchMock: FetchMock = vi.fn().mockResolvedValue({
    ok,
    json: async () => body,
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function mockFetchSequence(bodies: Array<{ body: unknown; ok?: boolean }>) {
  const fetchMock: FetchMock = vi.fn();
  for (const { body, ok = true } of bodies) {
    fetchMock.mockResolvedValueOnce({ ok, json: async () => body });
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("cleanAddressString", () => {
  it("dedupes leading N,N,", () => {
    expect(cleanAddressString("417,417,Pitt Street,Haymarket,NSW,2000,Australia"))
      .toBe("417,Pitt Street,Haymarket,NSW,2000,Australia");
  });

  it("inserts a space between AU state abbrev and 4-digit postcode", () => {
    expect(cleanAddressString("56/313 HARRIS STREET, PYRMONT, NSW2009"))
      .toBe("56/313 HARRIS STREET, PYRMONT, NSW 2009");
    expect(cleanAddressString("1 Smith St, Brisbane, QLD4000"))
      .toBe("1 Smith St, Brisbane, QLD 4000");
  });

  it("collapses runs of internal whitespace", () => {
    expect(cleanAddressString("1   Main   St")).toBe("1 Main St");
  });

  it("leaves an already-clean address alone", () => {
    expect(cleanAddressString("124 Darley Street, Newtown, NSW 2042"))
      .toBe("124 Darley Street, Newtown, NSW 2042");
  });
});

describe("parseAuAddressString", () => {
  it("parses street, suburb, state postcode (no country)", () => {
    expect(parseAuAddressString("56/313 HARRIS STREET, PYRMONT, NSW2009")).toEqual({
      addressLine1: "56/313 Harris Street",
      suburb: "Pyrmont",
      state: "NSW",
      postcode: "2009",
      country: "Australia",
    });
  });

  it("parses street, suburb, state, postcode, country (separate parts)", () => {
    expect(
      parseAuAddressString("124 Darley Street, Newtown, NSW, 2042, Australia"),
    ).toEqual({
      addressLine1: "124 Darley Street",
      suburb: "Newtown",
      state: "NSW",
      postcode: "2042",
      country: "Australia",
    });
  });

  it("collapses leading-number duplicate (legacy import bug)", () => {
    expect(
      parseAuAddressString("417,417,Pitt Street,Haymarket,NSW,2000,Australia"),
    ).toEqual({
      addressLine1: "417 Pitt Street",
      suburb: "Haymarket",
      state: "NSW",
      postcode: "2000",
      country: "Australia",
    });
  });

  it("keeps unit notation intact (e.g. 56/313)", () => {
    const out = parseAuAddressString(
      "56/313 Harris Street, Pyrmont, NSW, 2009, Australia",
    );
    expect(out?.addressLine1).toBe("56/313 Harris Street");
  });

  it("accepts the full state name and normalises it", () => {
    const out = parseAuAddressString(
      "1 Collins Street, Melbourne, Victoria, 3000",
    );
    expect(out?.state).toBe("VIC");
  });

  it("rejects strings that don't carry a state + postcode", () => {
    expect(parseAuAddressString("Suite 15, level 4")).toBeNull();
  });

  it("rejects non-AU addresses (Canadian postcode at tail)", () => {
    expect(
      parseAuAddressString(
        "2802 Kings Heights Gate Southeast #139 Airdrie, AB T4A 0T3",
      ),
    ).toBeNull();
  });

  it("rejects single-comma strings", () => {
    expect(parseAuAddressString("Sydney, NSW 2000")).toBeNull();
  });
});

describe("resolveAddressComponents", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("resolves via the parser without calling Nominatim when possible", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const out = await resolveAddressComponents(
      "124 Darley Street, Newtown, NSW, 2042, Australia",
    );
    expect(out).toMatchObject({
      addressLine1: "124 Darley Street",
      suburb: "Newtown",
      state: "NSW",
      postcode: "2042",
      country: "Australia",
      source: "parsed",
      lat: null,
      lng: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("falls back to Nominatim when the structure can't be parsed", async () => {
    mockFetchOnce([
      {
        lat: "-33.0",
        lon: "151.0",
        display_name: "1 Made Up St, Sydney, NSW, 2000, Australia",
        address: {
          house_number: "1",
          road: "Made Up Street",
          suburb: "Sydney",
          state: "New South Wales",
          postcode: "2000",
          country: "Australia",
        },
      },
    ]);
    const out = await resolveAddressComponents("vague single line");
    expect(out?.source).toBe("geocoded");
    expect(out?.state).toBe("NSW");
    expect(out?.lat).toBe(-33);
  });

  it("returns null when parser fails and both AU + intl Nominatim queries return nothing", async () => {
    mockFetchSequence([{ body: [] }, { body: [] }]);
    expect(await resolveAddressComponents("Suite 15,level 4")).toBeNull();
  });

  it("resolves a Canadian address via tail-parse + postcode lookup", async () => {
    // Only one fetch call should happen — the postcode lookup. AU/intl
    // free-text queries should not fire.
    const fetchMock = mockFetchSequence([
      {
        body: [
          {
            lat: "51.2677",
            lon: "-113.9806",
            display_name: "T4A 0T3, Airdrie, Alberta, Canada",
            address: {
              postcode: "T4A 0T3",
              city: "Airdrie",
              state: "Alberta",
              country: "Canada",
            },
          },
        ],
      },
    ]);

    const out = await resolveAddressComponents(
      "2802 Kings Heights Gate Southeast #139 Airdrie, AB T4A 0T3",
    );
    expect(out).toMatchObject({
      addressLine1: "2802 Kings Heights Gate Southeast #139",
      suburb: "Airdrie",
      state: "Alberta",
      postcode: "T4A 0T3",
      country: "Canada",
      source: "geocoded",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("resolves a US address via tail-parse + postcode lookup", async () => {
    mockFetchSequence([
      {
        body: [
          {
            lat: "40.0",
            lon: "-74.0",
            display_name: "08608, Trenton, NJ, USA",
            address: {
              postcode: "08608",
              city: "Trenton",
              state: "New Jersey",
              country: "United States",
            },
          },
        ],
      },
    ]);
    const out = await resolveAddressComponents("10 Main Street, Trenton NJ 08608");
    expect(out).toMatchObject({
      addressLine1: "10 Main Street",
      suburb: "Trenton",
      state: "New Jersey",
      postcode: "08608",
      country: "United States",
      source: "geocoded",
    });
  });

  it("falls through to free-text Nominatim when postcode lookup fails", async () => {
    // Postcode lookup [] → AU free-text [] → intl free-text {result}.
    mockFetchSequence([
      { body: [] },
      { body: [] },
      {
        body: [
          {
            lat: "51.0",
            lon: "-1.0",
            address: {
              house_number: "1",
              road: "High Street",
              city: "Winchester",
              state: "England",
              postcode: "SO23 9AB",
              country: "United Kingdom",
            },
          },
        ],
      },
    ]);
    const out = await resolveAddressComponents("1 High Street, Winchester SO23 9AB");
    expect(out?.country).toBe("United Kingdom");
    expect(out?.source).toBe("geocoded");
  });

  it("returns null when fetch throws on the geocoding fallback", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("network down")),
    );
    expect(await resolveAddressComponents("ungeocodable garbage")).toBeNull();
  });

  it("strips commas before querying Nominatim", async () => {
    const fetchMock = mockFetchOnce([
      {
        lat: "0",
        lon: "0",
        address: {
          house_number: "1",
          road: "X",
          suburb: "Y",
          state: "New South Wales",
          postcode: "2000",
          country: "Australia",
        },
      },
    ]);
    await resolveAddressComponents("foo, bar, baz");
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(url).toContain("foo+bar+baz");
    expect(url).not.toContain("%2C");
  });

  it("falls back to county/region for state on non-AU geocoded results", async () => {
    // Tullamore: Nominatim returns county but no state field.
    mockFetchOnce([
      {
        lat: "53.26",
        lon: "-7.47",
        display_name: "Chancery Lane, Tullamore, County Offaly, R35 FH59, Éire / Ireland",
        address: {
          road: "Chancery Lane",
          town: "Tullamore",
          county: "County Offaly",
          postcode: "R35 FH59",
          country: "Éire / Ireland",
        },
      },
    ]);
    const out = await resolveAddressComponents(
      "12 Chancery Lane Tullamore, OY R35 C998",
    );
    expect(out).toMatchObject({
      addressLine1: "Chancery Lane",
      suburb: "Tullamore",
      state: "Offaly",
      country: "Ireland",
      source: "geocoded",
    });
  });

  it("retries by dropping a leading numeric token (unit prefix case)", async () => {
    // Try 1: empty. Try 2 with "84 " stripped: success.
    mockFetchSequence([
      { body: [] },
      {
        body: [
          {
            lat: "-33.88",
            lon: "151.20",
            address: {
              house_number: "344",
              road: "Bulwara Road",
              suburb: "Ultimo",
              state: "New South Wales",
              postcode: "2007",
              country: "Australia",
            },
          },
        ],
      },
    ]);
    const out = await resolveAddressComponents(
      "84 344 bulwara road Sydney, Nsw 2007",
    );
    expect(out?.addressLine1).toBe("84/344 Bulwara Road");
    expect(out?.state).toBe("NSW");
  });

  it("retries by dropping a leading house number when not in OSM", async () => {
    // Nominatim returns the road but no house_number. Treat the input prefix
    // as the house number rather than a unit (no slash).
    mockFetchSequence([
      { body: [] },
      {
        body: [
          {
            lat: "49.19",
            lon: "-122.54",
            address: {
              road: "105A Avenue",
              suburb: "Albion",
              city: "Maple Ridge",
              state: "British Columbia",
              postcode: "V2W 2G4",
              country: "Canada",
            },
          },
        ],
      },
    ]);
    const out = await resolveAddressComponents(
      "24635 105A Avenue Maple Ridge BC V2W",
    );
    expect(out?.addressLine1).toBe("24635 105A Avenue");
    expect(out?.suburb).toBe("Albion");
    expect(out?.country).toBe("Canada");
  });

  it("falls back to a locality-only query and rebuilds street from input", async () => {
    // Try 1, try 2 (drop "57 "), then locality fallback (last 3 tokens
    // "Rose bay Nsw") returns a suburb-level boundary with full postcode.
    mockFetchSequence([
      { body: [] },
      { body: [] },
      {
        body: [
          {
            lat: "-33.87",
            lon: "151.27",
            address: {
              suburb: "Rose Bay",
              city: "Sydney",
              state: "New South Wales",
              postcode: "2029",
              country: "Australia",
            },
          },
        ],
      },
    ]);
    const out = await resolveAddressComponents(
      "57 O sullyvan road Rose bay, Nsw",
    );
    expect(out).toMatchObject({
      addressLine1: "57 O sullyvan road",
      suburb: "Rose Bay",
      state: "NSW",
      postcode: "2029",
      country: "Australia",
      source: "geocoded",
    });
  });

  it("rejects a locality result that doesn't overlap with the input", async () => {
    // For "Suite 15,level 4", a locality query like "level 4" used to match
    // unrelated suburbs (e.g. Cape Town Ward 71). Reject any locality whose
    // suburb name doesn't appear anywhere in the input.
    mockFetchSequence([
      { body: [] }, // try 1
      { body: [] }, // try 2 (only fires if leading-numeric prefix matches; here "Suite" is not numeric so it wouldn't fire — keep mocks defensive)
      {
        body: [
          {
            lat: "-33.9",
            lon: "18.4",
            address: {
              suburb: "Cape Town Ward 71",
              state: "Western Cape",
              postcode: "7848",
              country: "South Africa",
            },
          },
        ],
      },
      { body: [] },
      { body: [] },
    ]);
    expect(await resolveAddressComponents("Suite 15,level 4")).toBeNull();
  });

  it("normalises foreign country names (Nederland → Netherlands)", async () => {
    mockFetchOnce([
      {
        lat: "52.32",
        lon: "4.95",
        address: {
          house_number: "35",
          road: "Dennenrodepad",
          city: "Amsterdam",
          state: "Noord-Holland",
          postcode: "1102 MW",
          country: "Nederland",
        },
      },
    ]);
    const out = await resolveAddressComponents(
      "35 Dennenrodepad Amsterdam, NH 1102 MW",
    );
    expect(out?.country).toBe("Netherlands");
    expect(out?.suburb).toBe("Amsterdam");
  });

  it("maps every Australian state via the geocoded path", async () => {
    const cases: Array<[string, string]> = [
      ["New South Wales", "NSW"],
      ["Victoria", "VIC"],
      ["Queensland", "QLD"],
      ["South Australia", "SA"],
      ["Western Australia", "WA"],
      ["Tasmania", "TAS"],
      ["Northern Territory", "NT"],
      ["Australian Capital Territory", "ACT"],
    ];
    for (const [full, abbrev] of cases) {
      mockFetchOnce([
        {
          lat: "0",
          lon: "0",
          address: {
            house_number: "1",
            road: "Main St",
            suburb: "Town",
            state: full,
            postcode: "0000",
            country: "Australia",
          },
        },
      ]);
      const out = await resolveAddressComponents(`raw input ${full}`);
      expect(out?.state, `${full} → ${abbrev}`).toBe(abbrev);
    }
  });
});

describe("parseInternationalAddressTail", () => {
  it("extracts a Canadian tail with optional comma", () => {
    expect(
      parseInternationalAddressTail(
        "2802 Kings Heights Gate Southeast #139 Airdrie, AB T4A 0T3",
      ),
    ).toEqual({
      head: "2802 Kings Heights Gate Southeast #139 Airdrie",
      state: "AB",
      postcode: "T4A 0T3",
      country: "Canada",
    });
  });

  it("extracts a US tail with ZIP+4", () => {
    expect(
      parseInternationalAddressTail("123 Main St, Trenton, NJ 08608-1234"),
    ).toEqual({
      head: "123 Main St, Trenton",
      state: "NJ",
      postcode: "08608-1234",
      country: "United States",
    });
  });

  it("extracts a UK tail (no state)", () => {
    expect(
      parseInternationalAddressTail("221B Baker Street, London NW1 6XE"),
    ).toEqual({
      head: "221B Baker Street, London",
      state: "",
      postcode: "NW1 6XE",
      country: "United Kingdom",
    });
  });

  it("returns null for an Australian address (no foreign postcode pattern)", () => {
    expect(
      parseInternationalAddressTail("124 Darley Street, Newtown, NSW 2042"),
    ).toBeNull();
  });
});
