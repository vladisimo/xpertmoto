"use client";

import * as React from "react";
import { FileDown, FileSpreadsheet, FileText, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export interface ExportMenuProps {
  report: string;
  params: Record<string, string | undefined>;
  disabled?: boolean;
  label?: string;
}

function buildUrl(report: string, format: string, params: Record<string, string | undefined>) {
  const qs = new URLSearchParams();
  qs.set("report", report);
  qs.set("format", format);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") qs.set(k, v);
  }
  return `/api/admin/reports/export?${qs.toString()}`;
}

export function ExportMenu({ report, params, disabled, label = "Export" }: ExportMenuProps) {
  const go = (format: "csv" | "xlsx" | "pdf") => {
    window.location.assign(buildUrl(report, format, params));
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary" size="sm" disabled={disabled} className="gap-1.5">
          <FileDown className="h-4 w-4" aria-hidden />
          {label}
          <ChevronDown className="h-3.5 w-3.5 opacity-60" aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[160px]">
        <DropdownMenuItem onClick={() => go("csv")} className="gap-2">
          <FileText className="h-4 w-4" aria-hidden /> CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => go("xlsx")} className="gap-2">
          <FileSpreadsheet className="h-4 w-4" aria-hidden /> Excel (XLSX)
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => go("pdf")} className="gap-2">
          <FileText className="h-4 w-4" aria-hidden /> PDF
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
