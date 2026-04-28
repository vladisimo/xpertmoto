"use client";
import { useEffect, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type FieldType = "number" | "text" | "boolean" | "decimal";
type SaveState = "idle" | "saving" | "saved" | "error";

export interface SettingFieldProps {
  label: string;
  description?: string;
  settingKey: string;
  type: FieldType;
  /** Raw stored JSON value (or undefined when unset). */
  value: unknown;
  onSave: (next: unknown) => Promise<unknown> | unknown;
  /** Optional suffix displayed after the input (e.g. "days", "%"). */
  suffix?: string;
}

function toDisplayString(type: FieldType, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (type === "boolean") return value ? "true" : "false";
  return String(value);
}

function parseValue(type: FieldType, raw: string): unknown {
  if (type === "number") return raw === "" ? null : Math.round(Number(raw));
  if (type === "decimal") return raw === "" ? null : Number(raw);
  if (type === "boolean") return raw === "true";
  return raw;
}

export function SettingField({
  label,
  description,
  settingKey,
  type,
  value,
  onSave,
  suffix,
}: SettingFieldProps) {
  const initial = toDisplayString(type, value);
  const [local, setLocal] = useState(initial);
  const [state, setState] = useState<SaveState>("idle");
  const lastSaved = useRef(initial);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (state !== "saving") {
      setLocal(initial);
      lastSaved.current = initial;
    }
  }, [initial, state]);

  async function flush(next: string) {
    if (next === lastSaved.current) return;
    setState("saving");
    try {
      await onSave(parseValue(type, next));
      lastSaved.current = next;
      setState("saved");
      if (savedTimer.current) clearTimeout(savedTimer.current);
      savedTimer.current = setTimeout(() => setState("idle"), 1800);
    } catch {
      setState("error");
    }
  }

  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    [],
  );

  const indicator =
    state === "saving" ? (
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> Saving…
      </span>
    ) : state === "saved" ? (
      <span className="flex items-center gap-1 text-xs text-primary">
        <Check className="h-3 w-3" aria-hidden /> Saved
      </span>
    ) : state === "error" ? (
      <span className="text-xs text-destructive">Save failed</span>
    ) : null;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={settingKey} className="text-sm font-medium">
          {label}
        </Label>
        <div className="min-h-[1rem]">{indicator}</div>
      </div>
      {type === "boolean" ? (
        <Select
          value={local || "false"}
          onValueChange={(v) => {
            setLocal(v);
            void flush(v);
          }}
        >
          <SelectTrigger id={settingKey} className={cn(state === "error" && "border-destructive")}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="true">Enabled</SelectItem>
            <SelectItem value="false">Disabled</SelectItem>
          </SelectContent>
        </Select>
      ) : (
        <div className="relative flex items-center">
          <Input
            id={settingKey}
            type={type === "text" ? "text" : "number"}
            step={type === "decimal" ? "0.01" : undefined}
            inputMode={type === "text" ? "text" : "decimal"}
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            onBlur={(e) => void flush(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className={cn(suffix && "pr-14", state === "error" && "border-destructive")}
          />
          {suffix ? (
            <span className="pointer-events-none absolute right-3 text-xs text-muted-foreground">
              {suffix}
            </span>
          ) : null}
        </div>
      )}
      {description ? (
        <p className="caption text-xs text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}
