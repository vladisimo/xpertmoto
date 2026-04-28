"use client";

import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type HoursRow = {
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
  isClosed: boolean;
};

export function HoursEditor({
  hours,
  onSave,
  saving,
}: {
  hours: HoursRow[];
  onSave: (h: HoursRow[]) => void;
  saving?: boolean;
}) {
  const [rows, setRows] = useState<HoursRow[]>(() =>
    Array.from({ length: 7 }, (_, i) => {
      const h = hours.find((x) => x.dayOfWeek === i);
      return h
        ? { dayOfWeek: i, openTime: h.openTime, closeTime: h.closeTime, isClosed: h.isClosed }
        : { dayOfWeek: i, openTime: "08:00", closeTime: "18:00", isClosed: false };
    }),
  );

  const patch = (i: number, p: Partial<HoursRow>) =>
    setRows(rows.map((r, idx) => (idx === i ? { ...r, ...p } : r)));

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[60px_1fr_1fr_80px] gap-2 items-center text-sm">
        {rows.map((r, i) => (
          <div key={r.dayOfWeek} className="contents">
            <div className="text-muted-foreground">{DAYS[r.dayOfWeek]}</div>
            <Input
              type="time"
              value={r.openTime}
              onChange={(e) => patch(i, { openTime: e.target.value })}
              disabled={r.isClosed}
              className="h-8"
            />
            <Input
              type="time"
              value={r.closeTime}
              onChange={(e) => patch(i, { closeTime: e.target.value })}
              disabled={r.isClosed}
              className="h-8"
            />
            <label className="flex gap-1 text-xs items-center">
              <input
                type="checkbox"
                checked={r.isClosed}
                onChange={(e) => patch(i, { isClosed: e.target.checked })}
              />
              Closed
            </label>
          </div>
        ))}
      </div>
      <Button size="sm" onClick={() => onSave(rows)} disabled={saving}>
        {saving ? "Saving..." : "Save hours"}
      </Button>
    </div>
  );
}
