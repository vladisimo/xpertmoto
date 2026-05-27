"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { trpc } from "@/lib/trpc/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { GripVertical, X, Upload, FileText, CheckCircle2 } from "lucide-react";

// ─── Types ───────────────────────────────────────────────────────────────────

type PhotoItem = { id: string; url: string; caption?: string };
type DocItem = {
  id: string;
  type: "REGO_CERT" | "INSURANCE" | "CTP" | "PURCHASE_RECEIPT" | "OTHER";
  fileUrl: string;
  fileName: string;
  expiryDate: string;
  notes: string;
};

const DOC_TYPE_LABELS: Record<DocItem["type"], string> = {
  REGO_CERT: "Rego certificate",
  INSURANCE: "Insurance",
  CTP: "CTP / Green slip",
  PURCHASE_RECEIPT: "Purchase receipt",
  OTHER: "Other",
};

const EMPTY_FORM = {
  internalCode: "",
  rego: "",
  regoState: "QLD",
  regoExpiry: "",
  vin: "",
  engineNumber: "",
  make: "",
  model: "",
  year: new Date().getFullYear(),
  colour: "",
  categoryId: "",
  depotId: "",
  currentOdometerKm: 0,
  fuelType: "Petrol",
  condition: "GOOD" as "EXCELLENT" | "GOOD" | "FAIR" | "POOR",
  notes: "",
  purchaseDate: "",
  purchasePrice: 0,
  depreciationMethod: "STRAIGHT_LINE" as "STRAIGHT_LINE" | "DIMINISHING_VALUE",
  depreciationRate: 15,
  insurancePolicyNumber: "",
  insuranceExpiry: "",
  ctpExpiry: "",
  warrantyExpiry: "",
  supplierName: "",
  supplierContact: "",
  financeType: "",
  financeProvider: "",
  financeRef: "",
  // Owner
  hasOwner: false,
  ownerMode: "existing" as "existing" | "new",
  ownerId: "",
  ownerType: "INDIVIDUAL" as "INDIVIDUAL" | "COMPANY",
  ownerFirstName: "",
  ownerLastName: "",
  ownerCompanyName: "",
  ownerAbn: "",
  ownerAcn: "",
  ownerEmail: "",
  ownerPhone: "",
  ownerAddressLine1: "",
  ownerAddressLine2: "",
  ownerSuburb: "",
  ownerState: "QLD",
  ownerPostcode: "",
  ownerArrangementType: "",
  ownerAgreementRef: "",
  ownerAgreementExpiry: "",
  ownerNotes: "",
};

// ─── Component ───────────────────────────────────────────────────────────────

