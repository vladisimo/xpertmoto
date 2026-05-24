"use client";

import Image from "next/image";
import { DamageMapCanvas, normalizeMarkers, type DamageMarker } from "@/components/agreement/damage-map-canvas";

type Props = {
  preHireMarkers: DamageMarker[];
  postHireMarkers: DamageMarker[];
  photos: { id: string; url: string; caption: string | null }[];
};

export function ReturnConditionPage({ preHireMarkers, postHireMarkers, photos }: Props) {
  const safePre = normalizeMarkers(preHireMarkers);
  const safePost = normalizeMarkers(postHireMarkers);
  return (
    <div className="space-y-6">
      <p>
        The vehicle was inspected at return with the customer present. Grey markers show damage recorded at pickup;
        red/orange markers are new damage identified at return.
      </p>
      {photos.length > 0 ? (
        <div>
          <div className="eyebrow mb-2">Post-hire photos</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {photos.map((p) => (
              <div key={p.id} className="relative aspect-[4/3] overflow-hidden rounded-md border border-border">
                <Image src={p.url} alt={p.caption ?? "Post-hire photo"} fill sizes="(max-width: 640px) 50vw, 33vw" className="object-contain" />
                {p.caption && (
                  <div className="absolute bottom-0 left-0 right-0 bg-black/60 px-2 py-1 text-[10px] uppercase tracking-wide text-white">
                    {p.caption}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div>
        <div className="eyebrow mb-2">Damage map — diff</div>
        <DamageMapCanvas
          baseMarkers={safePre}
          markers={safePost}
          onChange={() => undefined}
          source="staff"
          readOnly
          layout="grid"
        />
        <p className="caption mt-2">
          {safePost.length === 0
            ? "No new damage identified."
            : `${safePost.length} new damage marker(s).`}
        </p>
      </div>
    </div>
  );
}
