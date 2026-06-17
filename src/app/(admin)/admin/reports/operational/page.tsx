"use client";

import { REPORT_CONFIGS } from "@/components/admin/report-configs";
import { ReportGrid } from "@/components/admin/report-launcher";

const reports = REPORT_CONFIGS.filter((c) => c.category === "operational");

export default function ReportsOperationalPage() {
  return <ReportGrid reports={reports} />;
}