export function VehicleOnboardSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const { data: depots } = trpc.depot.list.useQuery();
  const { data: categories } = trpc.vehicle.listCategories.useQuery();
  const { data: owners } = trpc.fleet.listVehicleOwners.useQuery();
  const createVehicle = trpc.fleet.createVehicle.useMutation();
  const createOwner = trpc.fleet.createVehicleOwner.useMutation();

  const [form, setForm] = useState({ ...EMPTY_FORM });
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [docUploading, setDocUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [created, setCreated] = useState<{ id: string; code: string } | null>(null);

  // Doc form state
  const [pendingDocType, setPendingDocType] = useState<DocItem["type"]>("INSURANCE");
  const [pendingDocExpiry, setPendingDocExpiry] = useState("");
  const [pendingDocNotes, setPendingDocNotes] = useState("");

  const photoRef = useRef<HTMLInputElement>(null);
  const docRef = useRef<HTMLInputElement>(null);

  function patch<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  function resetForm() {
    setForm({ ...EMPTY_FORM });
    setPhotos([]);
    setDocs([]);
    setErr(null);
    setCreated(null);
    setPendingDocType("INSURANCE");
    setPendingDocExpiry("");
    setPendingDocNotes("");
  }

  // ─── Photo upload ────────────────────────────────────────────────────────

  async function onPhotosPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    setErr(null);
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/upload/vehicle-image", { method: "POST", body: fd });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error ?? "Upload failed");
        }
        const { url } = (await res.json()) as { url: string };
        setPhotos((prev) => [...prev, { id: crypto.randomUUID(), url }]);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Photo upload failed");
    } finally {
      setUploading(false);
      if (photoRef.current) photoRef.current.value = "";
    }
  }

  function removePhoto(id: string) {
    setPhotos((prev) => prev.filter((p) => p.id !== id));
  }

  // ─── Document upload ─────────────────────────────────────────────────────

  async function onDocPicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setDocUploading(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/upload/vehicle-document", { method: "POST", body: fd });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Upload failed");
      }
      const { url } = (await res.json()) as { url: string };
      setDocs((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          type: pendingDocType,
          fileUrl: url,
          fileName: file.name,
          expiryDate: pendingDocExpiry,
          notes: pendingDocNotes,
        },
      ]);
      setPendingDocExpiry("");
      setPendingDocNotes("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Document upload failed");
    } finally {
      setDocUploading(false);
      if (docRef.current) docRef.current.value = "";
    }
  }

  function removeDoc(id: string) {
    setDocs((prev) => prev.filter((d) => d.id !== id));
  }

  // ─── DnD ─────────────────────────────────────────────────────────────────

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setPhotos((prev) => {
        const oldIdx = prev.findIndex((p) => p.id === active.id);
        const newIdx = prev.findIndex((p) => p.id === over.id);
        return arrayMove(prev, oldIdx, newIdx);
      });
    }
  }, []);

  // ─── Submit ──────────────────────────────────────────────────────────────

  function validate(): string | null {
    if (!form.internalCode.trim()) return "Internal code is required";
    if (!form.make.trim()) return "Make is required";
    if (!form.model.trim()) return "Model is required";
    if (!form.colour.trim()) return "Colour is required";
    if (!form.categoryId) return "Category is required";
    if (!form.depotId) return "Home depot is required";
    if (!form.rego.trim()) return "Rego is required";
    return null;
  }

  async function submit() {
    const validationErr = validate();
    if (validationErr) {
      setErr(validationErr);
      return;
    }
    setErr(null);
    try {
      let ownerId = form.ownerId || undefined;

      if (form.hasOwner && form.ownerMode === "new") {
        const owner = await createOwner.mutateAsync({
          ownerType: form.ownerType,
          firstName: form.ownerFirstName || undefined,
          lastName: form.ownerLastName || undefined,
          companyName: form.ownerCompanyName || undefined,
          abn: form.ownerAbn || undefined,
          acn: form.ownerAcn || undefined,
          email: form.ownerEmail || undefined,
          phone: form.ownerPhone || undefined,
          addressLine1: form.ownerAddressLine1 || undefined,
          addressLine2: form.ownerAddressLine2 || undefined,
          suburb: form.ownerSuburb || undefined,
          state: form.ownerState || undefined,
          postcode: form.ownerPostcode || undefined,
          arrangementType: form.ownerArrangementType || undefined,
          agreementRef: form.ownerAgreementRef || undefined,
          agreementExpiry: form.ownerAgreementExpiry ? new Date(form.ownerAgreementExpiry) : undefined,
          notes: form.ownerNotes || undefined,
        });
        ownerId = owner.id;
      }

      const vehicle = await createVehicle.mutateAsync({
        internalCode: form.internalCode,
        rego: form.rego,
        regoState: form.regoState,
        regoExpiry: form.regoExpiry ? new Date(form.regoExpiry) : undefined,
        vin: form.vin || undefined,
        engineNumber: form.engineNumber || undefined,
        make: form.make,
        model: form.model,
        year: Number(form.year),
        colour: form.colour,
        categoryId: form.categoryId,
        depotId: form.depotId,
        currentOdometerKm: Number(form.currentOdometerKm),
        fuelType: form.fuelType || undefined,
        condition: form.condition,
        notes: form.notes || undefined,
        purchaseDate: form.purchaseDate ? new Date(form.purchaseDate) : undefined,
        purchasePrice: form.purchasePrice ? Number(form.purchasePrice) : undefined,
        depreciationMethod: form.depreciationMethod,
        depreciationRate: Number(form.depreciationRate),
        insurancePolicyNumber: form.insurancePolicyNumber || undefined,
        insuranceExpiry: form.insuranceExpiry ? new Date(form.insuranceExpiry) : undefined,
        ctpExpiry: form.ctpExpiry ? new Date(form.ctpExpiry) : undefined,
        warrantyExpiry: form.warrantyExpiry ? new Date(form.warrantyExpiry) : undefined,
        supplierName: form.supplierName || undefined,
        supplierContact: form.supplierContact || undefined,
        financeType: form.financeType || undefined,
        financeProvider: form.financeProvider || undefined,
        financeRef: form.financeRef || undefined,
        ownerId: ownerId,
        images: photos.map((p) => ({ url: p.url, caption: p.caption })),
        documents: docs.map((d) => ({
          type: d.type,
          fileUrl: d.fileUrl,
          expiryDate: d.expiryDate ? new Date(d.expiryDate) : undefined,
          notes: d.notes || undefined,
        })),
      });

      utils.fleet.listVehicles.invalidate();
      utils.fleet.listVehicleOwners.invalidate();
      setCreated({ id: vehicle.id, code: form.internalCode });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to create vehicle");
    }
  }

  const isPending = createVehicle.isPending || createOwner.isPending;

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) resetForm(); onOpenChange(v); }}>
      <SheetContent side="right" className="w-full sm:max-w-[720px] flex flex-col p-0">
        <SheetHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <SheetTitle className="text-xl">Onboard new vehicle</SheetTitle>
          <SheetDescription>Add a vehicle to the fleet with photos, documents, and owner details.</SheetDescription>
        </SheetHeader>

        {created ? (
          <SuccessState
            code={created.code}
            onView={() => { onOpenChange(false); router.push(`/staff/fleet/vehicles/${created.id}`); }}
            onAnother={resetForm}
          />
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <Tabs defaultValue="vehicle" className="w-full">
                <TabsList className="w-full">
                  <TabsTrigger value="vehicle">Vehicle</TabsTrigger>
                  <TabsTrigger value="rego">Rego & Insurance</TabsTrigger>
                  <TabsTrigger value="financial">Financial</TabsTrigger>
                  <TabsTrigger value="owner">Owner</TabsTrigger>
                  <TabsTrigger value="media">Photos & Docs</TabsTrigger>
                </TabsList>

                {/* ─── Tab: Vehicle ──────────────────────────────────── */}
                <TabsContent value="vehicle">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <Label>Internal code *</Label>
                      <Input value={form.internalCode} onChange={(e) => patch("internalCode", e.target.value)} placeholder="SCT-029" />
                    </div>
                    <div>
                      <Label>Category *</Label>
                      <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.categoryId} onChange={(e) => patch("categoryId", e.target.value)}>
                        <option value="">Select category</option>
                        {categories?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <Label>Make *</Label>
                      <Input value={form.make} onChange={(e) => patch("make", e.target.value)} placeholder="Honda" />
                    </div>
                    <div>
                      <Label>Model *</Label>
                      <Input value={form.model} onChange={(e) => patch("model", e.target.value)} placeholder="PCX 125" />
                    </div>
                    <div>
                      <Label>Year *</Label>
                      <Input type="number" value={form.year} onChange={(e) => patch("year", Number(e.target.value))} />
                    </div>
                    <div>
                      <Label>Colour *</Label>
                      <Input value={form.colour} onChange={(e) => patch("colour", e.target.value)} placeholder="Pearl White" />
                    </div>
                    <div>
                      <Label>Home depot *</Label>
                      <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.depotId} onChange={(e) => patch("depotId", e.target.value)}>
                        <option value="">Select depot</option>
                        {depots?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <Label>Odometer (km)</Label>
                      <Input type="number" value={form.currentOdometerKm} onChange={(e) => patch("currentOdometerKm", Number(e.target.value))} />
                    </div>
                    <div>
                      <Label>VIN</Label>
                      <Input value={form.vin} onChange={(e) => patch("vin", e.target.value)} />
                    </div>
                    <div>
                      <Label>Engine number</Label>
                      <Input value={form.engineNumber} onChange={(e) => patch("engineNumber", e.target.value)} />
                    </div>
                    <div>
                      <Label>Fuel type</Label>
                      <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.fuelType} onChange={(e) => patch("fuelType", e.target.value)}>
                        <option>Petrol</option>
                        <option>Electric</option>
                        <option>Hybrid</option>
                      </select>
                    </div>
                    <div>
                      <Label>Condition on arrival</Label>
                      <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.condition} onChange={(e) => patch("condition", e.target.value as typeof form.condition)}>
                        <option value="EXCELLENT">Excellent</option>
                        <option value="GOOD">Good</option>
                        <option value="FAIR">Fair</option>
                        <option value="POOR">Poor</option>
                      </select>
                    </div>
                    <div className="col-span-2">
                      <Label>Notes</Label>
                      <textarea
                        className="w-full rounded-md border bg-background px-3 py-2 text-sm min-h-[60px] resize-y"
                        value={form.notes}
                        onChange={(e) => patch("notes", e.target.value)}
                        placeholder="Any notes about this vehicle…"
                      />
                    </div>
                  </div>
                </TabsContent>

                {/* ─── Tab: Rego & Insurance ─────────────────────────── */}
                <TabsContent value="rego">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <Label>Rego *</Label>
                      <Input value={form.rego} onChange={(e) => patch("rego", e.target.value)} placeholder="123-AB4" />
                    </div>
                    <div>
                      <Label>State *</Label>
                      <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.regoState} onChange={(e) => patch("regoState", e.target.value)}>
                        {["QLD", "NSW", "VIC", "TAS", "SA", "WA", "NT", "ACT"].map((s) => <option key={s}>{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <Label>Rego expiry</Label>
                      <Input type="date" value={form.regoExpiry} onChange={(e) => patch("regoExpiry", e.target.value)} />
                    </div>
                    <div>
                      <Label>CTP / Green slip expiry</Label>
                      <Input type="date" value={form.ctpExpiry} onChange={(e) => patch("ctpExpiry", e.target.value)} />
                    </div>
                    <div>
                      <Label>Insurance policy #</Label>
                      <Input value={form.insurancePolicyNumber} onChange={(e) => patch("insurancePolicyNumber", e.target.value)} />
                    </div>
                    <div>
                      <Label>Insurance expiry</Label>
                      <Input type="date" value={form.insuranceExpiry} onChange={(e) => patch("insuranceExpiry", e.target.value)} />
                    </div>
                    <div>
                      <Label>Warranty expiry</Label>
                      <Input type="date" value={form.warrantyExpiry} onChange={(e) => patch("warrantyExpiry", e.target.value)} />
                    </div>
                  </div>
                </TabsContent>

                {/* ─── Tab: Financial ────────────────────────────────── */}
                <TabsContent value="financial">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <Label>Purchase date</Label>
                      <Input type="date" value={form.purchaseDate} onChange={(e) => patch("purchaseDate", e.target.value)} />
                    </div>
                    <div>
                      <Label>Purchase price (A$)</Label>
                      <Input type="number" value={form.purchasePrice} onChange={(e) => patch("purchasePrice", Number(e.target.value))} />
                    </div>
                    <div>
                      <Label>Depreciation method</Label>
                      <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.depreciationMethod} onChange={(e) => patch("depreciationMethod", e.target.value as typeof form.depreciationMethod)}>
                        <option value="STRAIGHT_LINE">Straight-line</option>
                        <option value="DIMINISHING_VALUE">Diminishing value</option>
                      </select>
                    </div>
                    <div>
                      <Label>Depreciation rate (% / year)</Label>
                      <Input type="number" value={form.depreciationRate} onChange={(e) => patch("depreciationRate", Number(e.target.value))} />
                    </div>
                    <div>
                      <Label>Finance type</Label>
                      <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.financeType} onChange={(e) => patch("financeType", e.target.value)}>
                        <option value="">None / Cash</option>
                        <option value="LOAN">Loan</option>
                        <option value="LEASE">Lease</option>
                        <option value="CHATTEL_MORTGAGE">Chattel mortgage</option>
                      </select>
                    </div>
                    <div>
                      <Label>Finance provider</Label>
                      <Input value={form.financeProvider} onChange={(e) => patch("financeProvider", e.target.value)} placeholder="e.g. Macquarie Leasing" />
                    </div>
                    <div>
                      <Label>Finance reference</Label>
                      <Input value={form.financeRef} onChange={(e) => patch("financeRef", e.target.value)} />
                    </div>
                    <div className="col-span-2 border-t pt-3 mt-2">
                      <p className="text-xs text-muted-foreground font-medium mb-2">Supplier / Dealer</p>
                    </div>
                    <div>
                      <Label>Supplier name</Label>
                      <Input value={form.supplierName} onChange={(e) => patch("supplierName", e.target.value)} placeholder="e.g. Teamwork Honda" />
                    </div>
                    <div>
                      <Label>Supplier contact</Label>
                      <Input value={form.supplierContact} onChange={(e) => patch("supplierContact", e.target.value)} placeholder="Phone or email" />
                    </div>
                  </div>
                </TabsContent>

                {/* ─── Tab: Owner ────────────────────────────────────── */}
                <TabsContent value="owner">
                  <div className="space-y-4">
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={form.hasOwner}
                        onChange={(e) => patch("hasOwner", e.target.checked)}
                        className="rounded"
                      />
                      This vehicle has a nominated owner
                    </label>

                    {form.hasOwner && (
                      <div className="space-y-4">
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant={form.ownerMode === "existing" ? "default" : "outline"}
                            onClick={() => patch("ownerMode", "existing")}
                          >
                            Select existing
                          </Button>
                          <Button
                            size="sm"
                            variant={form.ownerMode === "new" ? "default" : "outline"}
                            onClick={() => patch("ownerMode", "new")}
                          >
                            Add new owner
                          </Button>
                        </div>

                        {form.ownerMode === "existing" ? (
                          <div>
                            <Label>Owner</Label>
                            <select
                              className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                              value={form.ownerId}
                              onChange={(e) => patch("ownerId", e.target.value)}
                            >
                              <option value="">Select an owner</option>
                              {owners?.map((o) => (
                                <option key={o.id} value={o.id}>
                                  {o.ownerType === "COMPANY"
                                    ? `${o.companyName ?? "—"}${o.abn ? ` (ABN: ${o.abn})` : ""}`
                                    : `${o.firstName ?? ""} ${o.lastName ?? ""}`.trim() || "—"}
                                  {` · ${o._count.vehicles} vehicle${o._count.vehicles !== 1 ? "s" : ""}`}
                                </option>
                              ))}
                            </select>
                          </div>
                        ) : (
                          <div className="space-y-3">
                            <div>
                              <Label>Owner type</Label>
                              <div className="flex gap-3 mt-1">
                                <label className="flex items-center gap-1.5 text-sm">
                                  <input type="radio" name="ownerType" checked={form.ownerType === "INDIVIDUAL"} onChange={() => patch("ownerType", "INDIVIDUAL")} />
                                  Individual
                                </label>
                                <label className="flex items-center gap-1.5 text-sm">
                                  <input type="radio" name="ownerType" checked={form.ownerType === "COMPANY"} onChange={() => patch("ownerType", "COMPANY")} />
                                  Company
                                </label>
                              </div>
                            </div>

                            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                              {form.ownerType === "INDIVIDUAL" ? (
                                <>
                                  <div><Label>First name</Label><Input value={form.ownerFirstName} onChange={(e) => patch("ownerFirstName", e.target.value)} /></div>
                                  <div><Label>Last name</Label><Input value={form.ownerLastName} onChange={(e) => patch("ownerLastName", e.target.value)} /></div>
                                </>
                              ) : (
                                <>
                                  <div className="col-span-2"><Label>Company name</Label><Input value={form.ownerCompanyName} onChange={(e) => patch("ownerCompanyName", e.target.value)} /></div>
                                  <div><Label>ABN</Label><Input value={form.ownerAbn} onChange={(e) => patch("ownerAbn", e.target.value)} placeholder="11 digit ABN" /></div>
                                  <div><Label>ACN</Label><Input value={form.ownerAcn} onChange={(e) => patch("ownerAcn", e.target.value)} placeholder="9 digit ACN" /></div>
                                </>
                              )}
                              <div><Label>Email</Label><Input type="email" value={form.ownerEmail} onChange={(e) => patch("ownerEmail", e.target.value)} /></div>
                              <div><Label>Phone</Label><Input value={form.ownerPhone} onChange={(e) => patch("ownerPhone", e.target.value)} /></div>
                              <div className="col-span-2"><Label>Address</Label><Input value={form.ownerAddressLine1} onChange={(e) => patch("ownerAddressLine1", e.target.value)} placeholder="Street address" /></div>
                              <div className="col-span-2"><Input value={form.ownerAddressLine2} onChange={(e) => patch("ownerAddressLine2", e.target.value)} placeholder="Unit, suite, etc. (optional)" /></div>
                              <div><Label>Suburb</Label><Input value={form.ownerSuburb} onChange={(e) => patch("ownerSuburb", e.target.value)} /></div>
                              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                <div>
                                  <Label>State</Label>
                                  <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.ownerState} onChange={(e) => patch("ownerState", e.target.value)}>
                                    {["QLD", "NSW", "VIC", "TAS", "SA", "WA", "NT", "ACT"].map((s) => <option key={s}>{s}</option>)}
                                  </select>
                                </div>
                                <div><Label>Postcode</Label><Input value={form.ownerPostcode} onChange={(e) => patch("ownerPostcode", e.target.value)} /></div>
                              </div>
                            </div>

                            <div className="border-t pt-3 mt-2">
                              <p className="text-xs text-muted-foreground font-medium mb-2">Arrangement</p>
                              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                                <div>
                                  <Label>Arrangement type</Label>
                                  <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.ownerArrangementType} onChange={(e) => patch("ownerArrangementType", e.target.value)}>
                                    <option value="">Not specified</option>
                                    <option value="OWNED">Owned</option>
                                    <option value="LEASED">Leased</option>
                                    <option value="FINANCED">Financed</option>
                                    <option value="CONSIGNMENT">Consignment</option>
                                  </select>
                                </div>
                                <div><Label>Agreement reference</Label><Input value={form.ownerAgreementRef} onChange={(e) => patch("ownerAgreementRef", e.target.value)} /></div>
                                <div><Label>Agreement expiry</Label><Input type="date" value={form.ownerAgreementExpiry} onChange={(e) => patch("ownerAgreementExpiry", e.target.value)} /></div>
                              </div>
                            </div>

                            <div>
                              <Label>Owner notes</Label>
                              <textarea
                                className="w-full rounded-md border bg-background px-3 py-2 text-sm min-h-[60px] resize-y"
                                value={form.ownerNotes}
                                onChange={(e) => patch("ownerNotes", e.target.value)}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </TabsContent>

                {/* ─── Tab: Photos & Documents ───────────────────────── */}
                <TabsContent value="media">
                  <div className="space-y-6">
                    {/* Photos */}
                    <section>
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <h3 className="text-sm font-semibold">Photos</h3>
                          <p className="text-xs text-muted-foreground">First photo becomes the primary image shown on the website. Drag to reorder.</p>
                        </div>
                        <div>
                          <input
                            ref={photoRef}
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/gif"
                            multiple
                            className="hidden"
                            onChange={onPhotosPicked}
                          />
                          <Button size="sm" variant="outline" onClick={() => photoRef.current?.click()} disabled={uploading}>
                            <Upload className="h-3.5 w-3.5 mr-1.5" />
                            {uploading ? "Uploading…" : "Add photos"}
                          </Button>
                        </div>
                      </div>

                      {photos.length > 0 ? (
                        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                          <SortableContext items={photos.map((p) => p.id)} strategy={rectSortingStrategy}>
                            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                              {photos.map((photo, i) => (
                                <SortablePhoto key={photo.id} photo={photo} index={i} onRemove={removePhoto} />
                              ))}
                            </div>
                          </SortableContext>
                        </DndContext>
                      ) : (
                        <div className="border border-dashed rounded-md p-6 text-center text-sm text-muted-foreground">
                          No photos yet. Upload images so customers can see this vehicle.
                        </div>
                      )}
                    </section>

                    {/* Documents */}
                    <section>
                      <h3 className="text-sm font-semibold mb-3">Documents</h3>
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 mb-3">
                        <div>
                          <Label>Document type</Label>
                          <select className="h-10 w-full rounded-md border bg-background px-3 text-sm" value={pendingDocType} onChange={(e) => setPendingDocType(e.target.value as DocItem["type"])}>
                            {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                          </select>
                        </div>
                        <div>
                          <Label>Expiry date</Label>
                          <Input type="date" value={pendingDocExpiry} onChange={(e) => setPendingDocExpiry(e.target.value)} />
                        </div>
                        <div className="col-span-2">
                          <Label>Notes</Label>
                          <Input value={pendingDocNotes} onChange={(e) => setPendingDocNotes(e.target.value)} placeholder="Optional notes" />
                        </div>
                      </div>
                      <div>
                        <input
                          ref={docRef}
                          type="file"
                          accept="application/pdf,image/jpeg,image/png,image/webp"
                          className="hidden"
                          onChange={onDocPicked}
                        />
                        <Button size="sm" variant="outline" onClick={() => docRef.current?.click()} disabled={docUploading}>
                          <FileText className="h-3.5 w-3.5 mr-1.5" />
                          {docUploading ? "Uploading…" : "Upload document"}
                        </Button>
                      </div>

                      {docs.length > 0 && (
                        <div className="mt-3 space-y-2">
                          {docs.map((doc) => (
                            <div key={doc.id} className="flex items-center justify-between p-2 border rounded text-sm">
                              <div className="flex items-center gap-2 min-w-0">
                                <Badge variant="secondary" className="text-xs shrink-0">{DOC_TYPE_LABELS[doc.type]}</Badge>
                                <span className="truncate">{doc.fileName}</span>
                                {doc.expiryDate && <span className="text-xs text-muted-foreground shrink-0">exp {doc.expiryDate}</span>}
                              </div>
                              <button onClick={() => removeDoc(doc.id)} className="text-destructive hover:text-destructive/80 ml-2 shrink-0">
                                <X className="h-4 w-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}
                    </section>
                  </div>
                </TabsContent>
              </Tabs>
            </div>

            {/* Footer */}
            <div className="border-t px-6 py-4 shrink-0">
              {err && <div className="text-sm text-destructive mb-3">{err}</div>}
              <Button onClick={submit} disabled={isPending} className="w-full">
                {isPending ? "Creating…" : "Create vehicle"}
              </Button>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

// ─── Sortable Photo ──────────────────────────────────────────────────────────

function SortablePhoto({
  photo,
  index,
  onRemove,
}: {
  photo: PhotoItem;
  index: number;
  onRemove: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: photo.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="relative group border rounded overflow-hidden">
      <div className="relative aspect-video bg-muted">
        <Image src={photo.url} alt={photo.caption ?? "Vehicle photo"} fill className="object-contain" sizes="200px" />
      </div>
      {index === 0 && (
        <span className="absolute top-1 left-1 bg-primary text-primary-foreground text-xs px-2 py-0.5 rounded">Primary</span>
      )}
      <div className="absolute top-1 right-1 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
        <button
          {...attributes}
          {...listeners}
          className="bg-background/80 backdrop-blur rounded p-1 cursor-grab active:cursor-grabbing"
        >
          <GripVertical className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={() => onRemove(photo.id)}
          className="bg-background/80 backdrop-blur rounded p-1 text-destructive hover:text-destructive/80"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

// ─── Success State ───────────────────────────────────────────────────────────

function SuccessState({
  code,
  onView,
  onAnother,
}: {
  code: string;
  onView: () => void;
  onAnother: () => void;
}) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8">
      <CheckCircle2 className="h-16 w-16 text-primary" />
      <h2 className="text-xl font-semibold">Vehicle created</h2>
      <p className="text-muted-foreground text-sm">{code} has been onboarded and is now available.</p>
      <div className="flex gap-3 mt-2">
        <Button onClick={onView}>View vehicle</Button>
        <Button variant="outline" onClick={onAnother}>Onboard another</Button>
      </div>
    </div>
  );
}
