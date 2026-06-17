"use client";

import { REPORT_CONFIGS } from "@/components/admin/report-configs";
import { ReportGrid } from "@/components/admin/report-launcher";

const reports = REPORT_CONFIGS.filter((c) => c.category === "bookings");

/** Default tab — served at /admin/reports. */
export default function ReportsBookingsPage() {
  return <ReportGrid reports={reports} />;
}
