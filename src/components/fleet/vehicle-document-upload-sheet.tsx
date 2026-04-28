"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useDropzone } from "react-dropzone";
import { UploadCloud, FileText, X, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormGrid, FormGridRow } from "@/components/forms/form-grid";
import { cn } from "@/lib/utils";

const DOC_TYPES = [
  { value: "CTP", label: "CTP" },
  { value: "REGO_CERT", label: "Registration certificate" },
  { value: "INSURANCE", label: "Insurance" },
  { value: "WARRANTY", label: "Warranty" },
  { value: "PURCHASE_RECEIPT", label: "Purchase receipt" },
  { value: "INFRINGEMENT", label: "Infringement notice" },
  { value: "REPAIR_BILL", label: "Repair bill" },
  { value: "PARTS_PURCHASE", label: "Parts purchase" },
  { value: "SERVICE_FEE", label: "Service invoice" },
  { value: "TYRE_REPLACEMENT", label: "Tyre replacement" },
  { value: "OTHER", label: "Other" },
] as const;

const INFRINGEMENT_TYPES = ["SPEEDING", "PARKING", "TOLL", "RED_LIGHT", "OTHER"] as const;
const EXPIRY_TYPES = new Set(["CTP", "REGO_CERT", "INSURANCE", "WARRANTY"]);
const COST_WO_TYPES = new Set(["REPAIR_BILL", "PARTS_PURCHASE", "SERVICE_FEE", "TYRE_REPLACEMENT"]);

// Looser schema than the server — we validate conditionally at submit so
// the form doesn't fight the user while they switch types. The server
// discriminated union is the real source of truth.
const schema = z.object({
  type: z.enum(DOC_TYPES.map((d) => d.value) as [string, ...string[]]),
  expiryDate: z.string().optional(),
  issueDate: z.string().optional(),
  cost: z.string().optional(),
  supplier: z.string().optional(),
  description: z.string().optional(),
  odometerAtService: z.string().optional(),
  referenceNumber: z.string().optional(),
  infringementType: z.enum(INFRINGEMENT_TYPES).optional(),
  issuer: z.string().optional(),
  offenceDate: z.string().optional(),
  amount: z.string().optional(),
  dueDate: z.string().optional(),
  notes: z.string().optional(),
});
type Values = z.infer<typeof schema>;

interface UploadedFile {
  url: string;
  key: string;
  name: string;
  size: number;
  thumbnailUrl: string | null;
}

function humanize(s: string) {
  return s.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}

