"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { trpc } from "@/lib/trpc/client";
import type {
  ValidationResult,
  VehiclePayload,
} from "@/lib/fleet/import-validate";
import { FleetImportPreview } from "./fleet-import-preview";

type Stage = "idle" | "validating" | "previewing" | "importing" | "done";

export function FleetImportCard() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [fileName, setFileName] = useState<string | null>(null);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [topError, setTopError] = useState<string | null>(null);
  const [importSummary, setImportSummary] = useState<{ created: number } | null>(null);
  const [, startRefresh] = useTransition();

  const bulkCreate = trpc.fleet.bulkCreateVehicles.useMutation();

  async function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setTopError(null);
    setValidation(null);
    setImportSummary(null);
    setStage("validating");

    const fd = new FormData();
    fd.append("file", file);

    try {
      const res = await fetch("/api/fleet/import-validate", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Upload failed" }));
        setTopError(body.error ?? `Upload failed (${res.status})`);
        setStage("idle");
        return;
      }
      const data = (await res.json()) as ValidationResult;
      setValidation(data);
      setStage("previewing");
    } catch (err) {
      setTopError(err instanceof Error ? err.message : "Upload failed");
      setStage("idle");
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function reset() {
    setStage("idle");
    setFileName(null);
    setValidation(null);
    setTopError(null);
    setImportSummary(null);
  }

  async function confirmImport() {
    if (!validation || validation.payload.length === 0) return;
    setStage("importing");
    try {
      const result = await bulkCreate.mutateAsync({
        vehicles: validation.payload as VehiclePayload[],
      });
      setImportSummary({ created: result.created });
      setStage("done");
      startRefresh(() => router.refresh());
    } catch (err) {
      setTopError(err instanceof Error ? err.message : "Import failed");
      setStage("previewing");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 rounded-md border bg-muted/30 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium">Upload filled template</p>
          <p className="text-xs text-muted-foreground">
            XLSX only, up to 4&nbsp;MB and 500 rows. We validate the whole file before importing anything.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={onPick}
          />
          <Button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={stage === "validating" || stage === "importing"}
          >
            {stage === "validating" ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Validating…
              </>
            ) : (
              <>
                <Upload className="h-4 w-4" />
                Choose file
              </>
            )}
          </Button>
        </div>
      </div>

      {fileName && stage !== "done" && (
        <p className="text-xs text-muted-foreground">
          File: <span className="font-medium">{fileName}</span>
        </p>
      )}

      {topError && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{topError}</span>
        </div>
      )}

      {stage === "previewing" && validation && (
        <FleetImportPreview
          result={validation}
          importing={false}
          onConfirm={confirmImport}
          onReset={reset}
        />
      )}
      {stage === "importing" && validation && (
        <FleetImportPreview
          result={validation}
          importing
          onConfirm={confirmImport}
          onReset={reset}
        />
      )}

      {stage === "done" && importSummary && (
        <div className="flex items-start gap-2 rounded-md border border-primary/30 bg-primary/10 p-3 text-sm text-foreground">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="flex-1">
            <p className="font-medium">
              Imported {importSummary.created} vehicle{importSummary.created === 1 ? "" : "s"}.
            </p>
            <p className="text-xs text-muted-foreground">
              They appear on the Vehicles tab as <span className="font-medium">AVAILABLE</span>. Add
              photos and documents from each vehicle's detail page.
            </p>
          </div>
          <Button type="button" size="sm" variant="secondary" onClick={reset}>
            Import another
          </Button>
        </div>
      )}
    </div>
  );
}
