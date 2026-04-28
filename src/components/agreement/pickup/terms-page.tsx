"use client";

import * as React from "react";
import { CURRENT_TERMS, interpolateTerms } from "@/lib/agreement/terms";
import { useBranding } from "@/components/shared/branding-provider";

export function TermsPage() {
  const branding = useBranding();
  const terms = React.useMemo(
    () =>
      interpolateTerms(CURRENT_TERMS, {
        siteName: branding.siteName,
        legalName: branding.legalName,
        abn: branding.abn,
      }),
    [branding],
  );

  return (
    <div className="max-h-[50vh] overflow-y-auto pr-2">
      {terms.preamble.map((p, i) => (
        <p key={`pre-${i}`} className="mb-3 text-sm leading-relaxed">
          {p}
        </p>
      ))}
      {terms.sections.map((s) => (
        <section key={s.heading} className="mb-4">
          <h4 className="mb-1 text-sm font-semibold">{s.heading}</h4>
          {s.paragraphs.map((p, pi) => (
            <p key={pi} className="mb-2 text-sm leading-relaxed">
              {p}
            </p>
          ))}
        </section>
      ))}
    </div>
  );
}
