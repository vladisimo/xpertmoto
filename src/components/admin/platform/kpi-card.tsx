"use client";

import type { LucideIcon } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

export function KpiCard({
  title,
  primary,
  secondary,
  icon: Icon,
}: {
  title: string;
  primary: string;
  secondary?: string;
  icon: LucideIcon;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="text-xs text-muted-foreground">{title}</div>
          <span className="text-muted-foreground">
            <Icon className="h-4 w-4" aria-hidden />
          </span>
        </div>
        <div className="mt-2 text-lg font-semibold tabular-nums">{primary}</div>
        {secondary && (
          <div className="mt-1 text-xs text-muted-foreground">{secondary}</div>
        )}
      </CardContent>
    </Card>
  );
}
