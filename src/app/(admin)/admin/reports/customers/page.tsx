"use client";

import { REPORT_CONFIGS } from "@/components/admin/report-configs";
import { ReportGrid } from "@/components/admin/report-launcher";

const reports = REPORT_CONFIGS.filter((c) => c.category === "customers");

export default function ReportsCustomersPage() {
  return <ReportGrid reports={reports} />;
}
