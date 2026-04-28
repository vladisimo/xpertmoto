"use client";

import { use } from "react";

import { useSearchParams, useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { Tabs, TabsTrigger } from "@/components/ui/tabs";
import { MobileScrollTabs } from "@/components/ui/mobile-scroll-tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { StatusBadge } from "@/components/ui/status-badge";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import {
  User,
  CalendarDays,
  CreditCard,
  Car,
  StickyNote,
  MessageCircle,
  AlertTriangle,
  ClipboardList,
  LifeBuoy,
  TriangleAlert,
  FileText,
  History,
} from "lucide-react";
import { CustomerTabPersonal } from "@/components/staff/customer-tab-personal";
import { CustomerTabRentals } from "@/components/staff/customer-tab-rentals";
import { CustomerTabBilling } from "@/components/staff/customer-tab-billing";
import { CustomerTabTolls } from "@/components/staff/customer-tab-tolls";
import { CustomerTabNotes } from "@/components/staff/customer-tab-notes";
import { CustomerTabSMS } from "@/components/staff/customer-tab-sms";
import { CustomerTabInfringements } from "@/components/staff/customer-tab-infringements";
import { CustomerTabLogbook } from "@/components/staff/customer-tab-logbook";
import { CustomerTabAccidents } from "@/components/staff/customer-tab-accidents";
import { CustomerTabSupport } from "@/components/staff/customer-tab-support";
import { CustomerTabDocuments } from "@/components/staff/customer-tab-documents";
import { CustomerTabActivity } from "@/components/staff/customer-tab-activity";

const TABS = [
  { value: "personal", label: "Personal Details", icon: User },
  { value: "rentals", label: "Rental History", icon: CalendarDays },
  { value: "documents", label: "Documents", icon: FileText },
  { value: "billing", label: "Billing", icon: CreditCard },
  { value: "tolls", label: "Tolls", icon: Car },
  { value: "notes", label: "Notes", icon: StickyNote },
  { value: "sms", label: "SMS", icon: MessageCircle },
  { value: "infringements", label: "Infringements", icon: AlertTriangle },
  { value: "logbook", label: "Logbook", icon: ClipboardList },
  { value: "accident", label: "Accident", icon: TriangleAlert },
  { value: "support", label: "Support", icon: LifeBuoy },
  { value: "activity", label: "Activity", icon: History },
] as const;

function getInitials(firstName: string, lastName: string): string {
  return `${firstName[0] ?? ""}${lastName[0] ?? ""}`.toUpperCase();
}

export default function CustomerDetailPage(props: { params: Promise<{ id: string }> }) {
  const params = use(props.params);
  const { id } = params;
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab = searchParams.get("tab") ?? "personal";

  const { data: user, isLoading } = trpc.staffCustomer.detail.useQuery({ id });

  const handleTabChange = (value: string) => {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", value);
    router.replace(url.pathname + url.search, { scroll: false });
  };

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-muted-foreground">Loading customer...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-muted-foreground">Customer not found</div>
      </div>
    );
  }

  const cp = user.customerProfile;

  return (
    <PageShell>
      <PageHeader
        breadcrumbs={[
          { label: "Customers", href: "/staff/customers" },
          { label: `${user.firstName} ${user.lastName}` },
        ]}
        title={`${user.firstName} ${user.lastName}`}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <span>{user.email}</span>
            {user.phone && <><span className="text-border">·</span><span>{user.phone}</span></>}
            {cp?.licenceVerifiedAt && (
              <StatusBadge status="VERIFIED" label="Licence verified" />
            )}
            {cp?.passportVerifiedAt && (
              <StatusBadge status="VERIFIED" label="Passport verified" />
            )}
            {cp?.riskRating && (
              <StatusBadge
                status={
                  cp.riskRating === "LOW"
                    ? "RISK_LOW"
                    : cp.riskRating === "MEDIUM"
                      ? "RISK_MEDIUM"
                      : "RISK_HIGH"
                }
                label={`Risk: ${cp.riskRating}`}
              />
            )}
          </span>
        }
        actions={
          <Avatar className="h-24 w-24 ring-2 ring-border">
            {user.avatarUrl && (
              <AvatarImage
                src={user.avatarUrl}
                alt={`${user.firstName} ${user.lastName}`}
                className="object-cover"
              />
            )}
            <AvatarFallback className="bg-primary/10 text-xl font-semibold text-primary">
              {getInitials(user.firstName, user.lastName)}
            </AvatarFallback>
          </Avatar>
        }
      />

      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <MobileScrollTabs className="w-full justify-start sm:w-full">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            return (
              <TabsTrigger key={tab.value} value={tab.value} className="gap-1.5">
                <Icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{tab.label}</span>
              </TabsTrigger>
            );
          })}
        </MobileScrollTabs>
      </Tabs>

      {activeTab === "personal" && <CustomerTabPersonal customer={user} customerId={id} />}
      {activeTab === "rentals" && <CustomerTabRentals customerId={id} />}
      {activeTab === "documents" && <CustomerTabDocuments customerId={id} />}
      {activeTab === "billing" && <CustomerTabBilling customerId={id} />}
      {activeTab === "tolls" && <CustomerTabTolls customerId={id} />}
      {activeTab === "notes" && <CustomerTabNotes customerId={id} notes={cp?.notes ?? null} />}
      {activeTab === "sms" && <CustomerTabSMS customerId={id} />}
      {activeTab === "infringements" && <CustomerTabInfringements customerId={id} />}
      {activeTab === "logbook" && <CustomerTabLogbook customerId={id} />}
      {activeTab === "accident" && <CustomerTabAccidents customerId={id} />}
      {activeTab === "support" && <CustomerTabSupport customerId={id} />}
      {activeTab === "activity" && <CustomerTabActivity customerId={id} />}
    </PageShell>
  );
}
