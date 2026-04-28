"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDate } from "@/lib/utils";
import { LicenceClassChips } from "@/components/staff/customer-tab-documents";
import { ViewAsCustomerButton } from "@/components/staff/view-as-customer-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Pencil, X, Save, ShieldCheck, KeyRound, Eye } from "lucide-react";

type CustomerData = {
  id: string;
  email: string;
  phone: string | null;
  firstName: string;
  lastName: string;
  dateOfBirth: Date | string | null;
  customerProfile: {
    licenceNumber: string | null;
    licenceState: string | null;
    licenceExpiry: Date | string | null;
    licenceClass: string | null;
    licenceImageFront: string | null;
    licenceImageBack: string | null;
    licenceVerifiedAt: Date | string | null;
    passportNumber: string | null;
    passportCountry: string | null;
    passportExpiry: Date | string | null;
    passportImage: string | null;
    passportVerifiedAt: Date | string | null;
    emergencyContactName: string | null;
    emergencyContactPhone: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    suburb: string | null;
    state: string | null;
    postcode: string | null;
    country: string | null;
    companyName: string | null;
    abn: string | null;
    riskRating: string;
    customerSince: Date | string;
    totalBookings: number;
    totalSpend: unknown;
    loyaltyPoints: number;
    marketingOptIn: boolean;
  } | null;
};

function formatAddress(cp: {
  addressLine1: string | null;
  addressLine2: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  country: string | null;
}): string {
  const street = [cp.addressLine1, cp.addressLine2].filter(Boolean).join(", ");
  const locality = [cp.suburb, cp.state, cp.postcode].filter(Boolean).join(" ");
  const isAU = !cp.country || cp.country.toLowerCase() === "australia";
  const lines = [street, locality, isAU ? null : cp.country].filter(
    (s): s is string => Boolean(s),
  );
  return lines.join("\n");
}

