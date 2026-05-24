/**
 * The public model page aggregates one image per vehicle unit across every
 * active unit of a model. Fleets typically upload the same stock product photo
 * to each unit, so the raw set is the same picture repeated N times at distinct
 * per-unit URLs. Collapse it by content checksum (falling back to URL for rows
 * not yet backfilled) so the gallery shows each genuinely-distinct photo once.
 */
export type ModelImageInput = {
  id: string;
  url: string;
  caption: string | null;
  checksum: string | null;
};

export type ModelImage = { id: string; url: string; caption: string | null };

export function dedupeModelImages(
  vehicles: Array<{ images: ModelImageInput[] }>,
): ModelImage[] {
  const seen = new Set<string>();
  const images: ModelImage[] = [];
  for (const v of vehicles) {
    for (const img of v.images) {
      const fingerprint = img.checksum ?? img.url;
      if (seen.has(fingerprint)) continue;
      seen.add(fingerprint);
      images.push({ id: img.id, url: img.url, caption: img.caption });
    }
  }
  return images;
}
