"use client";

import { useCallback, useMemo, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  RefreshCw,
  FileText,
  ExternalLink,
  Search,
  UploadCloud,
  Trash2,
  Pencil,
  Loader2,
} from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { StatusBadge, type StatusKey } from "@/components/ui/status-badge";
import { PageSection } from "@/components/layout/page-section";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormGrid, FormGridRow } from "@/components/forms/form-grid";
import { formatDateTime, cn } from "@/lib/utils";
import { BikeType, FleetUseCase, RiderLevel } from "@prisma/client";
import { BIKE_TYPES, BIKE_TYPE_LABELS } from "@/lib/bike-types";
import { RIDER_LEVELS, RIDER_LEVEL_LABELS } from "@/lib/rider-levels";
import { USE_CASES, USE_CASE_LABELS } from "@/lib/fleet-use-cases";
import { ccToBand, ENGINE_BAND_LABELS } from "@/lib/engine-bands";
import { FleetClassificationMatrix } from "@/components/fleet/fleet-classification-matrix";

type ModelRow = {
  id: string;
  make: string;
  model: string;
  year: number;
  slug: string;
  category: { id: string; name: string } | null;
  engineCapacityCc: number | null;
  specsConfidence: "OFFICIAL_MANUFACTURER" | "REPUTABLE_SECONDARY" | "UNVERIFIED";
  specsFetchedAt: Date | null;
  specsSourceName: string | null;
  documentCount: number;
  vehicleCount: number;
  lastEnrichmentError: string | null;
};

const DOC_TYPE_OPTIONS = [
  { value: "OWNERS_MANUAL", label: "Owner's manual" },
  { value: "SERVICE_SCHEDULE", label: "Service schedule" },
  { value: "PARTS_CATALOGUE", label: "Parts catalogue" },
  { value: "WIRING_DIAGRAM", label: "Wiring diagram" },
  { value: "BROCHURE", label: "Brochure" },
] as const;

