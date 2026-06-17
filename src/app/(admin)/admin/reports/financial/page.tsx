"use client";

import { REPORT_CONFIGS } from "@/components/admin/report-configs";
import { ReportGrid } from "@/components/admin/report-launcher";

const reports = REPORT_CONFIGS.filter((c) => c.category === "financial");

export default function ReportsFinancialPage() {
  return <ReportGrid reports={reports} />;
}
