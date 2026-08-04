"use client";

import { useRef, useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { PhotoCaptureGrid } from "./photo-capture-grid";

type Severity = "MINOR" | "MODERATE" | "MAJOR";
type Side = "FRONT" | "REAR" | "LEFT" | "RIGHT" | "TOP" | "OTHER";

const SEVERITIES: Severity[] = ["MINOR", "MODERATE", "MAJOR"];

/** Pin fill by severity (amber → orange → red). */
const SEVERITY_PIN: Record<Severity, string> = {
  MINOR: "bg-amber-400 border-amber-600",
  MODERATE: "bg-orange-500 border-orange-700",
  MAJOR: "bg-red-500 border-red-700",
};

const SIDE_LABEL: Record<Side, string> = {
  FRONT: "Front",
  REAR: "Rear",
  LEFT: "Left",
  RIGHT: "Right",
  TOP: "Top",
  OTHER: "Other",
};

/** Map a photo capture slot label (the caption) to a normalised vehicle side. */
function slotToSide(caption: string | null | undefined): Side | undefined {
  const c = (caption ?? "").toLowerCase();
  if (c.includes("front")) return "FRONT";
  if (c.includes("rear") || c.includes("back")) return "REAR";
  if (c.includes("left")) return "LEFT";
  if (c.includes("right")) return "RIGHT";
  if (c.includes("top")) return "TOP";
  return undefined;
}

function title(s: string): string {
  return s.charAt(0) + s.slice(1).toLowerCase();
}

// Minimal structural shapes — the tRPC query returns wider objects, which are
// structurally assignable to these.
type Tariff = { id: string; name: string };
type Photo = { id: string; url: string; caption: string | null };
type Issue = {
  id: string;
  inspectionPhotoId: string | null;
  side: string | null;
  damageTariffId: string | null;
  label: string;
  severity: Severity;
  note: string | null;
  posX: number | null;
  posY: number | null;
  source: string;
};

type NewIssue = {
  label: string;
  severity: Severity;
  damageTariffId?: string;
  note?: string;
  posX: number;
  posY: number;
};

export type PhotoIssueCaptureProps = {
  /** DRAFT inspection the photos + issues attach to. */
  inspectionId: string;
  /** Scope the damage-tariff catalogue to the booking's vehicle category. */
  categoryId?: string;
  /** Override the photo capture slots. */
  slots?: string[];
  /** Read-only rendering (customer review / completed inspection). */
  readOnly?: boolean;
  /** Who is adding issues — staff by default; customer at signing. */
  source?: "staff" | "customer";
  /** Show the camera capture grid. Off for customer review at signing. */
  allowCapture?: boolean;
  /** Offer the damage-tariff catalogue as labels. Off for customers (free text only). */
  allowTariff?: boolean;
  /** Which issues the current user may edit/remove. Customers only touch their own. */
  editableSource?: "all" | "customer";
  className?: string;
};

/**
 * Reconciled inspection capture: take slot-based photos, then pin labelled
 * issues **onto each photo**. Replaces the separate photo grid + silhouette
 * damage-map. A return-time issue can be turned into a pre-priced DamageCharge
 * on the assess screen.
 */
export function PhotoIssueCapture({
  inspectionId,
  categoryId,
  slots,
  readOnly,
  source = "staff",
  allowCapture = true,
  allowTariff = true,
  editableSource = "all",
  className,
}: PhotoIssueCaptureProps) {
  const utils = trpc.useUtils();
  const { data: inspection } = trpc.inspection.byId.useQuery({ id: inspectionId });
  const { data: tariffs } = trpc.damageTariff.list.useQuery({ categoryId, activeOnly: true });

  const invalidate = () => {
    void utils.inspection.byId.invalidate({ id: inspectionId });
    void utils.inspection.byBooking.invalidate();
  };

  const addIssue = trpc.inspection.addIssue.useMutation({ onSuccess: invalidate });
  const updateIssue = trpc.inspection.updateIssue.useMutation({ onSuccess: invalidate });
  const removeIssue = trpc.inspection.removeIssue.useMutation({ onSuccess: invalidate });

  const photos: Photo[] = inspection?.photos ?? [];
  const issues: Issue[] = (inspection?.issues ?? []) as Issue[];

  return (
    <div className={cn("space-y-5", className)}>
      {!readOnly && allowCapture && (
        <PhotoCaptureGrid
          uploadUrl="/api/upload/inspection-photo"
          extraFields={{ inspectionId }}
          slots={slots}
          initial={photos.map((p) => ({ id: p.id, url: p.url, caption: p.caption ?? undefined }))}
          onUploaded={invalidate}
        />
      )}

      {photos.length === 0 ? (
        <p className="caption">
          {readOnly ? "No photos were recorded." : "Capture the photos above, then tap a photo to pin any damage."}
        </p>
      ) : (
        <div className="space-y-5">
          {photos.map((photo) => (
            <PhotoIssueEditor
              key={photo.id}
              photo={photo}
              issues={issues.filter((i) => i.inspectionPhotoId === photo.id)}
              tariffs={tariffs ?? []}
              readOnly={!!readOnly}
              allowTariff={allowTariff}
              editableSource={editableSource}
              onAdd={(vals) =>
                addIssue.mutate({
                  inspectionId,
                  inspectionPhotoId: photo.id,
                  side: slotToSide(photo.caption),
                  source,
                  ...vals,
                })
              }
              onUpdate={(id, vals) => updateIssue.mutate({ id, ...vals })}
              onRemove={(id) => removeIssue.mutate({ id })}
            />
          ))}
        </div>
      )}
    </div>
  );
}

type EditorProps = {
  photo: Photo;
  issues: Issue[];
  tariffs: Tariff[];
  readOnly: boolean;
  allowTariff: boolean;
  editableSource: "all" | "customer";
  onAdd: (vals: NewIssue) => void;
  onUpdate: (
    id: string,
    vals: Partial<{ label: string; severity: Severity; damageTariffId: string | null; note: string | null }>,
  ) => void;
  onRemove: (id: string) => void;
};

function PhotoIssueEditor({
  photo,
  issues,
  tariffs,
  readOnly,
  allowTariff,
  editableSource,
  onAdd,
  onUpdate,
  onRemove,
}: EditorProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const [sev, setSev] = useState<Severity>("MINOR");
  const [paletteTariff, setPaletteTariff] = useState<string>("");
  const [paletteLabel, setPaletteLabel] = useState<string>("");
  const side = slotToSide(photo.caption);

  function handlePhotoClick(e: React.MouseEvent<HTMLDivElement>) {
    if (readOnly) return;
    const box = boxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const posX = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const posY = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    const tariff = tariffs.find((t) => t.id === paletteTariff);
    const label = tariff?.name || paletteLabel.trim() || (side ? SIDE_LABEL[side] : "Damage");
    onAdd({ posX, posY, label, severity: sev, damageTariffId: tariff?.id });
    setPaletteLabel("");
  }

  return (
    <div className="space-y-3 rounded-lg border border-input p-3">
      <div className="flex items-center justify-between">
        <div className="eyebrow">{photo.caption ?? "Photo"}</div>
        {!readOnly && <div className="caption">Tap the photo to pin an issue</div>}
      </div>

      <div
        ref={boxRef}
        onClick={handlePhotoClick}
        className={cn(
          "relative aspect-[4/3] w-full overflow-hidden rounded-md border border-input bg-muted",
          !readOnly && "cursor-crosshair",
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={photo.url} alt={photo.caption ?? "inspection photo"} className="h-full w-full object-cover" />
        {issues.map((iss, n) =>
          iss.posX != null && iss.posY != null ? (
            <span
              key={iss.id}
              className={cn(
                "pointer-events-none absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 text-[11px] font-bold text-white shadow",
                SEVERITY_PIN[iss.severity],
              )}
              style={{ left: `${iss.posX * 100}%`, top: `${iss.posY * 100}%` }}
            >
              {n + 1}
            </span>
          ) : null,
        )}
      </div>

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-2">
          {allowTariff && (
            <select
              className="h-9 rounded-md border border-input bg-background px-2 text-sm"
              value={paletteTariff}
              onChange={(e) => setPaletteTariff(e.target.value)}
              aria-label="Damage type for the next pin"
            >
              <option value="">Free text…</option>
              {tariffs.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          )}
          {!paletteTariff && (
            <Input
              className="h-9 w-44"
              placeholder="Label (e.g. Scratch)"
              value={paletteLabel}
              onChange={(e) => setPaletteLabel(e.target.value)}
            />
          )}
          <div className="flex gap-1">
            {SEVERITIES.map((s) => (
              <Button
                key={s}
                type="button"
                size="sm"
                variant={sev === s ? "default" : "secondary"}
                onClick={() => setSev(s)}
              >
                {title(s)}
              </Button>
            ))}
          </div>
        </div>
      )}

      {issues.length > 0 && (
        <ul className="space-y-2">
          {issues.map((iss, n) => {
            const editable = !readOnly && (editableSource === "all" || iss.source === "customer");
            return (
              <li
                key={iss.id}
                className="flex flex-wrap items-center gap-2 rounded-md border border-input/60 p-2 text-sm"
              >
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-foreground text-[10px] font-bold text-background">
                  {n + 1}
                </span>
                {!editable ? (
                  <span className="font-medium">{iss.label}</span>
                ) : (
                  <>
                    {allowTariff && (
                      <select
                        className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                        value={iss.damageTariffId ?? ""}
                        onChange={(e) => {
                          const t = tariffs.find((x) => x.id === e.target.value);
                          if (t) onUpdate(iss.id, { damageTariffId: t.id, label: t.name });
                          else onUpdate(iss.id, { damageTariffId: null });
                        }}
                        aria-label="Damage type"
                      >
                        <option value="">Free text</option>
                        {tariffs.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    )}
                    <Input
                      key={`lbl-${iss.id}-${iss.label}`}
                      defaultValue={iss.label}
                      className="h-8 w-40"
                      aria-label="Label"
                      onBlur={(e) => {
                        const v = e.target.value.trim();
                        if (v && v !== iss.label) onUpdate(iss.id, { label: v, damageTariffId: null });
                      }}
                    />
                  </>
                )}
                <div className="flex gap-1">
                  {SEVERITIES.map((s) => (
                    <Button
                      key={s}
                      type="button"
                      size="sm"
                      variant={iss.severity === s ? "default" : "secondary"}
                      disabled={!editable}
                      onClick={() => onUpdate(iss.id, { severity: s })}
                    >
                      {title(s)}
                    </Button>
                  ))}
                </div>
                {editable ? (
                  <Input
                    key={`note-${iss.id}`}
                    defaultValue={iss.note ?? ""}
                    placeholder="Note (optional)"
                    className="h-8 min-w-[8rem] flex-1"
                    aria-label="Note"
                    onBlur={(e) => {
                      const v = e.target.value;
                      if (v !== (iss.note ?? "")) onUpdate(iss.id, { note: v || null });
                    }}
                  />
                ) : iss.note ? (
                  <span className="caption">{iss.note}</span>
                ) : null}
                {editable && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => onRemove(iss.id)}>
                    Remove
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
