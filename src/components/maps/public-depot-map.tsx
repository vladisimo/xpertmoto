export type PublicDepotPin = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  addressLine1: string;
  suburb: string;
  state: string;
  postcode: string;
  phone: string | null;
  availableVehicles: number;
};

const EMBED_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_EMBED_KEY;

function buildPlaceQuery(d: PublicDepotPin): string {
  return `${d.name}, ${d.addressLine1}, ${d.suburb} ${d.state} ${d.postcode}, Australia`;
}

export function getDirectionsUrl(d: PublicDepotPin): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(buildPlaceQuery(d))}`;
}

export function PublicDepotMap({
  depots,
  zoom = 17,
}: {
  depots: PublicDepotPin[];
  zoom?: number;
}) {
  if (depots.length === 0) return null;

  if (!EMBED_KEY) {
    const href =
      depots.length === 1 && depots[0] ? getDirectionsUrl(depots[0]) : "https://maps.google.com";
    return (
      <div className="flex h-full w-full items-center justify-center bg-muted text-sm text-muted-foreground">
        <a href={href} target="_blank" rel="noreferrer" className="underline">
          Open in Google Maps ↗
        </a>
      </div>
    );
  }

  if (depots.length === 1) {
    const depot = depots[0]!;
    const src = `https://www.google.com/maps/embed/v1/place?key=${EMBED_KEY}&q=${encodeURIComponent(buildPlaceQuery(depot))}&center=${depot.lat},${depot.lng}&zoom=${zoom}`;
    return (
      <iframe
        title={`${depot.name} on Google Maps`}
        src={src}
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
        allowFullScreen
        className="h-full w-full border-0"
      />
    );
  }

  // Embed API can't render multiple pins in one iframe. Centre on the
  // geographic mean at a regional zoom; the surrounding card grid handles
  // per-depot navigation (each card links to /locations#<id>).
  const lat = depots.reduce((s, d) => s + d.lat, 0) / depots.length;
  const lng = depots.reduce((s, d) => s + d.lng, 0) / depots.length;
  const src = `https://www.google.com/maps/embed/v1/view?key=${EMBED_KEY}&center=${lat},${lng}&zoom=6`;
  return (
    <iframe
      title="Depot locations"
      src={src}
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
      allowFullScreen
      className="h-full w-full border-0"
    />
  );
}
