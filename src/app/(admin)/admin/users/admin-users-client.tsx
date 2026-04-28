"use client";
import * as React from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Plus, RefreshCw, Search, Trash2 } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
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
  DataTable,
  type DataTableColumn,
  type DataTableSortState,
} from "@/components/ui/data-table";
import { DataTablePagination } from "@/components/ui/data-table-pagination";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { FormGrid, FormGridRow } from "@/components/forms/form-grid";
import { UsersStats } from "@/components/admin/users-stats";

const ROLES = ["CUSTOMER", "STAFF", "MANAGER", "ADMIN", "SUPER_ADMIN"] as const;
const INVITE_ROLES = ["STAFF", "MANAGER", "ADMIN", "SUPER_ADMIN"] as const;
const STATUSES = ["ACTIVE", "SUSPENDED", "BANNED"] as const;
const PAGE_SIZES = [25, 50, 100] as const;
const DEFAULT_PAGE_SIZE = 25;

const inviteSchema = z.object({
  firstName: z.string().min(1, "Required"),
  lastName: z.string().min(1, "Required"),
  email: z.string().email("Must be a valid email"),
  role: z.enum(INVITE_ROLES),
  depotId: z.string().optional(),
  position: z.string().optional(),
});
type InviteForm = z.infer<typeof inviteSchema>;

function parsePageSize(value: string | null): number {
  const n = Number(value);
  return (PAGE_SIZES as readonly number[]).includes(n) ? n : DEFAULT_PAGE_SIZE;
}

function parseSort(value: string | null): DataTableSortState | null {
  if (!value) return null;
  const [id, dir] = value.split(":");
  if (!id || (dir !== "asc" && dir !== "desc")) return null;
  if (id !== "name" && id !== "createdAt") return null;
  return { id, dir };
}

