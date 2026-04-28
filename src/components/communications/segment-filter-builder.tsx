"use client";

import { useMemo } from "react";
import { Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SegmentFilter, SegmentFilters } from "@/lib/validators/segment";

type Dimension = SegmentFilter["dimension"];

const DIMENSION_LABELS: Record<Dimension, string> = {
  AGE_RANGE: "Age range",
  STATE: "State",
  POSTCODE_PREFIX: "Postcode starts with",
  DEPOT: "Depot",
  LAST_RENTED_WITHIN: "Last rented within (days)",
  LAST_RENTED_BEFORE: "Last rented more than (days) ago",
  NEVER_RENTED: "Never rented",
  TOTAL_SPEND_MIN: "Total spend ≥ (AUD)",
  TOTAL_BOOKINGS_MIN: "Total bookings ≥",
  CATEGORY_RENTED: "Has rented category",
  CATEGORY_NEVER_RENTED: "Has never rented category",
  LICENCE_STATE: "Licence state",
  LICENCE_EXPIRING_WITHIN: "Licence expiring within (days)",
  LOYALTY_POINTS_MIN: "Loyalty points ≥",
  RISK_RATING: "Risk rating",
  MARKETING_EMAIL_OPT_IN: "Email marketing opted in",
  MARKETING_SMS_OPT_IN: "SMS marketing opted in",
  CUSTOMER_SINCE_BEFORE: "Customer since before",
  CUSTOMER_SINCE_AFTER: "Customer since after",
  BIRTHDAY_MONTH: "Birthday month",
};

const ALL_DIMENSIONS = Object.keys(DIMENSION_LABELS) as Dimension[];
const AU_STATES = ["NSW", "VIC", "QLD", "SA", "WA", "TAS", "ACT", "NT"];

type Props = {
  value: SegmentFilters;
  onChange: (next: SegmentFilters) => void;
  depotOptions?: Array<{ id: string; name: string }>;
  categoryOptions?: Array<{ id: string; name: string }>;
};

export function SegmentFilterBuilder({
  value,
  onChange,
  depotOptions = [],
  categoryOptions = [],
}: Props) {
  const update = (idx: number, next: SegmentFilter) => {
    const copy = [...value.filters];
    copy[idx] = next;
    onChange({ ...value, filters: copy });
  };
  const remove = (idx: number) => {
    onChange({ ...value, filters: value.filters.filter((_, i) => i !== idx) });
  };
  const add = () => {
    onChange({
      ...value,
      filters: [...value.filters, { dimension: "STATE", states: ["VIC"] }],
    });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        {value.filters.map((f, i) => (
          <FilterRow
            key={i}
            value={f}
            onChange={(next) => update(i, next)}
            onRemove={() => remove(i)}
            depotOptions={depotOptions}
            categoryOptions={categoryOptions}
          />
        ))}
      </div>
      <Button type="button" variant="secondary" size="sm" onClick={add}>
        <Plus className="h-3.5 w-3.5" />
        Add filter
      </Button>
    </div>
  );
}

