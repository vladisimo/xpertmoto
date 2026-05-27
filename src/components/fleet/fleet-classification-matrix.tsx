"use client";

import * as React from "react";
import { Check, Loader2 } from "lucide-react";
import { BikeType, FleetUseCase, RiderLevel } from "@prisma/client";
import { trpc } from "@/lib/trpc/client";
import { cn } from "@/lib/utils";
import { BIKE_TYPES, BIKE_TYPE_LABELS } from "@/lib/bike-types";
import { RIDER_LEVELS, RIDER_LEVEL_LABELS } from "@/lib/rider-levels";
import { USE_CASES, USE_CASE_LABELS } from "@/lib/fleet-use-cases";
import { ccToBand, ENGINE_BAND_LABELS } from "@/lib/engine-bands";

/**
 * Spreadsheet-style classification matrix: rows are models, columns are the
 * browse/filter axes (use cases / rider levels / bike types) as checkboxes,
 * plus a read-only engine band derived from the model's cc. Toggling a cell
 * autosaves that row (debounced) via `vehicleModel.updateClassification` — a
 * spreadsheet mental model, no explicit save button. Pricing is never touched.
 */

const SAVE_DEBOUNCE_MS = 600;

type RowState = {
  useCases: FleetUseCase[];
  bikeTypes: BikeType[];
  riderLevels: RiderLevel[];
};

type SaveStatus = "idle" | "saving" | "saved" | "error";

function toggle<T>(arr: T[], value: T): T[] {
  return arr.includes(value) ? arr.filter((v) => v !== value) : [...arr, value];
}

