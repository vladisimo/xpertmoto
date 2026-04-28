"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const STATUSES = [
  "AVAILABLE",
  "PENDING",
  "RENTED",
  "RESERVED",
  "IN_MAINTENANCE",
  "ACCIDENT_REPAIRS",
  "IN_TRANSIT",
  "SOLD",
  "END_OF_LIFE",
  "STOLEN",
  "WRITTEN_OFF",
] as const;

const ALL = "__all__";

export function FleetVehiclesFilterBar({
  depots,
  initial,
}: {
  depots: Array<{ id: string; name: string }>;
  initial: { q?: string; status?: string; depotId?: string };
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [q, setQ] = useState(initial.q ?? "");
  const [status, setStatus] = useState(initial.status || ALL);
  const [depotId, setDepotId] = useState(initial.depotId || ALL);

  function submit() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", "vehicles");
    if (q) params.set("q", q); else params.delete("q");
    if (status !== ALL) params.set("status", status); else params.delete("status");
    if (depotId !== ALL) params.set("depotId", depotId); else params.delete("depotId");
    startTransition(() => router.replace(`/staff/fleet?${params.toString()}`, { scroll: false }));
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-wrap items-end gap-2"
    >
      <div className="relative min-w-60 flex-1">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search code, rego, make…"
          className="pl-9"
        />
      </div>
      <div className="w-44">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {STATUSES.map((s) => (
              <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="w-44">
        <Select value={depotId} onValueChange={setDepotId}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All depots</SelectItem>
            {depots.map((d) => (
              <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button type="submit" disabled={isPending}>Filter</Button>
    </form>
  );
}
