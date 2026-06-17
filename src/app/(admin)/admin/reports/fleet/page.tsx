"use client";

import { REPORT_CONFIGS } from "@/components/admin/report-configs";
import { ReportGrid } from "@/components/admin/report-launcher";

const reports = REPORT_CONFIGS.filter((c) => c.category === "fleet");

export default function ReportsFleetPage() {
  return <ReportGrid reports={reports} />;
}