export function FleetClassificationMatrix() {
  const util = trpc.useUtils();
  const { data: rows, isLoading } = trpc.vehicleModel.list.useQuery();
  const save = trpc.vehicleModel.updateClassification.useMutation();

  // Local edit overlay keyed by model id, seeded from the query and updated
  // optimistically on each toggle.
  const [edits, setEdits] = React.useState<Record<string, RowState>>({});
  const [status, setStatus] = React.useState<Record<string, SaveStatus>>({});
  const [error, setError] = React.useState<string | null>(null);
  const timers = React.useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  React.useEffect(() => {
    const pending = timers.current;
    return () => {
      Object.values(pending).forEach(clearTimeout);
    };
  }, []);

  const stateFor = React.useCallback(
    (id: string): RowState | null => {
      if (edits[id]) return edits[id];
      const row = rows?.find((r) => r.id === id);
      if (!row) return null;
      return {
        useCases: row.useCases,
        bikeTypes: row.bikeTypes,
        riderLevels: row.riderLevels,
      };
    },
    [edits, rows],
  );

  const scheduleSave = React.useCallback(
    (id: string, next: RowState) => {
      if (timers.current[id]) clearTimeout(timers.current[id]);
      setStatus((s) => ({ ...s, [id]: "saving" }));
      timers.current[id] = setTimeout(() => {
        save.mutate(
          { id, ...next },
          {
            onSuccess: () => {
              setStatus((s) => ({ ...s, [id]: "saved" }));
              setError(null);
              void util.vehicleModel.list.invalidate();
            },
            onError: (err) => {
              setStatus((s) => ({ ...s, [id]: "error" }));
              setError(`Couldn't save classification: ${err.message}`);
            },
          },
        );
      }, SAVE_DEBOUNCE_MS);
    },
    [save, util],
  );

  const onToggle = React.useCallback(
    <K extends keyof RowState>(id: string, axis: K, value: RowState[K][number]) => {
      const current = stateFor(id);
      if (!current) return;
      const arr = current[axis] as RowState[K][number][];
      const next = { ...current, [axis]: toggle(arr, value) } as RowState;
      setEdits((e) => ({ ...e, [id]: next }));
      scheduleSave(id, next);
    },
    [stateFor, scheduleSave],
  );

  if (isLoading) {
    return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  }
  if (!rows || rows.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">No models registered yet.</p>;
  }

  return (
    <div className="space-y-2">
      {error && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>
      )}
      <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-muted/50">
            <th
              rowSpan={2}
              scope="col"
              className="sticky left-0 z-20 min-w-[14rem] border-r border-border bg-muted/50 px-3 py-2 text-left font-medium"
            >
              Model
            </th>
            <th scope="colgroup" colSpan={USE_CASES.length} className="border-r border-border px-3 py-1.5 text-center font-medium">
              Use cases
            </th>
            <th scope="colgroup" colSpan={RIDER_LEVELS.length} className="border-r border-border px-3 py-1.5 text-center font-medium">
              Rider level
            </th>
            <th scope="colgroup" colSpan={BIKE_TYPES.length} className="border-r border-border px-3 py-1.5 text-center font-medium">
              Bike type
            </th>
            <th rowSpan={2} scope="col" className="px-3 py-2 text-center font-medium">
              Engine band
            </th>
          </tr>
          <tr className="border-b border-border bg-muted/30">
            {USE_CASES.map((u) => (
              <ColHeader key={u} label={USE_CASE_LABELS[u]} />
            ))}
            {RIDER_LEVELS.map((l) => (
              <ColHeader key={l} label={RIDER_LEVEL_LABELS[l]} />
            ))}
            {BIKE_TYPES.map((t) => (
              <ColHeader key={t} label={BIKE_TYPE_LABELS[t]} last={t === BIKE_TYPES[BIKE_TYPES.length - 1]} />
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const st = stateFor(row.id);
            if (!st) return null;
            const band = ccToBand(row.engineCapacityCc);
            const saveState = status[row.id] ?? "idle";
            return (
              <tr key={row.id} className="border-b border-border last:border-0 hover:bg-muted/20">
                <th
                  scope="row"
                  className="sticky left-0 z-10 min-w-[14rem] border-r border-border bg-background px-3 py-2 text-left font-normal"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-medium">
                        {row.make} {row.model}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{row.year}</div>
                    </div>
                    <SaveIndicator status={saveState} />
                  </div>
                </th>
                {USE_CASES.map((u) => (
                  <CheckCell
                    key={u}
                    checked={st.useCases.includes(u)}
                    label={`${row.make} ${row.model} — ${USE_CASE_LABELS[u]}`}
                    onToggle={() => onToggle(row.id, "useCases", u)}
                  />
                ))}
                {RIDER_LEVELS.map((l) => (
                  <CheckCell
                    key={l}
                    checked={st.riderLevels.includes(l)}
                    label={`${row.make} ${row.model} — ${RIDER_LEVEL_LABELS[l]}`}
                    onToggle={() => onToggle(row.id, "riderLevels", l)}
                  />
                ))}
                {BIKE_TYPES.map((t) => (
                  <CheckCell
                    key={t}
                    checked={st.bikeTypes.includes(t)}
                    last={t === BIKE_TYPES[BIKE_TYPES.length - 1]}
                    label={`${row.make} ${row.model} — ${BIKE_TYPE_LABELS[t]}`}
                    onToggle={() => onToggle(row.id, "bikeTypes", t)}
                  />
                ))}
                <td className="px-3 py-2 text-center text-xs text-muted-foreground">
                  {band ? ENGINE_BAND_LABELS[band] : "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      </div>
    </div>
  );
}

function ColHeader({ label, last }: { label: string; last?: boolean }) {
  return (
    <th
      scope="col"
      className={cn(
        "px-2 py-1.5 text-center align-bottom text-xs font-normal text-muted-foreground",
        last && "border-r border-border",
      )}
    >
      <span className="inline-block whitespace-nowrap">{label}</span>
    </th>
  );
}

function CheckCell({
  checked,
  label,
  onToggle,
  last,
}: {
  checked: boolean;
  label: string;
  onToggle: () => void;
  last?: boolean;
}) {
  return (
    <td className={cn("px-2 py-2 text-center", last && "border-r border-border")}>
      <input
        type="checkbox"
        checked={checked}
        aria-label={label}
        onChange={onToggle}
        className="h-4 w-4 cursor-pointer accent-primary"
      />
    </td>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === "saving") return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />;
  if (status === "saved") return <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" aria-label="Saved" />;
  if (status === "error") return <span className="shrink-0 text-xs text-destructive">!</span>;
  return null;
}
