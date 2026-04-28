"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Plus } from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { trpc } from "@/lib/trpc/client";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { StatusBadge } from "@/components/ui/status-badge";
import { DataTable, type DataTableColumn } from "@/components/ui/data-table";
import { DepotEditSheet } from "@/components/admin/depot-edit-sheet";
import { FormGrid } from "@/components/forms/form-grid";
import { PageHeader } from "@/components/layout/page-header";
import { PageSection, PageShell } from "@/components/layout/page-section";
import type { DepotPin } from "@/components/maps/admin-depot-map";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@/server/trpc/router";

type DepotRow = inferRouterOutputs<AppRouter>["admin"]["listDepots"][number];

const AdminDepotMap = dynamic(
  () => import("@/components/maps/admin-depot-map"),
  { ssr: false, loading: () => <div className="h-full w-full animate-pulse bg-muted" /> },
);

const AU_STATES = ["QLD", "NSW", "VIC", "TAS", "SA", "WA", "NT", "ACT"] as const;

const AU_TIMEZONES = [
  "Australia/Brisbane",
  "Australia/Sydney",
  "Australia/Melbourne",
  "Australia/Hobart",
  "Australia/Adelaide",
  "Australia/Perth",
  "Australia/Darwin",
  "Australia/Lord_Howe",
] as const;

const depotSchema = z.object({
  name: z.string().min(1, "Required"),
  addressLine1: z.string().min(1, "Required"),
  suburb: z.string().min(1, "Required"),
  state: z.enum(AU_STATES),
  postcode: z.string().min(3, "Required"),
  phone: z.string().optional(),
  email: z.union([z.literal(""), z.string().email("Must be a valid email")]).optional(),
  timezone: z.string().default("Australia/Brisbane"),
});

type DepotFormValues = z.infer<typeof depotSchema>;

