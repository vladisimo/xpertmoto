"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc/client";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatDate } from "@/lib/utils";
import { parseLicenceClasses } from "@/lib/licence-class";
import {
  ExternalLink,
  FileText,
  Loader2,
  Pencil,
  Plus,
  RotateCw,
  ScanLine,
  Trash2,
  Upload,
} from "lucide-react";

type DocType =
  | "PASSPORT"
  | "PASSPORT_STYLE_DL"
  | "LICENCE_FRONT"
  | "LICENCE_BACK"
  | "VISA"
  | "INTL_DRIVING_PERMIT"
  | "PROOF_OF_ADDRESS"
  | "OTHER";

const DOC_TYPES: Array<{ value: DocType; label: string }> = [
  { value: "LICENCE_FRONT", label: "Licence — front" },
  { value: "LICENCE_BACK", label: "Licence — back" },
  { value: "PASSPORT", label: "Passport" },
  { value: "PASSPORT_STYLE_DL", label: "Passport-style licence" },
  { value: "VISA", label: "Visa" },
  { value: "INTL_DRIVING_PERMIT", label: "Intl driving permit" },
  { value: "PROOF_OF_ADDRESS", label: "Proof of address" },
  { value: "OTHER", label: "Other" },
];

const TYPE_LABEL_MAP: Record<string, string> = Object.fromEntries(
  DOC_TYPES.map((t) => [t.value, t.label]),
);

type LicenceDetection = {
  kind: "licence";
  detectedAt: string;
  confidence: number;
  licenceNumber?: string;
  state?: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  expiryDate?: string;
  licenceClass?: string;
  conditions?: string;
  country?: string;
  addressLine1?: string;
  addressLine2?: string;
  suburb?: string;
  addressState?: string;
  postcode?: string;
  faceImageUrl: string | null;
};

type PassportDetection = {
  kind: "passport";
  detectedAt: string;
  confidence: number;
  passportNumber?: string;
  country?: string;
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string;
  expiryDate?: string;
  faceImageUrl: null;
};

type DetectionData = LicenceDetection | PassportDetection;

type DocRow = {
  id: string;
  source: "document" | "profile";
  profileSlot: string | null;
  type: string;
  label: string | null;
  url: string;
  expiryDate: Date | string | null;
  notes: string | null;
  createdAt: Date | string | null;
  detection: DetectionData | null;
};

const DETECTABLE_TYPES = new Set(["LICENCE_FRONT", "PASSPORT_STYLE_DL", "PASSPORT"]);

type FileKind = "image" | "pdf" | "other";

function guessKind(url: string): FileKind {
  const path = url.split("?")[0] ?? url;
  if (/\.(png|jpe?g|webp|gif|avif|heic)$/i.test(path)) return "image";
  if (/\.pdf$/i.test(path)) return "pdf";
  return "other";
}

