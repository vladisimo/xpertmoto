"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { SegmentFilterBuilder } from "@/components/communications/segment-filter-builder";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc/client";
import { segmentFiltersSchema, type SegmentFilters } from "@/lib/validators/segment";

type Props = {
  segmentId?: string;
  initialName?: string;
  initialDescription?: string;
  initialFilters?: SegmentFilters;
};

const DEFAULT_FILTERS: SegmentFilters = {
  combinator: "AND",
  filters: [{ dimension: "STATE", states: ["VIC"] }],
};

export function SegmentEditor({
  segmentId,
  initialName = "",
  initialDescription = "",
  initialFilters = DEFAULT_FILTERS,
}: Props) {
  const router = useRouter();
  const [name, setName] = useState(initialName);
  const [description, setDescription] = useState(initialDescription);
  const [filters, setFilters] = useState<SegmentFilters>(initialFilters);

  const { data: depots } = trpc.depot.list.useQuery();
  const { data: categories } = trpc.catalog.listCategories.useQuery();

  const parsedFilters = useMemo(() => {
    const res = segmentFiltersSchema.safeParse(filters);
    return res.success ? res.data : null;
  }, [filters]);

  const preview = trpc.communication.segmentEvaluate.useQuery(
    parsedFilters ? { filters: parsedFilters, take: 10 } : { filters: DEFAULT_FILTERS, take: 0 },
    { enabled: !!parsedFilters },
  );

  const create = trpc.communication.segmentCreate.useMutation({
    onSuccess: (s) => router.push(`/staff/communications/segments/${s.id}`),
  });
  const update = trpc.communication.segmentUpdate.useMutation({
    onSuccess: () => router.push("/staff/communications/segments"),
  });

  const canSave = !!name && !!parsedFilters;

  function submit() {
    if (!canSave) return;
    if (segmentId) {
      update.mutate({ id: segmentId, name, description, filters: parsedFilters });
    } else {
      create.mutate({ name, description, filters: parsedFilters });
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="segment-name">Name</Label>
          <Input
            id="segment-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Gold Coast 300cc winback"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="segment-desc">Description</Label>
          <Input
            id="segment-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Optional context for other staff"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Filters (all must match)</Label>
        <SegmentFilterBuilder
          value={filters}
          onChange={setFilters}
          depotOptions={(depots ?? []).map((d) => ({ id: d.id, name: d.name }))}
          categoryOptions={(categories ?? []).map((c) => ({ id: c.id, name: c.name }))}
        />
      </div>

      <div className="rounded-lg border border-border bg-muted/30 p-4">
        <div className="flex items-center justify-between">
          <h3 className="font-medium">Preview</h3>
          <span className="text-sm text-muted-foreground">
            {preview.isLoading ? "Calculating…" : `${preview.data?.count ?? 0} customers match`}
          </span>
        </div>
        {preview.data?.rows && preview.data.rows.length > 0 && (
          <ul className="mt-3 space-y-1 text-sm">
            {preview.data.rows.slice(0, 10).map((r) => (
              <li key={r.id} className="flex items-center justify-between text-muted-foreground">
                <span>{r.firstName} {r.lastName}</span>
                <span className="text-xs">{r.email ?? "—"}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex gap-2">
        <Button disabled={!canSave || create.isPending || update.isPending} onClick={submit}>
          {segmentId ? "Save changes" : "Create segment"}
        </Button>
        <Button variant="secondary" onClick={() => router.back()}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
