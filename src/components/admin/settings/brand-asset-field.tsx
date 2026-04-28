"use client";

import Image from "next/image";
import { useRef, useState } from "react";
import { Check, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Slot = "logoWide" | "logoBlack" | "logoSquare" | "favicon";
type SaveState = "idle" | "uploading" | "saved" | "error";

export interface BrandAssetFieldProps {
  label: string;
  description?: string;
  slot: Slot;
  value: string | null;
  onChange: (nextUrl: string) => Promise<unknown> | unknown;
}

const ACCEPT: Record<Slot, string> = {
  logoWide: "image/png,image/jpeg,image/webp,image/svg+xml",
  logoBlack: "image/png,image/jpeg,image/webp,image/svg+xml",
  logoSquare: "image/png,image/jpeg,image/webp,image/svg+xml",
  favicon: "image/png,image/x-icon,image/vnd.microsoft.icon,image/svg+xml",
};

const PREVIEW_VARIANT: Record<Slot, "dark" | "light"> = {
  logoWide: "dark",
  logoBlack: "light",
  logoSquare: "dark",
  favicon: "light",
};

export function BrandAssetField({
  label,
  description,
  slot,
  value,
  onChange,
}: BrandAssetFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<SaveState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  function pick() {
    inputRef.current?.click();
  }

  async function handleFile(file: File) {
    setState("uploading");
    setErrorMessage(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("slot", slot);
      const res = await fetch("/api/upload/brand-asset", {
        method: "POST",
        body: form,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Upload failed");
      }
      const body = (await res.json()) as { url: string };
      await onChange(body.url);
      setState("saved");
      setTimeout(() => setState("idle"), 1800);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Upload failed");
      setState("error");
    }
  }

  async function handleRemove() {
    setState("uploading");
    try {
      await onChange("");
      setState("saved");
      setTimeout(() => setState("idle"), 1800);
    } catch {
      setState("error");
    }
  }

  const previewVariant = PREVIEW_VARIANT[slot];
  const hasAsset = Boolean(value);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-sm font-medium">{label}</Label>
        <div className="min-h-[1rem]">
          {state === "uploading" ? (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Working…
            </span>
          ) : state === "saved" ? (
            <span className="flex items-center gap-1 text-xs text-primary">
              <Check className="h-3 w-3" aria-hidden /> Saved
            </span>
          ) : state === "error" ? (
            <span className="text-xs text-destructive">{errorMessage ?? "Save failed"}</span>
          ) : null}
        </div>
      </div>

      <div
        className={cn(
          "flex h-24 items-center justify-center rounded-md border px-4",
          previewVariant === "dark" ? "border-border bg-slate-900" : "border-border bg-muted",
        )}
      >
        {hasAsset ? (
          <Image
            src={value!}
            alt={label}
            width={slot === "logoWide" || slot === "logoBlack" ? 200 : 64}
            height={64}
            unoptimized
            className={cn(
              "h-16 w-auto object-contain",
              slot !== "logoWide" && slot !== "logoBlack" && "h-12 w-12",
            )}
          />
        ) : (
          <span
            className={cn(
              "text-xs",
              previewVariant === "dark" ? "text-slate-400" : "text-muted-foreground",
            )}
          >
            No {slot === "favicon" ? "favicon" : "logo"} uploaded — using default
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT[slot]}
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void handleFile(file);
          }}
        />
        <Button type="button" variant="secondary" size="sm" onClick={pick}>
          <Upload className="mr-2 h-3.5 w-3.5" />
          {hasAsset ? "Replace" : "Upload"}
        </Button>
        {hasAsset ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => void handleRemove()}
          >
            <Trash2 className="mr-2 h-3.5 w-3.5" />
            Remove
          </Button>
        ) : null}
      </div>

      {description ? (
        <p className="caption text-xs text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}