export function VehicleDocumentUploadSheet({
  open,
  onOpenChange,
  vehicleId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vehicleId: string;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [uploaded, setUploaded] = useState<UploadedFile | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const create = trpc.fleet.addVehicleDocument.useMutation();

  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { type: "CTP" },
  });
  const type = form.watch("type");

  const uploadFile = useCallback(async (file: File) => {
    setUploading(true);
    setUploadError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload/vehicle-document", { method: "POST", body: fd });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Upload failed (${res.status})`);
      }
      const { url, key, thumbnailUrl } = (await res.json()) as {
        url: string;
        key: string;
        thumbnailUrl: string | null;
      };
      setUploaded({ url, key, name: file.name, size: file.size, thumbnailUrl });
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }, []);

  const onDrop = useCallback(
    (accepted: File[]) => {
      if (accepted[0]) void uploadFile(accepted[0]);
    },
    [uploadFile],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      "application/pdf": [".pdf"],
      "image/jpeg": [".jpg", ".jpeg"],
      "image/png": [".png"],
      "image/webp": [".webp"],
    },
    maxFiles: 1,
    maxSize: 16 * 1024 * 1024,
    disabled: uploading,
  });

  function reset() {
    form.reset({ type: "CTP" });
    setUploaded(null);
    setUploadError(null);
    create.reset();
  }

  async function onSubmit(values: Values) {
    if (!uploaded) {
      setUploadError("Please attach a file first.");
      return;
    }

    const base = {
      vehicleId,
      fileUrl: uploaded.url,
      thumbnailUrl: uploaded.thumbnailUrl ?? undefined,
      notes: values.notes || undefined,
      issueDate: values.issueDate ? new Date(values.issueDate) : undefined,
      referenceNumber: values.referenceNumber || undefined,
    };

    if (EXPIRY_TYPES.has(values.type)) {
      if (!values.expiryDate) {
        form.setError("expiryDate", { message: "Required" });
        return;
      }
      await create.mutateAsync({
        ...base,
        type: values.type as "CTP" | "REGO_CERT" | "INSURANCE" | "WARRANTY",
        expiryDate: new Date(values.expiryDate),
      });
    } else if (COST_WO_TYPES.has(values.type)) {
      const cost = values.cost ? Number(values.cost) : NaN;
      if (!Number.isFinite(cost) || cost <= 0) {
        form.setError("cost", { message: "Required" });
        return;
      }
      await create.mutateAsync({
        ...base,
        type: values.type as "REPAIR_BILL" | "PARTS_PURCHASE" | "SERVICE_FEE" | "TYRE_REPLACEMENT",
        cost,
        supplier: values.supplier || undefined,
        description: values.description || undefined,
        odometerAtService:
          values.type === "SERVICE_FEE" && values.odometerAtService
            ? Number(values.odometerAtService)
            : undefined,
      });
    } else if (values.type === "INFRINGEMENT") {
      if (!values.infringementType || !values.issuer || !values.referenceNumber || !values.offenceDate || !values.amount) {
        if (!values.infringementType) form.setError("infringementType", { message: "Required" });
        if (!values.issuer) form.setError("issuer", { message: "Required" });
        if (!values.referenceNumber) form.setError("referenceNumber", { message: "Required" });
        if (!values.offenceDate) form.setError("offenceDate", { message: "Required" });
        if (!values.amount) form.setError("amount", { message: "Required" });
        return;
      }
      await create.mutateAsync({
        vehicleId,
        fileUrl: uploaded.url,
        thumbnailUrl: uploaded.thumbnailUrl ?? undefined,
        type: "INFRINGEMENT",
        infringementType: values.infringementType,
        issuer: values.issuer,
        referenceNumber: values.referenceNumber,
        offenceDate: new Date(values.offenceDate),
        amount: Number(values.amount),
        dueDate: values.dueDate ? new Date(values.dueDate) : undefined,
        notes: values.notes || undefined,
      });
    } else if (values.type === "PURCHASE_RECEIPT") {
      await create.mutateAsync({
        ...base,
        type: "PURCHASE_RECEIPT",
        cost: values.cost ? Number(values.cost) : undefined,
      });
    } else {
      await create.mutateAsync({ ...base, type: "OTHER" });
    }

    await utils.fleet.vehicleDetail.invalidate({ id: vehicleId });
    reset();
    onOpenChange(false);
    router.refresh();
  }

  const isExpiry = EXPIRY_TYPES.has(type);
  const isCostWO = COST_WO_TYPES.has(type);
  const isInfringement = type === "INFRINGEMENT";
  const isPurchase = type === "PURCHASE_RECEIPT";

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        if (!v) reset();
        onOpenChange(v);
      }}
    >
      <SheetContent side="right" className="w-full sm:max-w-[600px] flex flex-col p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <SheetTitle className="text-xl">Upload document</SheetTitle>
          <SheetDescription>
            Attach a PDF or image (max 16&nbsp;MB). The document type drives what happens next —
            compliance docs bump the vehicle&apos;s expiry, repair/service docs create a work order,
            infringement docs create an infringement record.
          </SheetDescription>
        </SheetHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
              {/* Drop zone */}
              <div>
                <div
                  {...getRootProps()}
                  className={cn(
                    "flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors cursor-pointer",
                    isDragActive && "border-primary bg-primary/5",
                    !isDragActive && "border-border hover:bg-muted/40",
                    uploading && "cursor-not-allowed opacity-70",
                  )}
                >
                  <input {...getInputProps()} />
                  {uploading ? (
                    <>
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                      <p className="text-sm text-muted-foreground">Uploading…</p>
                    </>
                  ) : uploaded ? (
                    <>
                      <FileText className="h-8 w-8 text-primary" />
                      <p className="text-sm font-medium">{uploaded.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {(uploaded.size / 1024).toFixed(0)} KB · uploaded
                      </p>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          setUploaded(null);
                        }}
                      >
                        <X className="mr-1 h-3 w-3" /> Remove
                      </Button>
                    </>
                  ) : (
                    <>
                      <UploadCloud className="h-8 w-8 text-muted-foreground" />
                      <p className="text-sm">
                        <span className="font-medium text-primary">Click to upload</span> or drag and drop
                      </p>
                      <p className="text-xs text-muted-foreground">PDF, JPEG, PNG, WebP — up to 16&nbsp;MB</p>
                    </>
                  )}
                </div>
                {uploadError && (
                  <p className="mt-2 text-sm text-destructive">{uploadError}</p>
                )}
              </div>

              <FormGrid cols={2}>
                <FormField
                  control={form.control}
                  name="type"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>Document type</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {DOC_TYPES.map((t) => (
                            <SelectItem key={t.value} value={t.value}>
                              {t.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {isExpiry && (
                  <FormField
                    control={form.control}
                    name="expiryDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Expiry date</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                {(isExpiry || isPurchase) && (
                  <FormField
                    control={form.control}
                    name="issueDate"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Issue date</FormLabel>
                        <FormControl>
                          <Input type="date" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                {(isCostWO || isPurchase) && (
                  <FormField
                    control={form.control}
                    name="cost"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Cost (A$) {isPurchase && <span className="text-muted-foreground text-xs">(optional)</span>}</FormLabel>
                        <FormControl>
                          <Input type="number" step="0.01" min="0" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                {isCostWO && (
                  <>
                    <FormField
                      control={form.control}
                      name="supplier"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Supplier</FormLabel>
                          <FormControl>
                            <Input placeholder="Mick&apos;s Auto Repair" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    {type === "SERVICE_FEE" && (
                      <FormField
                        control={form.control}
                        name="odometerAtService"
                        render={({ field }) => (
                          <FormItem>
                            <FormLabel>Odometer (km)</FormLabel>
                            <FormControl>
                              <Input type="number" min="0" {...field} />
                            </FormControl>
                            <FormMessage />
                          </FormItem>
                        )}
                      />
                    )}
                    <FormField
                      control={form.control}
                      name="description"
                      render={({ field }) => (
                        <FormItem className="md:col-span-2">
                          <FormLabel>Description</FormLabel>
                          <FormControl>
                            <textarea
                              {...field}
                              rows={3}
                              className="min-h-20 w-full rounded-md border border-input bg-background p-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </>
                )}

                {isInfringement && (
                  <>
                    <FormField
                      control={form.control}
                      name="infringementType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Infringement type</FormLabel>
                          <Select onValueChange={field.onChange} value={field.value ?? ""}>
                            <FormControl>
                              <SelectTrigger>
                                <SelectValue placeholder="Select…" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent>
                              {INFRINGEMENT_TYPES.map((t) => (
                                <SelectItem key={t} value={t}>
                                  {humanize(t)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="issuer"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Issuer</FormLabel>
                          <FormControl>
                            <Input placeholder="Transport for NSW" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="referenceNumber"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Reference number</FormLabel>
                          <FormControl>
                            <Input placeholder="INF123456789" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="offenceDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Offence date</FormLabel>
                          <FormControl>
                            <Input type="date" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="amount"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Amount (A$)</FormLabel>
                          <FormControl>
                            <Input type="number" step="0.01" min="0" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="dueDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Due date</FormLabel>
                          <FormControl>
                            <Input type="date" {...field} />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                  </>
                )}

                {!isInfringement && (
                  <FormField
                    control={form.control}
                    name="referenceNumber"
                    render={({ field }) => (
                      <FormItem className={isCostWO || isPurchase ? "" : "md:col-span-2"}>
                        <FormLabel>Reference number {isInfringement ? "" : <span className="text-muted-foreground text-xs">(optional)</span>}</FormLabel>
                        <FormControl>
                          <Input placeholder="Policy / receipt / invoice #" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                )}

                <FormField
                  control={form.control}
                  name="notes"
                  render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>Notes</FormLabel>
                      <FormControl>
                        <textarea
                          {...field}
                          rows={2}
                          className="min-h-16 w-full rounded-md border border-input bg-background p-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />

                {create.error && (
                  <FormGridRow>
                    <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                      {create.error.message}
                    </div>
                  </FormGridRow>
                )}
              </FormGrid>
            </div>
            <div className="border-t px-6 py-4 shrink-0 flex gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => onOpenChange(false)}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={create.isPending || uploading || !uploaded}
                className="flex-1"
              >
                {create.isPending ? "Saving…" : "Save document"}
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