function expiryBadge(raw: Date | string | null) {
  if (!raw) return null;
  const d = new Date(raw);
  const now = new Date();
  const diffDays = Math.floor((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return <StatusBadge status="EXPIRED" />;
  if (diffDays <= 30) return <StatusBadge status="EXPIRES_SOON" label={`Expires in ${diffDays}d`} />;
  return null;
}

export function CustomerTabDocuments({ customerId }: { customerId: string }) {
  const util = trpc.useUtils();
  const { data, isLoading } = trpc.staffCustomer.documents.useQuery({ customerId });

  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<DocRow | null>(null);
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [deleting, setDeleting] = React.useState<DocRow | null>(null);
  const [detectError, setDetectError] = React.useState<string | null>(null);
  const [lastApplied, setLastApplied] = React.useState<string[] | null>(null);

  const deleteDoc = trpc.staffCustomer.deleteDocument.useMutation();
  const clearSlot = trpc.staffCustomer.clearProfileImage.useMutation();
  const detect = trpc.staffCustomer.detectDocument.useMutation();
  const rotate = trpc.staffCustomer.rotateDocument.useMutation();

  const docs = (data as DocRow[] | undefined) ?? [];
  // Derive selection: if the id is missing (initial load or after delete),
  // fall back to the first row. Keeps selection in sync with data without
  // an effect round-trip.
  const selectedDoc: DocRow | null =
    docs.find((d) => d.id === selectedId) ?? docs[0] ?? null;

  function selectDoc(id: string) {
    setSelectedId(id);
    setDetectError(null);
    setLastApplied(null);
  }

  async function confirmDelete() {
    if (!deleting) return;
    try {
      if (deleting.source === "profile" && deleting.profileSlot) {
        await clearSlot.mutateAsync({
          customerId,
          slot: deleting.profileSlot as
            | "licenceImageFront"
            | "licenceImageBack"
            | "passportImage"
            | "signatureImage",
        });
      } else {
        await deleteDoc.mutateAsync({ documentId: deleting.id });
      }
      await util.staffCustomer.documents.invalidate({ customerId });
      setDeleting(null);
    } catch {
      // Dialog stays open; user can retry or cancel
    }
  }

  async function runDetect() {
    if (!selectedDoc) return;
    setDetectError(null);
    setLastApplied(null);
    try {
      const result = await detect.mutateAsync({ documentId: selectedDoc.id });
      await Promise.all([
        util.staffCustomer.documents.invalidate({ customerId }),
        util.staffCustomer.detail.invalidate({ id: customerId }),
      ]);
      if (result.appliedFields.length > 0) setLastApplied(result.appliedFields);
    } catch (e) {
      setDetectError(e instanceof Error ? e.message : "Detection failed");
    }
  }

  async function runRotate() {
    if (!selectedDoc || rotate.isPending) return;
    const target =
      selectedDoc.source === "profile" && selectedDoc.profileSlot
        ? {
            kind: "profile" as const,
            slot: selectedDoc.profileSlot as
              | "licenceImageFront"
              | "licenceImageBack"
              | "passportImage"
              | "signatureImage",
          }
        : { kind: "document" as const, documentId: selectedDoc.id };
    try {
      await rotate.mutateAsync({ customerId, target });
      await util.staffCustomer.documents.invalidate({ customerId });
    } catch {
      // Failure is rare (PDF guard runs server-side too).
    }
  }

  // Keyboard nav: arrow up/down through the list when any list row is focused.
  const listRef = React.useRef<HTMLDivElement | null>(null);
  function onListKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (docs.length === 0) return;
    const idx = docs.findIndex((d) => d.id === selectedDoc?.id);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = docs[Math.min(docs.length - 1, idx + 1)]!;
      selectDoc(next.id);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prev = docs[Math.max(0, idx - 1)]!;
      selectDoc(prev.id);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Documents</h2>
        <Button onClick={() => setUploadOpen(true)}>
          <Plus className="h-4 w-4" />
          Add document
        </Button>
      </div>

      {isLoading ? (
        <div className="py-8 text-center text-muted-foreground">Loading documents…</div>
      ) : docs.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            No documents on file.
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="flex h-[calc(100dvh-22rem)] min-h-[420px] flex-col lg:grid lg:grid-cols-[320px_1fr]">
            <div
              ref={listRef}
              onKeyDown={onListKeyDown}
              role="listbox"
              aria-label="Customer documents"
              tabIndex={0}
              className="max-h-[40vh] flex-shrink-0 overflow-y-auto border-b border-border lg:max-h-none lg:border-b-0 lg:border-r"
            >
              {docs.map((doc) => (
                <DocumentListRow
                  key={doc.id}
                  doc={doc}
                  selected={doc.id === selectedDoc?.id}
                  onSelect={() => selectDoc(doc.id)}
                />
              ))}
            </div>
            <DocumentViewerPane
              doc={selectedDoc}
              onEdit={
                selectedDoc && selectedDoc.source === "document"
                  ? () => setEditing(selectedDoc)
                  : null
              }
              onDelete={selectedDoc ? () => setDeleting(selectedDoc) : null}
              onRotate={runRotate}
              rotatePending={rotate.isPending}
              onDetect={runDetect}
              detectPending={detect.isPending}
              detectError={detectError}
              lastApplied={lastApplied}
            />
          </div>
        </Card>
      )}

      {editing && (
        <EditDialog
          doc={editing}
          customerId={customerId}
          onClose={() => setEditing(null)}
        />
      )}
      {uploadOpen && (
        <UploadDialog
          customerId={customerId}
          onClose={() => setUploadOpen(false)}
        />
      )}
      {deleting && (
        <Dialog open onOpenChange={(o) => !o && setDeleting(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Delete this document?</DialogTitle>
              <DialogDescription>
                {deleting.source === "profile"
                  ? "This will remove the image from the customer's profile. The stored file is not deleted."
                  : "This removes the record from the customer's file. The uploaded file is not deleted."}
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="secondary" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={confirmDelete}
                disabled={deleteDoc.isPending || clearSlot.isPending}
              >
                {deleteDoc.isPending || clearSlot.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function DocumentListRow({
  doc,
  selected,
  onSelect,
}: {
  doc: DocRow;
  selected: boolean;
  onSelect: () => void;
}) {
  const kind = guessKind(doc.url);
  const label = doc.label || TYPE_LABEL_MAP[doc.type] || doc.type;
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={[
        "flex w-full items-start gap-3 border-b border-border p-3 text-left transition-colors",
        selected
          ? "bg-primary/5 ring-1 ring-inset ring-primary"
          : "hover:bg-muted/50",
      ].join(" ")}
    >
      <div className="h-14 w-14 shrink-0 overflow-hidden rounded-md border border-border bg-muted/40">
        {kind === "image" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={doc.url}
            alt=""
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <FileText className="h-6 w-6" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1">
        <p className="truncate text-sm font-medium">{label}</p>
        <div className="flex flex-wrap items-center gap-1">
          <Badge variant="outline" className="font-mono text-[10px]">
            {doc.type.replace(/_/g, " ")}
          </Badge>
          {expiryBadge(doc.expiryDate)}
          {doc.source === "profile" && (
            <Badge variant="outline" className="text-[10px]">
              Profile
            </Badge>
          )}
          {doc.detection && <StatusBadge status="VERIFIED" label="Detected" />}
        </div>
        <p className="text-caption text-muted-foreground">
          {doc.expiryDate ? (
            <>Expires {formatDate(doc.expiryDate)}</>
          ) : doc.createdAt ? (
            <>Uploaded {formatDate(doc.createdAt)}</>
          ) : (
            <>On file</>
          )}
        </p>
      </div>
    </button>
  );
}

function DocumentViewerPane({
  doc,
  onEdit,
  onDelete,
  onRotate,
  rotatePending,
  onDetect,
  detectPending,
  detectError,
  lastApplied,
}: {
  doc: DocRow | null;
  onEdit: (() => void) | null;
  onDelete: (() => void) | null;
  onRotate: () => void;
  rotatePending: boolean;
  onDetect: () => void;
  detectPending: boolean;
  detectError: string | null;
  lastApplied: string[] | null;
}) {
  if (!doc) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
        Select a document from the list.
      </div>
    );
  }

  const kind = guessKind(doc.url);
  const label = doc.label || TYPE_LABEL_MAP[doc.type] || doc.type;
  const canDetect = doc.source === "document" && DETECTABLE_TYPES.has(doc.type);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 bg-muted/30">
        {kind === "image" ? (
          <div className="flex h-full w-full items-center justify-center overflow-auto p-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={doc.url}
              alt={label}
              className="max-h-full max-w-full object-contain"
            />
          </div>
        ) : kind === "pdf" ? (
          <iframe
            src={doc.url.includes("#") ? doc.url : `${doc.url}#view=FitH`}
            title={label}
            className="h-full w-full border-0"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center p-6">
            <a
              href={doc.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-3 text-primary hover:underline"
            >
              <FileText className="h-5 w-5" />
              Open file in new tab
            </a>
          </div>
        )}
      </div>

      {(doc.detection || detectError || (lastApplied && lastApplied.length > 0)) && (
        <div className="space-y-2 border-t border-border p-4">
          {doc.detection && <DetectionSummary detection={doc.detection} />}
          {lastApplied && lastApplied.length > 0 && (
            <p className="text-caption text-muted-foreground">
              Applied: {lastApplied.join(", ")}
            </p>
          )}
          {detectError && (
            <p className="text-caption text-destructive">{detectError}</p>
          )}
        </div>
      )}

      {canDetect && !doc.detection && !detectError && (
        <div className="border-t border-border bg-muted/30 p-4">
          <p className="text-caption text-muted-foreground">
            Read licence details with Claude vision. Face is cropped and empty
            profile fields are filled in when the licence is in-date.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3 border-t border-border p-4">
        <div className="min-w-0 space-y-1">
          <p className="truncate text-base font-semibold">{label}</p>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="font-mono text-xs">
              {doc.type.replace(/_/g, " ")}
            </Badge>
            {doc.expiryDate && (
              <span className="text-caption text-muted-foreground">
                Expires {formatDate(doc.expiryDate)}
              </span>
            )}
            {expiryBadge(doc.expiryDate)}
            {doc.source === "profile" && (
              <Badge variant="outline" className="text-xs">
                Profile slot
              </Badge>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {kind === "image" && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onRotate}
              disabled={rotatePending}
              aria-label="Rotate 90° clockwise"
            >
              {rotatePending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RotateCw className="h-4 w-4" />
              )}
              Rotate
            </Button>
          )}
          {canDetect && (
            <Button
              type="button"
              variant={doc.detection ? "secondary" : "default"}
              size="sm"
              onClick={onDetect}
              disabled={detectPending}
            >
              {detectPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ScanLine className="h-4 w-4" />
              )}
              {doc.detection ? "Re-run detect" : "Detect"}
            </Button>
          )}
          {onEdit && (
            <Button type="button" variant="secondary" size="sm" onClick={onEdit}>
              <Pencil className="h-4 w-4" />
              Edit
            </Button>
          )}
          {onDelete && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onDelete}
              className="text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          )}
          <Button type="button" variant="secondary" size="sm" asChild>
            <a href={doc.url} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" />
              New tab
            </a>
          </Button>
        </div>
      </div>
    </div>
  );
}

export function LicenceClassChips({ raw }: { raw: string | null | undefined }) {
  const tokens = parseLicenceClasses(raw);
  if (tokens.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {tokens.map((t) => (
        <span
          key={t.code}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2 py-0.5 text-caption"
        >
          <span className="font-mono font-medium">{t.code}</span>
          {t.label && <span className="text-muted-foreground">— {t.label}</span>}
        </span>
      ))}
    </div>
  );
}

function DetectionSummary({ detection }: { detection: DetectionData }) {
  if (detection.kind === "passport") {
    return <PassportDetectionSummary detection={detection} />;
  }
  return <LicenceDetectionSummary detection={detection} />;
}

function PassportDetectionSummary({ detection }: { detection: PassportDetection }) {
  const fullName = [detection.firstName, detection.lastName].filter(Boolean).join(" ");
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-caption">
      {fullName && (
        <>
          <dt className="text-muted-foreground">Name</dt>
          <dd className="font-medium">{fullName}</dd>
        </>
      )}
      {detection.passportNumber && (
        <>
          <dt className="text-muted-foreground">Passport #</dt>
          <dd className="font-mono">{detection.passportNumber}</dd>
        </>
      )}
      {detection.country && (
        <>
          <dt className="text-muted-foreground">Country</dt>
          <dd>{detection.country}</dd>
        </>
      )}
      {detection.expiryDate && (
        <>
          <dt className="text-muted-foreground">Expiry</dt>
          <dd>{formatDate(detection.expiryDate)}</dd>
        </>
      )}
      {detection.dateOfBirth && (
        <>
          <dt className="text-muted-foreground">DOB</dt>
          <dd>{formatDate(detection.dateOfBirth)}</dd>
        </>
      )}
      <dt className="text-muted-foreground">Confidence</dt>
      <dd>{(detection.confidence * 100).toFixed(0)}%</dd>
    </dl>
  );
}

function LicenceDetectionSummary({ detection }: { detection: LicenceDetection }) {
  const fullName = [detection.firstName, detection.lastName]
    .filter(Boolean)
    .join(" ");
  const addressLine1 = [detection.addressLine1, detection.addressLine2]
    .filter(Boolean)
    .join(", ");
  const addressLine2 = [
    detection.suburb,
    detection.addressState,
    detection.postcode,
  ]
    .filter(Boolean)
    .join(" ");
  const hasAddress = addressLine1 || addressLine2;
  return (
    <div className="flex gap-3">
      {detection.faceImageUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={detection.faceImageUrl}
          alt="Detected face"
          className="h-20 w-20 shrink-0 rounded border object-cover"
        />
      )}
      <dl className="grid flex-1 grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-caption">
        {fullName && (
          <>
            <dt className="text-muted-foreground">Name</dt>
            <dd className="font-medium">{fullName}</dd>
          </>
        )}
        {detection.licenceNumber && (
          <>
            <dt className="text-muted-foreground">Licence #</dt>
            <dd className="font-mono">{detection.licenceNumber}</dd>
          </>
        )}
        {detection.state && (
          <>
            <dt className="text-muted-foreground">State</dt>
            <dd>{detection.state}</dd>
          </>
        )}
        {detection.licenceClass && (
          <>
            <dt className="text-muted-foreground">Class</dt>
            <dd>
              <LicenceClassChips raw={detection.licenceClass} />
            </dd>
          </>
        )}
        {detection.conditions && (
          <>
            <dt className="text-muted-foreground">Conditions</dt>
            <dd>{detection.conditions}</dd>
          </>
        )}
        {detection.country && (
          <>
            <dt className="text-muted-foreground">Country</dt>
            <dd>{detection.country}</dd>
          </>
        )}
        {hasAddress && (
          <>
            <dt className="text-muted-foreground">Address</dt>
            <dd>
              {addressLine1 && <div>{addressLine1}</div>}
              {addressLine2 && <div>{addressLine2}</div>}
            </dd>
          </>
        )}
        {detection.expiryDate && (
          <>
            <dt className="text-muted-foreground">Expiry</dt>
            <dd>{formatDate(detection.expiryDate)}</dd>
          </>
        )}
        {detection.dateOfBirth && (
          <>
            <dt className="text-muted-foreground">DOB</dt>
            <dd>{formatDate(detection.dateOfBirth)}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Confidence</dt>
        <dd>{(detection.confidence * 100).toFixed(0)}%</dd>
      </dl>
    </div>
  );
}

function EditDialog({
  doc,
  customerId,
  onClose,
}: {
  doc: DocRow;
  customerId: string;
  onClose: () => void;
}) {
  const util = trpc.useUtils();
  const update = trpc.staffCustomer.updateDocument.useMutation();
  const [type, setType] = React.useState<DocType>(doc.type as DocType);
  const [label, setLabel] = React.useState(doc.label ?? "");
  const [expiry, setExpiry] = React.useState(formatDateForInput(doc.expiryDate));
  const [notes, setNotes] = React.useState(doc.notes ?? "");
  const [error, setError] = React.useState<string | null>(null);

  async function onSave() {
    setError(null);
    try {
      await update.mutateAsync({
        documentId: doc.id,
        type,
        label: label || null,
        expiryDate: expiry || null,
        notes: notes || null,
      });
      await util.staffCustomer.documents.invalidate({ customerId });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit document</DialogTitle>
          <DialogDescription>
            Update the document&apos;s metadata. To replace the file, delete
            this record and upload a new one.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as DocType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOC_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Label</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Optional label shown on the card"
            />
          </div>
          <div className="space-y-2">
            <Label>Expiry</Label>
            <Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal notes (staff-only)"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={onSave} disabled={update.isPending}>
            {update.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save changes
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UploadDialog({
  customerId,
  onClose,
}: {
  customerId: string;
  onClose: () => void;
}) {
  const util = trpc.useUtils();
  const add = trpc.staffCustomer.addDocument.useMutation();
  const [file, setFile] = React.useState<File | null>(null);
  const [type, setType] = React.useState<DocType>("LICENCE_FRONT");
  const [label, setLabel] = React.useState("");
  const [expiry, setExpiry] = React.useState("");
  const [notes, setNotes] = React.useState("");
  const [uploading, setUploading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function onSubmit() {
    if (!file) {
      setError("Pick a file first.");
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload/customer-document", {
        method: "POST",
        body: fd,
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? `Upload failed (${res.status})`);
      }
      const json = (await res.json()) as { url: string; key: string };
      await add.mutateAsync({
        customerId,
        type,
        fileUrl: json.url,
        label: label || null,
        expiryDate: expiry || null,
        notes: notes || null,
      });
      await util.staffCustomer.documents.invalidate({ customerId });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload document</DialogTitle>
          <DialogDescription>
            Images, PDFs up to 16&nbsp;MB. The file is attached to this
            customer&apos;s record.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>File</Label>
            <Input
              type="file"
              accept="image/*,application/pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            {file && (
              <p className="text-caption text-muted-foreground">
                {file.name} · {(file.size / 1024).toFixed(0)} KB
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Type</Label>
            <Select value={type} onValueChange={(v) => setType(v as DocType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DOC_TYPES.map((t) => (
                  <SelectItem key={t.value} value={t.value}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Label</Label>
            <Input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Optional label"
            />
          </div>
          <div className="space-y-2">
            <Label>Expiry</Label>
            <Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>Notes</Label>
            <Input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Internal notes (staff-only)"
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose} disabled={uploading}>
            Cancel
          </Button>
          <Button onClick={onSubmit} disabled={uploading || !file}>
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            Upload
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatDateForInput(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = d instanceof Date ? d : new Date(d);
  if (isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}
