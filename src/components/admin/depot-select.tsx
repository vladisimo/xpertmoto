"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export function DepotSelect({
  value,
  onChange,
  placeholder = "All depots",
  className,
}: {
  value: string | undefined;
  onChange: (id: string | undefined) => void;
  placeholder?: string;
  className?: string;
}) {
  const { data: depots } = trpc.depot.list.useQuery();
  return (
    <Select
      value={value ?? "__all__"}
      onValueChange={(v) => onChange(v === "__all__" ? undefined : v)}
    >
      <SelectTrigger className={className ?? "w-[220px]"}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all__">{placeholder}</SelectItem>
        {depots?.map((d) => (
          <SelectItem key={d.id} value={d.id}>
            {d.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