export default function AdminDepotsPage() {
  const util = trpc.useUtils();
  const { data: depots } = trpc.admin.listDepots.useQuery();

  const form = useForm<DepotFormValues>({
    resolver: zodResolver(depotSchema),
    defaultValues: {
      name: "",
      addressLine1: "",
      suburb: "",
      state: "QLD",
      postcode: "",
      phone: "",
      email: "",
      timezone: "Australia/Brisbane",
    },
  });

  const create = trpc.admin.createDepot.useMutation({
    onSuccess: () => {
      util.admin.listDepots.invalidate();
      setShowCreate(false);
      form.reset();
    },
  });

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const selectedDepot = depots?.find((d) => d.id === selectedId) ?? null;

  const pins: DepotPin[] = (depots ?? [])
    .filter((d) => d.latitude != null && d.longitude != null)
    .map((d) => ({
      id: d.id,
      name: d.name,
      lat: d.latitude!,
      lng: d.longitude!,
      isActive: d.isActive,
      suburb: d.suburb,
      state: d.state,
      vehicleCount: d._count.vehicles,
    }));

  function submitCreate(values: DepotFormValues) {
    create.mutate({
      ...values,
      slug: values.name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
      phone: values.phone || undefined,
      email: values.email || undefined,
    });
  }

  const columns: DataTableColumn<DepotRow>[] = [
    {
      id: "name",
      header: "Depot",
      sortable: true,
      primary: true,
      accessor: (d) => d.name,
      cell: (d) => (
        <div className="space-y-0.5">
          <div className="font-medium text-foreground">{d.name}</div>
          <div className="text-xs text-muted-foreground">{d.timezone.replace("Australia/", "").replace("_", " ")}</div>
        </div>
      ),
    },
    {
      id: "address",
      header: "Address",
      secondary: true,
      cell: (d) => (
        <div className="space-y-0.5 text-sm">
          <div className="text-foreground">{d.addressLine1}</div>
          <div className="text-xs text-muted-foreground">
            {d.suburb}, {d.state} {d.postcode}
          </div>
        </div>
      ),
    },
    {
      id: "contact",
      header: "Contact",
      cell: (d) => (
        <div className="space-y-0.5 text-sm">
          {d.phone ? (
            <div className="text-foreground">{d.phone}</div>
          ) : (
            <div className="text-muted-foreground">—</div>
          )}
          {d.email && <div className="text-xs text-muted-foreground">{d.email}</div>}
        </div>
      ),
    },
    {
      id: "vehicles",
      header: "Vehicles",
      align: "right",
      sortable: true,
      accessor: (d) => d._count.vehicles,
      cell: (d) => (
        <span className="tabular-nums text-foreground">{d._count.vehicles}</span>
      ),
    },
    {
      id: "status",
      header: "Status",
      sortable: true,
      accessor: (d) => (d.isActive ? 1 : 0),
      cell: (d) => (
        <StatusBadge
          status={d.isActive ? "AVAILABLE" : "CLOSED"}
          label={d.isActive ? "Active" : "Inactive"}
        />
      ),
    },
  ];

  return (
    <PageShell>
      <PageHeader
        eyebrow="Administration"
        title="Depots"
        description="Manage depot locations, contact details, and operating hours."
        actions={
          <Button onClick={() => setShowCreate(true)}>
            <Plus className="h-4 w-4" />
            New depot
          </Button>
        }
      />

      <PageSection
        title="Locations"
        description="Click a pin or a row to edit depot details."
        flush
      >
        <div className="relative isolate h-[320px] overflow-hidden rounded-lg border bg-card shadow-sm sm:h-[480px] lg:h-[720px]">
          <AdminDepotMap
            depots={pins}
            selectedDepotId={selectedId}
            onSelectDepot={(id) => setSelectedId(id)}
          />
        </div>
      </PageSection>

      <PageSection
        title="All depots"
        description={
          depots
            ? `${depots.length} depot${depots.length === 1 ? "" : "s"} configured.`
            : undefined
        }
        flush
      >
        <DataTable
          columns={columns}
          data={depots}
          getRowId={(d) => d.id}
          onRowClick={(d) => setSelectedId(d.id)}
          isLoading={depots === undefined}
          mobileMode="cards"
          empty="No depots yet. Create one to get started."
        />
      </PageSection>

      <Dialog
        open={showCreate}
        onOpenChange={(open) => {
          setShowCreate(open);
          if (!open) form.reset();
        }}
      >
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>New depot</DialogTitle>
            <DialogDescription>
              The address is geocoded to place a pin on the map. Operating hours,
              capacity, and second address line can be edited after creation.
            </DialogDescription>
          </DialogHeader>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(submitCreate)} className="space-y-6">
              <section className="space-y-4">
                <h3 className="text-sm font-semibold text-foreground">Identity</h3>
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Depot name</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Scootering Melbourne" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </section>

              <section className="space-y-4">
                <h3 className="text-sm font-semibold text-foreground">Address</h3>
                <FormField
                  control={form.control}
                  name="addressLine1"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Street address</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. 123 Collins St" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormGrid cols={3}>
                  <FormField
                    control={form.control}
                    name="suburb"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Suburb</FormLabel>
                        <FormControl>
                          <Input placeholder="Melbourne" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="state"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>State</FormLabel>
                        <Select onValueChange={field.onChange} value={field.value}>
                          <FormControl>
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                          </FormControl>
                          <SelectContent>
                            {AU_STATES.map((s) => (
                              <SelectItem key={s} value={s}>
                                {s}
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
                    name="postcode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Postcode</FormLabel>
                        <FormControl>
                          <Input placeholder="3000" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </FormGrid>
              </section>

              <section className="space-y-4">
                <h3 className="text-sm font-semibold text-foreground">Contact</h3>
                <FormGrid cols={2}>
                  <FormField
                    control={form.control}
                    name="phone"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Phone</FormLabel>
                        <FormControl>
                          <Input placeholder="(03) 9000 0000" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl>
                          <Input type="email" placeholder="depot@example.com.au" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </FormGrid>
              </section>

              <section className="space-y-4">
                <h3 className="text-sm font-semibold text-foreground">Operations</h3>
                <FormField
                  control={form.control}
                  name="timezone"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Timezone</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {AU_TIMEZONES.map((tz) => (
                            <SelectItem key={tz} value={tz}>
                              {tz.replace("Australia/", "").replace("_", " ")}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </section>

              {create.error && (
                <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  {create.error.message}
                </div>
              )}

              <DialogFooter>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setShowCreate(false)}
                  disabled={create.isPending}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={create.isPending}>
                  {create.isPending ? "Verifying address…" : "Create depot"}
                </Button>
              </DialogFooter>
            </form>
          </Form>
        </DialogContent>
      </Dialog>

      <Sheet open={!!selectedDepot} onOpenChange={(open) => { if (!open) setSelectedId(null); }}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[540px]">
          {selectedDepot && (
            <DepotEditSheet depot={selectedDepot} />
          )}
        </SheetContent>
      </Sheet>
    </PageShell>
  );
}
