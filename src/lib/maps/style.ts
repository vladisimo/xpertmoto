/** Shared basemap style URL for every MapLibre map in the back office
 *  (fleet live, vehicle tracks, trip breadcrumbs, depot map).
 *
 *  Override with NEXT_PUBLIC_MAP_STYLE_URL to point at a keyed, SLA-backed
 *  vector-tile provider (MapTiler / Stadia / Protomaps). The built-in default
 *  is OpenFreeMap's free community server — no key required, but no SLA either:
 *  under load it drops the style/tile fetches at the network layer, which
 *  surfaces in the console as `AJAXError: Failed to fetch ... (0)`. For
 *  production, set the env var to a keyed provider; see .env.example.
 */
export const MAP_STYLE_URL =
  process.env.NEXT_PUBLIC_MAP_STYLE_URL ??
  "https://tiles.openfreemap.org/styles/liberty";