export function AdminUsersClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const util = trpc.useUtils();

  const search = searchParams.get("q") ?? "";
  const role = searchParams.get("role") ?? "";
  const page = Math.max(1, Number(searchParams.get("page")) || 1);
  const pageSize = parsePageSize(searchParams.get("size"));
  const sort = parseSort(searchParams.get("sort"));

  const setParams = React.useCallback(
    (patch: Record<string, string | number | null>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "" || value === undefined) next.delete(key);
        else next.set(key, String(value));
      }
      router.replace(`/admin/users?${next.toString()}`, { scroll: false });
    },
    [router, searchParams],
  );

  const listInput = React.useMemo(
    () => ({
      search: search || undefined,
      role: role || undefined,
      page,
      pageSize,
      sortBy: (sort?.id ?? "createdAt") as "name" | "createdAt",
      sortDir: (sort?.dir ?? "desc") as "asc" | "desc",
    }),
    [search, role, page, pageSize, sort],
  );

  const listQuery = trpc.admin.listUsers.useQuery(listInput);
  const { data: stats, isLoading: statsLoading } = trpc.admin.usersStats.useQuery(undefined, {
    staleTime: 30_000,
  });
  const { data: depots } = trpc.depot.list.useQuery();
  const invite = trpc.admin.inviteStaff.useMutation({
    onSuccess: () => util.admin.listUsers.invalidate(),
  });
  const resend = trpc.admin.resendInvite.useMutation({
    onSuccess: () => util.admin.listUsers.invalidate(),
  });
  const revoke = trpc.admin.revokeInvite.useMutation({
    onSuccess: () => util.admin.listUsers.invalidate(),
  });
  const update = trpc.admin.updateUser.useMutation({
    onSuccess: () => util.admin.listUsers.invalidate(),
  });
  const deleteStaff = trpc.admin.deleteStaffUser.useMutation({
    onSuccess: () => {
      util.admin.listUsers.invalidate();
      util.admin.usersStats.invalidate();
    },
  });

  const { data: session } = useSession();
  const isSuperAdmin = session?.user?.role === "SUPER_ADMIN";
  const currentUserId = session?.user?.id;

  const [showInvite, setShowInvite] = React.useState(false);
  const [lastInvite, setLastInvite] = React.useState<
    { email: string; expiresAt: Date; action: "sent" | "resent" } | null
  >(null);

  const form = useForm<InviteForm>({
    resolver: zodResolver(inviteSchema),
    defaultValues: { firstName: "", lastName: "", email: "", role: "STAFF", depotId: "", position: "" },
  });

  async function submitInvite(values: InviteForm) {
    const res = await invite.mutateAsync({
      email: values.email,
      firstName: values.firstName,
      lastName: values.lastName,
      role: values.role,
      depotId: values.depotId || undefined,
      position: values.position || undefined,
    });
    setLastInvite({ email: res.email, expiresAt: res.expiresAt, action: "sent" });
    setShowInvite(false);
    form.reset();
  }

  async function handleResend(userId: string) {
    const res = await resend.mutateAsync({ userId });
    setLastInvite({ email: res.email, expiresAt: res.expiresAt, action: "resent" });
  }

  async function handleRevoke(userId: string, email: string) {
    if (!confirm(`Revoke the pending invitation for ${email}? The account will be removed.`)) {
      return;
    }
    await revoke.mutateAsync({ userId });
    setLastInvite(null);
  }

  async function handleDeleteStaff(userId: string, email: string, role: string) {
    const label = formatRole(role);
    if (
      !confirm(
        `Delete ${label} account ${email}?\n\nThis revokes their access immediately and anonymises their personal details. Linked bookings, work orders and audit records are retained. This cannot be undone.`,
      )
    ) {
      return;
    }
    await deleteStaff.mutateAsync({ userId });
  }

  type UserRow = NonNullable<typeof listQuery.data>["items"][number];
  const userColumns: DataTableColumn<UserRow>[] = [
    {
      id: "name",
      header: "Name",
      sortable: true,
      primary: true,
      cell: (u) => (
        <div className="min-w-0">
          <div className="font-medium">{u.firstName} {u.lastName}</div>
          <div className="truncate text-xs text-muted-foreground">{u.email}</div>
        </div>
      ),
    },
    {
      id: "depot",
      header: "Depot",
      secondary: true,
      cell: (u) => (
        <span className="text-muted-foreground">{u.depot?.name ?? "—"}</span>
      ),
    },
    {
      id: "position",
      header: "Position",
      cell: (u) => (
        <span className="text-muted-foreground">
          {u.staffProfile?.position ?? formatRole(u.role)}
        </span>
      ),
    },
    {
      id: "role",
      header: "Role",
      width: "10rem",
      cell: (u) => (
        <Select
          value={u.role}
          onValueChange={(v) => update.mutate({ id: u.id, role: v as typeof ROLES[number] })}
        >
          <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
          <SelectContent>
            {ROLES.map((r) => (
              <SelectItem key={r} value={r}>{formatRole(r)}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      ),
    },
    {
      id: "status",
      header: "Status",
      width: "10rem",
      cell: (u) =>
        u.hasPendingInvite ? (
          <StatusBadge status="PENDING" label="Pending invite" />
        ) : (
          <Select
            value={u.status}
            onValueChange={(v) => update.mutate({ id: u.id, status: v as typeof STATUSES[number] })}
          >
            <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
            <SelectContent>
              {STATUSES.map((s) => (
                <SelectItem key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        ),
    },
    {
      id: "actions",
      header: "",
      width: "8rem",
      cell: (u) => {
        if (u.hasPendingInvite) {
          return (
            <div className="flex justify-end gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleResend(u.id)}
                disabled={resend.isPending}
                aria-label={`Resend invitation to ${u.email}`}
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Resend
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => handleRevoke(u.id, u.email)}
                disabled={revoke.isPending}
                aria-label={`Revoke invitation for ${u.email}`}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </div>
          );
        }
        const canDelete =
          isSuperAdmin &&
          u.id !== currentUserId &&
          (u.role === "STAFF" || u.role === "MANAGER" || u.role === "ADMIN");
        if (!canDelete) return null;
        return (
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => handleDeleteStaff(u.id, u.email, u.role)}
              disabled={deleteStaff.isPending}
              aria-label={`Delete ${u.email}`}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        );
      },
    },
  ];

  const rows = listQuery.data?.items;

  return (
    <PageShell full>
      <PageHeader
        eyebrow="Administration"
        title="Users & roles"
        description="Invite staff, manage access, and assign depots."
        actions={
          <Button onClick={() => setShowInvite(true)}>
            <Plus className="h-4 w-4" />
            Invite staff
          </Button>
        }
      />

      <UsersStats data={stats} loading={statsLoading} />

      {lastInvite && (
        <Card className="border-primary bg-primary/5">
          <CardContent className="flex items-center justify-between gap-3 p-4 text-sm">
            <div>
              <strong>
                Invitation {lastInvite.action === "sent" ? "sent to" : "resent to"}{" "}
                {lastInvite.email}.
              </strong>
              <div className="mt-1 text-xs text-muted-foreground">
                The link expires on{" "}
                {new Date(lastInvite.expiresAt).toLocaleString("en-AU", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
                . We sent them a secure link to set their password and enrol in
                two-factor authentication.
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLastInvite(null)}
              aria-label="Dismiss"
            >
              Dismiss
            </Button>
          </CardContent>
        </Card>
      )}

      <Sheet
        open={showInvite}
        onOpenChange={(open) => {
          setShowInvite(open);
          if (!open) form.reset();
        }}
      >
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-[480px]">
          <SheetHeader className="text-left">
            <SheetTitle>Invite staff member</SheetTitle>
            <p className="text-sm text-muted-foreground">
              Send a secure invitation link. They&apos;ll set their own
              password and enrol in two-factor authentication before they can
              access the back-office.
            </p>
          </SheetHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(submitInvite)} className="mt-6">
              <FormGrid cols={2}>
                <FormField
                  control={form.control}
                  name="firstName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>First name</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="lastName"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Last name</FormLabel>
                      <FormControl><Input {...field} /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormGridRow>
                  <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Email</FormLabel>
                        <FormControl><Input type="email" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </FormGridRow>
                <FormField
                  control={form.control}
                  name="role"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Role</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl>
                          <SelectTrigger><SelectValue placeholder="Select role" /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          {INVITE_ROLES.map((r) => (
                            <SelectItem key={r} value={r}>{formatRole(r)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="depotId"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Depot</FormLabel>
                      <Select
                        onValueChange={(v) => field.onChange(v === "__unassigned__" ? "" : v)}
                        value={field.value ? field.value : "__unassigned__"}
                      >
                        <FormControl>
                          <SelectTrigger><SelectValue placeholder="Unassigned" /></SelectTrigger>
                        </FormControl>
                        <SelectContent>
                          <SelectItem value="__unassigned__">Unassigned</SelectItem>
                          {depots?.map((d) => (
                            <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormGridRow>
                  <FormField
                    control={form.control}
                    name="position"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Position</FormLabel>
                        <FormControl><Input placeholder="e.g. Depot Supervisor" {...field} /></FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </FormGridRow>
                <FormGridRow className="flex justify-end gap-2">
                  <Button type="button" variant="secondary" onClick={() => setShowInvite(false)}>Cancel</Button>
                  <Button type="submit" disabled={invite.isPending}>
                    {invite.isPending ? "Sending…" : "Send invitation"}
                  </Button>
                </FormGridRow>
              </FormGrid>
            </form>
          </Form>
        </SheetContent>
      </Sheet>

      <div className="flex flex-col gap-2 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            placeholder="Search name or email…"
            value={search}
            onChange={(e) => setParams({ q: e.target.value || null, page: null })}
            className="pl-9"
          />
        </div>
        <div className="w-full sm:w-48">
          <Select
            value={role || "__all__"}
            onValueChange={(v) => setParams({ role: v === "__all__" ? null : v, page: null })}
          >
            <SelectTrigger><SelectValue placeholder="All roles" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__all__">All roles</SelectItem>
              {ROLES.map((r) => (
                <SelectItem key={r} value={r}>{formatRole(r)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden md:gap-0 md:rounded-md md:border md:bg-card md:shadow-sm">
        <DataTable
          columns={userColumns}
          data={listQuery.isLoading ? undefined : rows}
          isLoading={listQuery.isLoading}
          mobileMode="cards"
          getRowId={(u) => u.id}
          empty="No users match your filters."
          sort={sort}
          onSortChange={(next) =>
            setParams({ sort: next ? `${next.id}:${next.dir}` : null, page: null })
          }
          className="min-h-0 flex-1 overflow-auto rounded-none border-0 shadow-none [&>div]:overflow-visible [&_thead]:sticky [&_thead]:top-0 [&_thead]:z-10 [&_thead]:bg-foreground [&_thead_tr]:border-foreground/60 [&_thead_tr:hover]:bg-foreground [&_thead_th]:text-background/80"
        />
        <div className="shrink-0 px-1 py-2 md:border-t md:px-4 md:py-2.5">
          <DataTablePagination
            page={listQuery.data?.page ?? page}
            pageSize={listQuery.data?.pageSize ?? pageSize}
            totalCount={listQuery.data?.totalCount ?? 0}
            pageCount={listQuery.data?.pageCount ?? 1}
            onPageChange={(next) => setParams({ page: next === 1 ? null : next })}
            onPageSizeChange={(next) =>
              setParams({ size: next === DEFAULT_PAGE_SIZE ? null : next, page: null })
            }
            emptyLabel="No users"
          />
        </div>
      </div>
    </PageShell>
  );
}

function formatRole(role: string): string {
  return role.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
