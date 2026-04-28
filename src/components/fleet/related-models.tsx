import Image from "next/image";
import Link from "next/link";
import { formatCurrency } from "@/lib/utils";

export interface RelatedModelEntry {
  slug: string;
  make: string;
  model: string;
  year: number;
  primaryImageUrl: string | null;
  dailyRate: number;
  availableCount: number;
}

export function RelatedModels({
  models,
  heading = "Similar bikes",
}: {
  models: RelatedModelEntry[];
  heading?: string;
}) {
  if (models.length === 0) return null;
  return (
    <section className="space-y-4">
      <h2 className="h2">{heading}</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {models.map((m) => (
          <Link
            key={m.slug}
            href={`/fleet/${m.slug}`}
            className="group flex gap-4 rounded-md border border-border bg-card p-3 transition-shadow hover:shadow-md"
          >
            <div className="relative h-20 w-28 flex-shrink-0 overflow-hidden rounded-md bg-muted">
              {m.primaryImageUrl ? (
                <Image
                  src={m.primaryImageUrl}
                  alt={`${m.make} ${m.model}`}
                  fill
                  sizes="112px"
                  className="object-cover"
                />
              ) : (
                <div className="flex h-full items-center justify-center">
                  <span className="caption">No photo</span>
                </div>
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col justify-center">
              <div className="caption uppercase tracking-[0.08em]">
                {m.year} {m.make}
              </div>
              <div className="truncate font-semibold text-foreground group-hover:text-primary">
                {m.model}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                From{" "}
                <span className="font-medium text-foreground">{formatCurrency(m.dailyRate)}</span>
                /day
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