export function CustomerTabPersonal({
  customer,
  customerId,
}: {
  customer: CustomerData;
  customerId: string;
}) {
  const util = trpc.useUtils();
  const [editing, setEditing] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const cp = customer.customerProfile;

  const [form, setForm] = useState({
    firstName: customer.firstName,
    lastName: customer.lastName,
    email: customer.email,
    phone: customer.phone ?? "",
    dateOfBirth: customer.dateOfBirth
      ? new Date(customer.dateOfBirth as string).toISOString().split("T")[0]
      : "",
    addressLine1: cp?.addressLine1 ?? "",
    addressLine2: cp?.addressLine2 ?? "",
    suburb: cp?.suburb ?? "",
    state: cp?.state ?? "",
    postcode: cp?.postcode ?? "",
    country: cp?.country ?? "Australia",
    licenceNumber: cp?.licenceNumber ?? "",
    licenceState: cp?.licenceState ?? "",
    licenceExpiry: cp?.licenceExpiry
      ? new Date(cp.licenceExpiry as string).toISOString().split("T")[0]
      : "",
    licenceClass: cp?.licenceClass ?? "",
    passportNumber: cp?.passportNumber ?? "",
    passportCountry: cp?.passportCountry ?? "",
    passportExpiry: cp?.passportExpiry
      ? new Date(cp.passportExpiry as string).toISOString().split("T")[0]
      : "",
    emergencyContactName: cp?.emergencyContactName ?? "",
    emergencyContactPhone: cp?.emergencyContactPhone ?? "",
    companyName: cp?.companyName ?? "",
    abn: cp?.abn ?? "",
  });

  const updateProfile = trpc.staffCustomer.updateProfile.useMutation({
    onSuccess: () => {
      util.staffCustomer.detail.invalidate({ id: customerId });
      setEditing(false);
    },
  });

  const verify = trpc.staffCustomer.verifyLicence.useMutation({
    onSuccess: () => util.staffCustomer.detail.invalidate({ id: customerId }),
  });

  const verifyPp = trpc.staffCustomer.verifyPassport.useMutation({
    onSuccess: () => util.staffCustomer.detail.invalidate({ id: customerId }),
  });

  const startIdentity = trpc.staffCustomer.startLicenceVerification.useMutation({
    onSuccess: (session) => {
      if (session.url) window.open(session.url, "_blank", "noopener,noreferrer");
      util.staffCustomer.detail.invalidate({ id: customerId });
    },
  });

  const setRisk = trpc.staffCustomer.setRiskRating.useMutation({
    onSuccess: () => util.staffCustomer.detail.invalidate({ id: customerId }),
  });

  const [pwValue, setPwValue] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState(false);
  const [preview, setPreview] = useState<{ url: string; title: string } | null>(null);

  const setCustomerPassword = trpc.staffCustomer.setCustomerPassword.useMutation({
    onSuccess: () => {
      setPwSuccess(true);
      setPwValue("");
      setPwConfirm("");
      setPwError(null);
    },
    onError: (err) => setPwError(err.message),
  });

  const closePwDialog = () => {
    setPwOpen(false);
    setPwValue("");
    setPwConfirm("");
    setPwError(null);
    setPwSuccess(false);
  };

  const submitPassword = () => {
    setPwError(null);
    if (pwValue.length < 10) {
      setPwError("Password must be at least 10 characters");
      return;
    }
    if (pwValue !== pwConfirm) {
      setPwError("Passwords do not match");
      return;
    }
    setCustomerPassword.mutate({ customerId, password: pwValue });
  };

  const handleSave = () => {
    updateProfile.mutate({
      customerId,
      ...form,
      dateOfBirth: form.dateOfBirth || undefined,
      licenceExpiry: form.licenceExpiry || undefined,
      passportExpiry: form.passportExpiry || undefined,
    });
  };

  const set = (key: keyof typeof form, val: string) =>
    setForm((prev) => ({ ...prev, [key]: val }));

  return (
    <div className="space-y-6">
      {/* Header bar with edit toggle */}
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">Personal Details</h2>
        {!editing ? (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
              <Pencil className="mr-1.5 h-3.5 w-3.5" />
              Edit Profile
            </Button>
            <ViewAsCustomerButton customerId={customerId} />
            <Button variant="outline" size="sm" onClick={() => setPwOpen(true)}>
              <KeyRound className="mr-1.5 h-3.5 w-3.5" />
              Reset Password
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} disabled={updateProfile.isPending}>
              <Save className="mr-1.5 h-3.5 w-3.5" />
              Save
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
              <X className="mr-1.5 h-3.5 w-3.5" />
              Cancel
            </Button>
          </div>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Personal Info */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Contact Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {editing ? (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label>First Name</Label>
                    <Input value={form.firstName} onChange={(e) => set("firstName", e.target.value)} />
                  </div>
                  <div>
                    <Label>Last Name</Label>
                    <Input value={form.lastName} onChange={(e) => set("lastName", e.target.value)} />
                  </div>
                </div>
                <div>
                  <Label>Email</Label>
                  <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
                </div>
                <div>
                  <Label>Phone</Label>
                  <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
                </div>
                <div>
                  <Label>Date of Birth</Label>
                  <Input type="date" value={form.dateOfBirth} onChange={(e) => set("dateOfBirth", e.target.value)} />
                </div>
              </>
            ) : (
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Name</dt>
                  <dd className="font-medium">{customer.firstName} {customer.lastName}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Email</dt>
                  <dd>{customer.email}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Phone</dt>
                  <dd>{customer.phone ?? "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">DOB</dt>
                  <dd>{customer.dateOfBirth ? formatDate(customer.dateOfBirth as string) : "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Customer Since</dt>
                  <dd>{cp?.customerSince ? formatDate(cp.customerSince as string) : "—"}</dd>
                </div>
              </dl>
            )}
          </CardContent>
        </Card>

        {/* Address */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Address</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {editing ? (
              <>
                <div>
                  <Label>Address Line 1</Label>
                  <Input value={form.addressLine1} onChange={(e) => set("addressLine1", e.target.value)} />
                </div>
                <div>
                  <Label>Address Line 2</Label>
                  <Input value={form.addressLine2} onChange={(e) => set("addressLine2", e.target.value)} />
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <div>
                    <Label>Suburb / City</Label>
                    <Input value={form.suburb} onChange={(e) => set("suburb", e.target.value)} />
                  </div>
                  <div>
                    <Label>State / Region</Label>
                    <Input value={form.state} onChange={(e) => set("state", e.target.value)} />
                  </div>
                  <div>
                    <Label>Postcode</Label>
                    <Input value={form.postcode} onChange={(e) => set("postcode", e.target.value)} />
                  </div>
                </div>
                <div>
                  <Label>Country</Label>
                  <Input value={form.country} onChange={(e) => set("country", e.target.value)} />
                </div>
              </>
            ) : (
              <p className="text-sm whitespace-pre-line">
                {cp?.addressLine1
                  ? formatAddress(cp)
                  : <span className="text-muted-foreground">No address on file</span>}
              </p>
            )}
          </CardContent>
        </Card>

        {/* Licence */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              Licence
              {cp?.licenceVerifiedAt ? (
                <StatusBadge status="VERIFIED" />
              ) : (
                <StatusBadge status="UNVERIFIED_DOC" />
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {editing ? (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label>Licence Number</Label>
                    <Input value={form.licenceNumber} onChange={(e) => set("licenceNumber", e.target.value)} />
                  </div>
                  <div>
                    <Label>State</Label>
                    <Input value={form.licenceState} onChange={(e) => set("licenceState", e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label>Class</Label>
                    <Input value={form.licenceClass} onChange={(e) => set("licenceClass", e.target.value)} />
                  </div>
                  <div>
                    <Label>Expiry</Label>
                    <Input type="date" value={form.licenceExpiry} onChange={(e) => set("licenceExpiry", e.target.value)} />
                  </div>
                </div>
              </>
            ) : (
              <>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Number</dt>
                    <dd className="font-medium">{cp?.licenceNumber ?? "—"}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">State</dt>
                    <dd>{cp?.licenceState ?? "—"}</dd>
                  </div>
                  <div className="flex items-start justify-between gap-3">
                    <dt className="text-muted-foreground">Class</dt>
                    <dd className="flex justify-end">
                      <LicenceClassChips raw={cp?.licenceClass} />
                    </dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Expiry</dt>
                    <dd>{cp?.licenceExpiry ? formatDate(cp.licenceExpiry as string) : "—"}</dd>
                  </div>
                </dl>
                <div className="flex flex-wrap gap-2 pt-2">
                  {cp?.licenceVerifiedAt ? (
                    <Button size="sm" variant="outline" onClick={() => verify.mutate({ customerId, verified: false })} disabled={verify.isPending}>
                      Unverify
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => verify.mutate({ customerId, verified: true })} disabled={verify.isPending}>
                      Verify Licence
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      startIdentity.mutate({
                        customerId,
                        returnUrl: `${window.location.origin}/staff/customers/${customerId}`,
                      })
                    }
                    disabled={startIdentity.isPending}
                    title="Opens Stripe Identity on a secure Stripe-hosted page"
                  >
                    <ShieldCheck className="mr-1.5 h-3.5 w-3.5" />
                    Start Identity verification
                  </Button>
                  {cp?.licenceImageFront && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setPreview({ url: cp.licenceImageFront!, title: "Licence — front" })
                      }
                    >
                      <Eye className="mr-1.5 h-3.5 w-3.5" />
                      View front
                    </Button>
                  )}
                  {cp?.licenceImageBack && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setPreview({ url: cp.licenceImageBack!, title: "Licence — back" })
                      }
                    >
                      <Eye className="mr-1.5 h-3.5 w-3.5" />
                      View back
                    </Button>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Passport */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              Passport
              {cp?.passportVerifiedAt ? (
                <StatusBadge status="VERIFIED" />
              ) : cp?.passportNumber || cp?.passportImage ? (
                <StatusBadge status="UNVERIFIED_DOC" />
              ) : (
                <Badge variant="outline">Not on file</Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {editing ? (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label>Passport Number</Label>
                    <Input value={form.passportNumber} onChange={(e) => set("passportNumber", e.target.value)} />
                  </div>
                  <div>
                    <Label>Country</Label>
                    <Input
                      value={form.passportCountry}
                      onChange={(e) => set("passportCountry", e.target.value)}
                      placeholder="AU"
                    />
                  </div>
                </div>
                <div>
                  <Label>Expiry</Label>
                  <Input type="date" value={form.passportExpiry} onChange={(e) => set("passportExpiry", e.target.value)} />
                </div>
              </>
            ) : (
              <>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Number</dt>
                    <dd className="font-medium">{cp?.passportNumber ?? "—"}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Country</dt>
                    <dd>{cp?.passportCountry ?? "—"}</dd>
                  </div>
                  <div className="flex justify-between">
                    <dt className="text-muted-foreground">Expiry</dt>
                    <dd>{cp?.passportExpiry ? formatDate(cp.passportExpiry as string) : "—"}</dd>
                  </div>
                </dl>
                <div className="flex flex-wrap gap-2 pt-2">
                  {cp?.passportVerifiedAt ? (
                    <Button size="sm" variant="outline" onClick={() => verifyPp.mutate({ customerId, verified: false })} disabled={verifyPp.isPending}>
                      Unverify
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => verifyPp.mutate({ customerId, verified: true })} disabled={verifyPp.isPending}>
                      Verify Passport
                    </Button>
                  )}
                  {cp?.passportImage && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setPreview({ url: cp.passportImage!, title: "Passport — bio-data page" })
                      }
                    >
                      <Eye className="mr-1.5 h-3.5 w-3.5" />
                      View bio-data
                    </Button>
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Emergency Contact */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Emergency Contact</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {editing ? (
              <>
                <div>
                  <Label>Contact Name</Label>
                  <Input value={form.emergencyContactName} onChange={(e) => set("emergencyContactName", e.target.value)} />
                </div>
                <div>
                  <Label>Contact Phone</Label>
                  <Input value={form.emergencyContactPhone} onChange={(e) => set("emergencyContactPhone", e.target.value)} />
                </div>
              </>
            ) : (
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Name</dt>
                  <dd>{cp?.emergencyContactName ?? "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Phone</dt>
                  <dd>{cp?.emergencyContactPhone ?? "—"}</dd>
                </div>
              </dl>
            )}
          </CardContent>
        </Card>

        {/* Business details (B2B tax invoices) */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Business details
              <span className="ml-2 caption font-normal text-muted-foreground">
                Optional · for tax invoices issued to a business
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {editing ? (
              <>
                <div>
                  <Label>Company name</Label>
                  <Input
                    value={form.companyName}
                    onChange={(e) => set("companyName", e.target.value)}
                    placeholder="Acme Pty Ltd"
                  />
                </div>
                <div>
                  <Label>ABN</Label>
                  <Input
                    value={form.abn}
                    onChange={(e) => set("abn", e.target.value)}
                    placeholder="11 digit ABN"
                    inputMode="numeric"
                  />
                </div>
              </>
            ) : (
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">Company</dt>
                  <dd>{cp?.companyName ?? "—"}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted-foreground">ABN</dt>
                  <dd>
                    {cp?.abn
                      ? cp.abn.replace(/^(\d{2})(\d{3})(\d{3})(\d{3})$/, "$1 $2 $3 $4")
                      : "—"}
                  </dd>
                </div>
              </dl>
            )}
          </CardContent>
        </Card>

        {/* Stats & Risk Rating */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Stats & Risk</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Total Bookings</dt>
                <dd className="font-medium">{cp?.totalBookings ?? 0}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Total Spend</dt>
                <dd className="font-medium">${Number(cp?.totalSpend ?? 0).toFixed(2)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Loyalty Points</dt>
                <dd className="font-medium">{cp?.loyaltyPoints ?? 0}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Marketing Opt-In</dt>
                <dd>{cp?.marketingOptIn ? "Yes" : "No"}</dd>
              </div>
            </dl>
            <div className="pt-2">
              <Label className="text-xs text-muted-foreground">Risk Rating</Label>
              <div className="flex gap-2 pt-1">
                {(["LOW", "MEDIUM", "HIGH"] as const).map((r) => (
                  <Button
                    key={r}
                    size="sm"
                    variant={cp?.riskRating === r ? "default" : "outline"}
                    onClick={() => setRisk.mutate({ customerId, riskRating: r })}
                    disabled={setRisk.isPending}
                  >
                    {r}
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={pwOpen}
        onOpenChange={(open) => (open ? setPwOpen(true) : closePwDialog())}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset customer password</DialogTitle>
            <DialogDescription>
              Overwrite the sign-in password for {customer.firstName}{" "}
              {customer.lastName}. The customer will not be notified — share the
              new password securely through a channel they can access.
            </DialogDescription>
          </DialogHeader>

          {pwSuccess ? (
            <div className="rounded-md border border-primary/20 bg-primary/5 p-3 text-sm text-primary">
              Password updated. The customer can sign in with the new password
              immediately.
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <Label htmlFor="reset-pw">New password</Label>
                <Input
                  id="reset-pw"
                  type="password"
                  autoComplete="new-password"
                  value={pwValue}
                  onChange={(e) => setPwValue(e.target.value)}
                  disabled={setCustomerPassword.isPending}
                />
              </div>
              <div>
                <Label htmlFor="reset-pw-confirm">Confirm password</Label>
                <Input
                  id="reset-pw-confirm"
                  type="password"
                  autoComplete="new-password"
                  value={pwConfirm}
                  onChange={(e) => setPwConfirm(e.target.value)}
                  disabled={setCustomerPassword.isPending}
                />
              </div>
              {pwError && (
                <p className="text-sm text-destructive" role="alert">
                  {pwError}
                </p>
              )}
            </div>
          )}

          <DialogFooter>
            {pwSuccess ? (
              <Button onClick={closePwDialog}>Done</Button>
            ) : (
              <>
                <Button
                  variant="ghost"
                  onClick={closePwDialog}
                  disabled={setCustomerPassword.isPending}
                >
                  Cancel
                </Button>
                <Button
                  onClick={submitPassword}
                  disabled={setCustomerPassword.isPending}
                >
                  {setCustomerPassword.isPending ? "Saving..." : "Set password"}
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!preview} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-h-[90vh] max-w-4xl overflow-hidden p-0">
          <DialogHeader className="border-b px-6 py-4">
            <DialogTitle>{preview?.title ?? ""}</DialogTitle>
          </DialogHeader>
          <div className="flex max-h-[calc(90vh-5rem)] items-center justify-center overflow-auto bg-muted/40 p-4">
            {preview && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={preview.url}
                alt={preview.title}
                className="max-h-[75vh] w-auto max-w-full object-contain"
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
