import { CURRENT_TERMS, interpolateTerms } from "@/lib/agreement/terms";
import { getBranding } from "@/lib/branding";

export default async function TermsPage() {
  const branding = await getBranding();
  const terms = interpolateTerms(CURRENT_TERMS, {
    siteName: branding.siteName,
    legalName: branding.legalName,
    abn: branding.abn,
  });
  const effective = new Date(terms.effective).toLocaleDateString("en-AU", {
    year: "numeric",
    month: "long",
  });

  return (
    <div className="container max-w-3xl py-12 prose prose-slate">
      <h1 className="h-display">Rental terms &amp; conditions</h1>
      <p className="text-muted-foreground">
        Version {terms.version} — effective {effective}
      </p>
      <p className="text-muted-foreground text-sm">
        {branding.legalName}
        {branding.abn ? ` · ABN ${branding.abn}` : null}
      </p>

      <section className="mt-8 space-y-6 text-sm leading-relaxed">
        {terms.preamble.map((p, i) => (
          <p key={`pre-${i}`}>{p}</p>
        ))}

        {terms.sections.map((section) => (
          <div key={section.heading} className="space-y-3">
            <h2 className="h3">{section.heading}</h2>
            {section.paragraphs.map((p, i) => (
              <p key={i}>{p}</p>
            ))}
          </div>
        ))}

        {branding.supportEmail || branding.postalAddress ? (
          <p className="text-xs text-muted-foreground pt-6">
            Questions?
            {branding.supportEmail ? (
              <>
                {" "}
                <a href={`mailto:${branding.supportEmail}`}>{branding.supportEmail}</a>
              </>
            ) : null}
            {branding.postalAddress ? <> · {branding.postalAddress}</> : null}
          </p>
        ) : null}
      </section>
    </div>
  );
}