export function FleetMakesModelsTab() {
  const util = trpc.useUtils();
  const { data: rows, isLoading } = trpc.vehicleModel.list.useQuery();
  const [selected, setSelected] = useState<ModelRow | null>(null);
  const [search, setSearch] = useState("");
  const [confidence, setConfidence] = useState<string>("");
  const [view, setView] = useState<"list" | "matrix">("list");

  const enrich = trpc.vehicleModel.enqueueEnrichment.useMutation({
    onSuccess: () => util.vehicleModel.list.invalidate(),
  });

  const filteredRows = useMemo(() => {
    if (!rows) return rows;
    const s = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (confidence && r.specsConfidence !== confidence) return false;
      if (!s) return true;
      return (
        r.make.toLowerCase().includes(s) ||
        r.model.toLowerCase().includes(s) ||
        r.slug.toLowerCase().includes(s) ||
        String(r.year).includes(s)
      );
    });
  }, [rows, search, confidence]);

  const columns: DataTableColumn<ModelRow>[] = [
    {
      id: "model",
      header: "Model",
      sortable: true,
      accessor: (r) => `${r.make} ${r.model}`,
      cell: (r) => (
        <div className="min-w-0">
          <div className="font-medium">
            {r.make} {r.model}
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {r.year} · {r.slug}
          </div>
        </div>
      ),
    },
    {
      id: "category",
      header: "Category",
      cell: (r) => (
        <span className="text-muted-foreground">{r.category?.name ?? "—"}</span>
      ),
    },
    {
      id: "engine",
      header: "Engine",
      cell: (r) => (
        <span className="text-muted-foreground">
          {r.engineCapacityCc ? `${r.engineCapacityCc}cc` : "—"}
        </span>
      ),
    },
    {
      id: "confidence",
      header: "Provenance",
      cell: (r) => (
        <div className="flex flex-col gap-0.5">
          <StatusBadge status={r.specsConfidence} />
          {r.specsSourceName && (
            <span className="text-xs text-muted-foreground">{r.specsSourceName}</span>
          )}
        </div>
      ),
    },
    {
      id: "docs",
      header: "Docs",
      cell: (r) => <span className="tabular-nums text-muted-foreground">{r.documentCount}</span>,
    },
    {
      id: "vehicles",
      header: "Vehicles",
      cell: (r) => <span className="tabular-nums text-muted-foreground">{r.vehicleCount}</span>,
    },
    {
      id: "fetched",
      header: "Last fetched",
      cell: (r) => (
        <span className="text-muted-foreground">
          {r.specsFetchedAt ? formatDateTime(r.specsFetchedAt) : "Never"}
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      width: "16rem",
      cell: (r) => (
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={() => setSelected(r)}>
            <Pencil className="h-4 w-4" />
            Manage
          </Button>
          <Button
            size="sm"
            disabled={enrich.isPending}
            onClick={() => enrich.mutate({ id: r.id })}
          >
            <RefreshCw className="h-4 w-4" />
            Re-enrich
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <PageSection flush>
        <div className="mb-3 inline-flex rounded-md border border-border p-0.5">
          <button
            type="button"
            onClick={() => setView("list")}
            className={cn(
              "rounded px-3 py-1 text-sm transition-colors",
              view === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
            )}
          >
            List
          </button>
          <button
            type="button"
            onClick={() => setView("matrix")}
            className={cn(
              "rounded px-3 py-1 text-sm transition-colors",
              view === "matrix" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
            )}
          >
            Classification matrix
          </button>
        </div>

        {view === "matrix" ? (
          <FleetClassificationMatrix />
        ) : (
          <ModelListView
            rows={filteredRows}
            isLoading={isLoading}
            columns={columns}
            search={search}
            setSearch={setSearch}
            confidence={confidence}
            setConfidence={setConfidence}
          />
        )}
      </PageSection>

      <Sheet open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <SheetContent side="right" className="w-full sm:max-w-2xl">
          {selected && <ModelManage modelId={selected.id} />}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ModelListView({
  rows,
  isLoading,
  columns,
  search,
  setSearch,
  confidence,
  setConfidence,
}: {
  rows: ModelRow[] | undefined;
  isLoading: boolean;
  columns: DataTableColumn<ModelRow>[];
  search: string;
  setSearch: (v: string) => void;
  confidence: string;
  setConfidence: (v: string) => void;
}) {
  return (
    <>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              placeholder="Search make, model, year…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <div className="w-56">
            <Select value={confidence} onValueChange={(v) => setConfidence(v === "__all__" ? "" : v)}>
              <SelectTrigger>
                <SelectValue placeholder="All provenance tiers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All provenance tiers</SelectItem>
                <SelectItem value="OFFICIAL_MANUFACTURER">Official manufacturer</SelectItem>
                <SelectItem value="REPUTABLE_SECONDARY">Reputable secondary</SelectItem>
                <SelectItem value="UNVERIFIED">Unverified</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <DataTable
          columns={columns}
          data={rows}
          getRowId={(r) => r.id}
          empty={isLoading ? "Loading…" : "No models registered yet."}
        />
    </>
  );
}

const specSchema = z.object({
  engineCapacityCc: z.string().optional(),
  enginePowerKw: z.string().optional(),
  engineTorqueNm: z.string().optional(),
  dryWeightKg: z.string().optional(),
  fuelTankLitres: z.string().optional(),
  fuelType: z.string().optional(),
  topSpeedKmh: z.string().optional(),
  seatHeightMm: z.string().optional(),
  tyreFront: z.string().optional(),
  tyreRear: z.string().optional(),
  serviceIntervalKm: z.string().optional(),
  serviceIntervalMonths: z.string().optional(),
  specsSourceName: z.string().optional(),
  specsConfidence: z
    .enum(["OFFICIAL_MANUFACTURER", "REPUTABLE_SECONDARY", "UNVERIFIED"])
    .optional(),
});
type SpecValues = z.infer<typeof specSchema>;

function ModelManage({ modelId }: { modelId: string }) {
  const util = trpc.useUtils();
  const { data, isLoading } = trpc.vehicleModel.get.useQuery({ id: modelId });

  const update = trpc.vehicleModel.update.useMutation({
    onSuccess: () => {
      util.vehicleModel.get.invalidate({ id: modelId });
      util.vehicleModel.list.invalidate();
    },
  });
  const attach = trpc.vehicleModel.attachDocument.useMutation({
    onSuccess: () => {
      util.vehicleModel.get.invalidate({ id: modelId });
      util.vehicleModel.list.invalidate();
    },
  });
  const deleteDoc = trpc.vehicleModel.deleteDocument.useMutation({
    onSuccess: () => {
      util.vehicleModel.get.invalidate({ id: modelId });
      util.vehicleModel.list.invalidate();
    },
  });

  const form = useForm<SpecValues>({
    resolver: zodResolver(specSchema),
    values: data
      ? {
          engineCapacityCc: data.engineCapacityCc?.toString() ?? "",
          enginePowerKw: data.enginePowerKw?.toString() ?? "",
          engineTorqueNm: data.engineTorqueNm?.toString() ?? "",
          dryWeightKg: data.dryWeightKg?.toString() ?? "",
          fuelTankLitres: data.fuelTankLitres?.toString() ?? "",
          fuelType: data.fuelType ?? "",
          topSpeedKmh: data.topSpeedKmh?.toString() ?? "",
          seatHeightMm: data.seatHeightMm?.toString() ?? "",
          tyreFront: data.tyreFront ?? "",
          tyreRear: data.tyreRear ?? "",
          serviceIntervalKm: data.serviceIntervalKm?.toString() ?? "",
          serviceIntervalMonths: data.serviceIntervalMonths?.toString() ?? "",
          specsSourceName: data.specsSourceName ?? "",
          specsConfidence: data.specsConfidence,
        }
      : undefined,
  });

  const onSubmit = async (values: SpecValues) => {
    await update.mutateAsync({
      id: modelId,
      engineCapacityCc: toInt(values.engineCapacityCc),
      enginePowerKw: toNum(values.enginePowerKw),
      engineTorqueNm: toNum(values.engineTorqueNm),
      dryWeightKg: toNum(values.dryWeightKg),
      fuelTankLitres: toNum(values.fuelTankLitres),
      fuelType: emptyToNull(values.fuelType),
      topSpeedKmh: toInt(values.topSpeedKmh),
      seatHeightMm: toInt(values.seatHeightMm),
      tyreFront: emptyToNull(values.tyreFront),
      tyreRear: emptyToNull(values.tyreRear),
      serviceIntervalKm: toInt(values.serviceIntervalKm),
      serviceIntervalMonths: toInt(values.serviceIntervalMonths),
      specsSourceName: emptyToNull(values.specsSourceName),
      specsConfidence: values.specsConfidence,
    });
  };

  if (isLoading || !data) {
    return (
      <div className="flex h-full flex-col">
        <SheetHeader className="shrink-0 border-b px-6 py-4">
          <SheetTitle>Loading model…</SheetTitle>
          <SheetDescription>Fetching model details</SheetDescription>
        </SheetHeader>
        <div className="p-6 text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <SheetHeader className="shrink-0 border-b px-6 py-4">
        <SheetTitle className="flex items-center gap-2">
          {data.make} {data.model}
          <span className="text-muted-foreground">{data.year}</span>
        </SheetTitle>
        <SheetDescription className="flex flex-wrap items-center gap-2 pt-1 text-xs">
          <StatusBadge status={data.specsConfidence as StatusKey} />
          {data.specsSourceUrl && (
            <a
              href={data.specsSourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="h-3 w-3" />
              Source
            </a>
          )}
          {data.specsFetchedAt && <span>Fetched {formatDateTime(data.specsFetchedAt)}</span>}
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {data.lastEnrichmentError && (
          <div className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
            Last enrichment error: {data.lastEnrichmentError}
          </div>
        )}

        <section className="space-y-3">
          <div className="flex items-baseline justify-between">
            <h3 className="h3">Specifications</h3>
            <span className="caption text-muted-foreground">
              {data.vehicles.length} vehicle{data.vehicles.length === 1 ? "" : "s"} linked
            </span>
          </div>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)}>
              <FormGrid cols={2}>
                <NumberField control={form.control} name="engineCapacityCc" label="Engine (cc)" />
                <NumberField control={form.control} name="enginePowerKw" label="Power (kW)" step="0.1" />
                <NumberField control={form.control} name="engineTorqueNm" label="Torque (Nm)" step="0.1" />
                <NumberField control={form.control} name="dryWeightKg" label="Dry weight (kg)" step="0.1" />
                <NumberField control={form.control} name="fuelTankLitres" label="Fuel tank (L)" step="0.1" />
                <TextField control={form.control} name="fuelType" label="Fuel type" placeholder="Unleaded 91 RON" />
                <NumberField control={form.control} name="topSpeedKmh" label="Top speed (km/h)" />
                <NumberField control={form.control} name="seatHeightMm" label="Seat height (mm)" />
                <TextField control={form.control} name="tyreFront" label="Front tyre" placeholder="110/70-14" />
                <TextField control={form.control} name="tyreRear" label="Rear tyre" placeholder="130/70-13" />
                <NumberField control={form.control} name="serviceIntervalKm" label="Service interval (km)" />
                <NumberField control={form.control} name="serviceIntervalMonths" label="Service interval (months)" />
                <TextField
                  control={form.control}
                  name="specsSourceName"
                  label="Source name"
                  placeholder="e.g. Honda Australia, Manually entered"
                />
                <FormField
                  control={form.control}
                  name="specsConfidence"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Provenance tier</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value ?? ""}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="OFFICIAL_MANUFACTURER">Official manufacturer</SelectItem>
                          <SelectItem value="REPUTABLE_SECONDARY">Reputable secondary</SelectItem>
                          <SelectItem value="UNVERIFIED">Unverified</SelectItem>
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormGridRow className="flex justify-end">
                  <Button type="submit" disabled={update.isPending}>
                    {update.isPending ? "Saving…" : "Save specifications"}
                  </Button>
                </FormGridRow>
              </FormGrid>
            </form>
          </Form>
        </section>

        <ClassificationEditor
          modelId={modelId}
          engineCapacityCc={data.engineCapacityCc}
          initialBikeTypes={data.bikeTypes}
          initialRiderLevels={data.riderLevels}
          initialUseCases={data.useCases}
        />

        <section className="mt-8 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="h3">Documents</h3>
            <UploadDocumentButton
              modelId={modelId}
              onUploaded={() => {
                util.vehicleModel.get.invalidate({ id: modelId });
                util.vehicleModel.list.invalidate();
              }}
              attach={attach}
            />
          </div>
          {data.documents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No documents attached yet. Upload an owner&apos;s manual, service schedule, or
              brochure — or click <strong>Re-enrich</strong> on the list to pull from the
              manufacturer.
            </p>
          ) : (
            <ul className="space-y-2">
              {data.documents.map((d) => (
                <li
                  key={d.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
                >
                  <div className="min-w-0">
                    <div className="font-medium">{d.title}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {d.type.replace(/_/g, " ").toLowerCase()} · {d.sourceDomain}
                      {d.sizeBytes ? ` · ${Math.round(d.sizeBytes / 1024)} KB` : ""}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button asChild variant="secondary" size="sm">
                      <a href={d.downloadUrl} target="_blank" rel="noreferrer noopener">
                        <FileText className="h-4 w-4" />
                        Open
                      </a>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteDoc.mutate({ documentId: d.id })}
                      disabled={deleteDoc.isPending}
                      aria-label="Delete document"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {data.vehicles.length > 0 && (
          <section className="mt-8 space-y-2">
            <h3 className="h3">Linked vehicles ({data.vehicles.length})</h3>
            <div className="flex flex-wrap gap-2">
              {data.vehicles.map((v) => (
                <a
                  key={v.id}
                  href={`/staff/fleet/vehicles/${v.id}`}
                  className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
                >
                  {v.internalCode} · {v.rego} ({v.regoState})
                </a>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

/**
 * Per-model browse/filter taxonomy editor. Deliberately separate from the
 * Specifications form: toggling a classification tag must NOT bump
 * `specsFetchedAt` / `specsConfidence` (the catalogue should never claim the
 * manufacturer specs were re-verified just because someone ticked "Sport").
 * Engine band is shown read-only — it's derived from the entered cc.
 */
function ClassificationEditor({
  modelId,
  engineCapacityCc,
  initialBikeTypes,
  initialRiderLevels,
  initialUseCases,
}: {
  modelId: string;
  engineCapacityCc: number | null;
  initialBikeTypes: BikeType[];
  initialRiderLevels: RiderLevel[];
  initialUseCases: FleetUseCase[];
}) {
  const util = trpc.useUtils();
  const [bikeTypes, setBikeTypes] = useState<BikeType[]>(initialBikeTypes);
  const [riderLevels, setRiderLevels] = useState<RiderLevel[]>(initialRiderLevels);
  const [useCases, setUseCases] = useState<FleetUseCase[]>(initialUseCases);

  const save = trpc.vehicleModel.updateClassification.useMutation({
    onSuccess: () => {
      util.vehicleModel.get.invalidate({ id: modelId });
      util.vehicleModel.list.invalidate();
    },
  });

  const dirty =
    !sameSet(bikeTypes, initialBikeTypes) ||
    !sameSet(riderLevels, initialRiderLevels) ||
    !sameSet(useCases, initialUseCases);

  const band = ccToBand(engineCapacityCc);

  return (
    <section className="mt-8 space-y-4">
      <div className="flex items-baseline justify-between">
        <h3 className="h3">Classification</h3>
        <span className="caption text-muted-foreground">
          Browse &amp; filter tags — does not affect pricing
        </span>
      </div>

      <TogglePillGroup
        label="Use cases"
        options={USE_CASES}
        labels={USE_CASE_LABELS}
        selected={useCases}
        onToggle={(v) => setUseCases((prev) => toggle(prev, v))}
      />
      <TogglePillGroup
        label="Rider levels"
        options={RIDER_LEVELS}
        labels={RIDER_LEVEL_LABELS}
        selected={riderLevels}
        onToggle={(v) => setRiderLevels((prev) => toggle(prev, v))}
      />
      <TogglePillGroup
        label="Bike types"
        options={BIKE_TYPES}
        labels={BIKE_TYPE_LABELS}
        selected={bikeTypes}
        onToggle={(v) => setBikeTypes((prev) => toggle(prev, v))}
      />

      <div className="text-sm">
        <span className="font-medium">Engine band: </span>
        <span className="text-muted-foreground">
          {band ? ENGINE_BAND_LABELS[band] : "— (set engine cc above)"}
        </span>
      </div>

      <div className="flex justify-end">
        <Button
          disabled={!dirty || save.isPending}
          onClick={() => save.mutate({ id: modelId, bikeTypes, riderLevels, useCases })}
        >
          {save.isPending ? "Saving…" : "Save classification"}
        </Button>
      </div>
    </section>
  );
}

function TogglePillGroup<T extends string>({
  label,
  options,
  labels,
  selected,
  onToggle,
}: {
  label: string;
  options: readonly T[];
  labels: Record<T, string>;
  selected: T[];
  onToggle: (value: T) => void;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-sm font-medium">{label}</p>
      <div className="flex flex-wrap gap-2">
        {options.map((opt) => {
          const active = selected.includes(opt);
          return (
            <button
              key={opt}
              type="button"
              role="checkbox"
              aria-checked={active}
              aria-label={`${label}: ${labels[opt]}`}
              onClick={() => onToggle(opt)}
              className={cn(
                "rounded-full border px-3 py-1 text-sm transition-colors",
                active
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:bg-muted",
              )}
            >
              {labels[opt]}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function toggle<T>(arr: T[], value: T): T[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}

function sameSet<T>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((v) => setB.has(v));
}

function UploadDocumentButton({
  modelId,
  onUploaded,
  attach,
}: {
  modelId: string;
  onUploaded: () => void;
  attach: ReturnType<typeof trpc.vehicleModel.attachDocument.useMutation>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<{
    url: string;
    key: string;
    name: string;
    sizeBytes: number;
  } | null>(null);
  const [type, setType] = useState<(typeof DOC_TYPE_OPTIONS)[number]["value"]>("OWNERS_MANUAL");
  const [title, setTitle] = useState("");

  const uploadFile = useCallback(async (file: File) => {
    setError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload/vehicle-model-document", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Upload failed (${res.status})`);
      }
      const body = (await res.json()) as { url: string; key: string; sizeBytes: number };
      setPendingFile({ url: body.url, key: body.key, name: file.name, sizeBytes: body.sizeBytes });
      setTitle((prev) => prev || file.name.replace(/\.pdf$/i, ""));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }, []);

  const handleFile = (file: File | undefined) => {
    if (!file) return;
    void uploadFile(file);
  };

  const submit = async () => {
    if (!pendingFile) return;
    await attach.mutateAsync({
      modelId,
      type,
      title: title || pendingFile.name,
      fileUrl: pendingFile.url,
      storageKey: pendingFile.key,
      sizeBytes: pendingFile.sizeBytes,
    });
    setPendingFile(null);
    setTitle("");
    onUploaded();
  };

  return (
    <div className="flex items-center gap-2">
      {pendingFile ? (
        <div className="flex items-center gap-2">
          <Select value={type} onValueChange={(v) => setType(v as typeof type)}>
            <SelectTrigger className="h-9 w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DOC_TYPE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="h-9 w-56"
          />
          <Button size="sm" disabled={attach.isPending} onClick={submit}>
            {attach.isPending ? "Attaching…" : "Attach"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setPendingFile(null)}>
            Cancel
          </Button>
        </div>
      ) : (
        <>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0] ?? undefined)}
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={uploading}
            onClick={() => inputRef.current?.click()}
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
            {uploading ? "Uploading…" : "Upload PDF"}
          </Button>
          {error && <span className="text-xs text-destructive">{error}</span>}
        </>
      )}
    </div>
  );
}

type Control = ReturnType<typeof useForm<SpecValues>>["control"];

function TextField({
  control,
  name,
  label,
  placeholder,
}: {
  control: Control;
  name: keyof SpecValues;
  label: string;
  placeholder?: string;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input placeholder={placeholder} {...field} value={field.value ?? ""} />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function NumberField({
  control,
  name,
  label,
  step,
}: {
  control: Control;
  name: keyof SpecValues;
  label: string;
  step?: string;
}) {
  return (
    <FormField
      control={control}
      name={name}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <Input
              type="number"
              inputMode="decimal"
              step={step ?? "1"}
              {...field}
              value={field.value ?? ""}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

function toInt(v: string | undefined): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

function toNum(v: string | undefined): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function emptyToNull(v: string | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  return v === "" ? null : v;
}