function FilterRow({
  value,
  onChange,
  onRemove,
  depotOptions,
  categoryOptions,
}: {
  value: SegmentFilter;
  onChange: (next: SegmentFilter) => void;
  onRemove: () => void;
  depotOptions: Array<{ id: string; name: string }>;
  categoryOptions: Array<{ id: string; name: string }>;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card p-2">
      <Select
        value={value.dimension}
        onValueChange={(next) => onChange(defaultForDimension(next as Dimension))}
      >
        <SelectTrigger className="w-64">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {ALL_DIMENSIONS.map((d) => (
            <SelectItem key={d} value={d}>
              {DIMENSION_LABELS[d]}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <FilterEditor
        value={value}
        onChange={onChange}
        depotOptions={depotOptions}
        categoryOptions={categoryOptions}
      />

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="ml-auto"
        onClick={onRemove}
        aria-label="Remove filter"
      >
        <X className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

function FilterEditor({
  value,
  onChange,
  depotOptions,
  categoryOptions,
}: {
  value: SegmentFilter;
  onChange: (next: SegmentFilter) => void;
  depotOptions: Array<{ id: string; name: string }>;
  categoryOptions: Array<{ id: string; name: string }>;
}) {
  const stateOpts = useMemo(() => AU_STATES, []);

  switch (value.dimension) {
    case "AGE_RANGE":
      return (
        <div className="flex items-center gap-2">
          <Input
            type="number"
            placeholder="Min"
            className="w-20"
            value={value.min ?? ""}
            onChange={(e) =>
              onChange({ ...value, min: e.target.value ? Number(e.target.value) : undefined })
            }
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="number"
            placeholder="Max"
            className="w-20"
            value={value.max ?? ""}
            onChange={(e) =>
              onChange({ ...value, max: e.target.value ? Number(e.target.value) : undefined })
            }
          />
        </div>
      );
    case "STATE":
    case "LICENCE_STATE":
      return (
        <div className="flex flex-wrap gap-1">
          {stateOpts.map((s) => {
            const selected = value.states.includes(s as (typeof value.states)[number]);
            return (
              <button
                key={s}
                type="button"
                onClick={() =>
                  onChange({
                    ...value,
                    states: selected
                      ? value.states.filter((x) => x !== s)
                      : ([...value.states, s] as typeof value.states),
                  })
                }
                className={`rounded-md border px-2 py-1 text-xs ${
                  selected
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:border-primary/40"
                }`}
              >
                {s}
              </button>
            );
          })}
        </div>
      );
    case "POSTCODE_PREFIX":
      return (
        <Input
          placeholder="e.g. 40, 2000"
          className="w-48"
          value={value.prefixes.join(", ")}
          onChange={(e) =>
            onChange({
              ...value,
              prefixes: e.target.value
                .split(",")
                .map((p) => p.trim())
                .filter(Boolean),
            })
          }
        />
      );
    case "DEPOT":
      return (
        <Select
          value={value.depotIds[0] ?? ""}
          onValueChange={(v) => onChange({ ...value, depotIds: v ? [v] : [] })}
        >
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Choose depot" />
          </SelectTrigger>
          <SelectContent>
            {depotOptions.map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "LAST_RENTED_WITHIN":
    case "LAST_RENTED_BEFORE":
    case "LICENCE_EXPIRING_WITHIN":
      return (
        <Input
          type="number"
          placeholder="days"
          className="w-28"
          value={value.days}
          onChange={(e) => onChange({ ...value, days: Number(e.target.value) || 1 })}
        />
      );
    case "NEVER_RENTED":
      return <span className="text-xs text-muted-foreground">No options</span>;
    case "TOTAL_SPEND_MIN":
      return (
        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">$</span>
          <Input
            type="number"
            className="w-32"
            value={value.amount}
            onChange={(e) => onChange({ ...value, amount: Number(e.target.value) || 0 })}
          />
        </div>
      );
    case "TOTAL_BOOKINGS_MIN":
      return (
        <Input
          type="number"
          className="w-24"
          value={value.count}
          onChange={(e) => onChange({ ...value, count: Number(e.target.value) || 0 })}
        />
      );
    case "CATEGORY_RENTED":
    case "CATEGORY_NEVER_RENTED":
      return (
        <Select
          value={value.categoryIds[0] ?? ""}
          onValueChange={(v) => onChange({ ...value, categoryIds: v ? [v] : [] })}
        >
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Choose category" />
          </SelectTrigger>
          <SelectContent>
            {categoryOptions.map((c) => (
              <SelectItem key={c.id} value={c.id}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
    case "LOYALTY_POINTS_MIN":
      return (
        <Input
          type="number"
          className="w-28"
          value={value.points}
          onChange={(e) => onChange({ ...value, points: Number(e.target.value) || 0 })}
        />
      );
    case "RISK_RATING":
      return (
        <div className="flex gap-1">
          {(["LOW", "MEDIUM", "HIGH"] as const).map((r) => {
            const selected = value.ratings.includes(r);
            return (
              <button
                key={r}
                type="button"
                onClick={() =>
                  onChange({
                    ...value,
                    ratings: selected
                      ? value.ratings.filter((x) => x !== r)
                      : [...value.ratings, r],
                  })
                }
                className={`rounded-md border px-2 py-1 text-xs ${
                  selected
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground"
                }`}
              >
                {r}
              </button>
            );
          })}
        </div>
      );
    case "MARKETING_EMAIL_OPT_IN":
    case "MARKETING_SMS_OPT_IN":
      return (
        <Select
          value={value.value ? "yes" : "no"}
          onValueChange={(v) => onChange({ ...value, value: v === "yes" })}
        >
          <SelectTrigger className="w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="yes">Opted in</SelectItem>
            <SelectItem value="no">Opted out</SelectItem>
          </SelectContent>
        </Select>
      );
    case "CUSTOMER_SINCE_BEFORE":
    case "CUSTOMER_SINCE_AFTER":
      return (
        <Input
          type="date"
          className="w-44"
          value={toDateInput(value.date)}
          onChange={(e) => onChange({ ...value, date: new Date(e.target.value) })}
        />
      );
    case "BIRTHDAY_MONTH":
      return (
        <Select
          value={String(value.month)}
          onValueChange={(v) => onChange({ ...value, month: Number(v) })}
        >
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <SelectItem key={m} value={String(m)}>
                {new Date(2000, m - 1, 1).toLocaleString("en-AU", { month: "long" })}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      );
  }
}

function defaultForDimension(d: Dimension): SegmentFilter {
  switch (d) {
    case "AGE_RANGE":
      return { dimension: "AGE_RANGE", min: 18, max: 65 };
    case "STATE":
      return { dimension: "STATE", states: ["VIC"] };
    case "POSTCODE_PREFIX":
      return { dimension: "POSTCODE_PREFIX", prefixes: ["40"] };
    case "DEPOT":
      return { dimension: "DEPOT", depotIds: [] };
    case "LAST_RENTED_WITHIN":
      return { dimension: "LAST_RENTED_WITHIN", days: 90 };
    case "LAST_RENTED_BEFORE":
      return { dimension: "LAST_RENTED_BEFORE", days: 180 };
    case "NEVER_RENTED":
      return { dimension: "NEVER_RENTED" };
    case "TOTAL_SPEND_MIN":
      return { dimension: "TOTAL_SPEND_MIN", amount: 500 };
    case "TOTAL_BOOKINGS_MIN":
      return { dimension: "TOTAL_BOOKINGS_MIN", count: 1 };
    case "CATEGORY_RENTED":
      return { dimension: "CATEGORY_RENTED", categoryIds: [] };
    case "CATEGORY_NEVER_RENTED":
      return { dimension: "CATEGORY_NEVER_RENTED", categoryIds: [] };
    case "LICENCE_STATE":
      return { dimension: "LICENCE_STATE", states: ["VIC"] };
    case "LICENCE_EXPIRING_WITHIN":
      return { dimension: "LICENCE_EXPIRING_WITHIN", days: 30 };
    case "LOYALTY_POINTS_MIN":
      return { dimension: "LOYALTY_POINTS_MIN", points: 100 };
    case "RISK_RATING":
      return { dimension: "RISK_RATING", ratings: ["LOW"] };
    case "MARKETING_EMAIL_OPT_IN":
      return { dimension: "MARKETING_EMAIL_OPT_IN", value: true };
    case "MARKETING_SMS_OPT_IN":
      return { dimension: "MARKETING_SMS_OPT_IN", value: true };
    case "CUSTOMER_SINCE_BEFORE":
      return { dimension: "CUSTOMER_SINCE_BEFORE", date: new Date() };
    case "CUSTOMER_SINCE_AFTER":
      return { dimension: "CUSTOMER_SINCE_AFTER", date: new Date(Date.now() - 365 * 86400000) };
    case "BIRTHDAY_MONTH":
      return { dimension: "BIRTHDAY_MONTH", month: new Date().getMonth() + 1 };
  }
}

function toDateInput(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().slice(0, 10);
}
