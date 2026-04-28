import type { Metadata } from "next";
import Link from "next/link";
import { getBranding } from "@/lib/branding";

export async function generateMetadata(): Promise<Metadata> {
  const { siteName } = await getBranding();
  return {
    title: `Trust & Security | ${siteName}`,
    description: `How ${siteName} protects your data: Essential Eight maturity, encryption, access controls, backups, and breach response.`,
  };
}

const LAST_REVIEWED = "21 April 2026";
const NEXT_REVIEW = "21 April 2027";

interface ControlRow {
  n: number;
  name: string;
  maturity: string;
  evidence: string;
}

const CONTROLS: ControlRow[] = [
  {
    n: 1,
    name: "Application control",
    maturity: "ML2 (cloud-interpreted)",
    evidence:
      "Dependency audit runs on every CI build (npm audit at high severity fails the pipeline). All production dependencies are pinned via package-lock.json. Server-side code runs only from the built, signed deployment artefact.",
  },
  {
    n: 2,
    name: "Patch applications",
    maturity: "ML2",
    evidence:
      "Continuous dependency monitoring through automated vulnerability scans in CI. Critical and high-severity patches are deployed within service SLAs; the managed hosting provider patches the underlying runtime automatically.",
  },
  {
    n: 3,
    name: "Configure Microsoft Office macro settings",
    maturity: "Not applicable",
    evidence:
      "No Microsoft Office, server-side macro execution, or user-authored script environments exist in the production stack. The control does not apply.",
  },
  {
    n: 4,
    name: "User application hardening",
    maturity: "ML1 (moving to ML2)",
    evidence:
      "Strict transport security (HSTS, two-year preload), clickjacking protection (X-Frame-Options), MIME-sniffing protection, strict referrer policy, and a comprehensive Content Security Policy are enforced site-wide. Known gap: CSP is currently in report-only mode; enforcement is on the roadmap.",
  },
  {
    n: 5,
    name: "Restrict administrative privileges",
    maturity: "ML3",
    evidence:
      "Five-role access model (Customer, Staff, Manager, Admin, Super Admin) enforced at both the route and API layers. Privileged actions require multi-factor authentication, are fully audit-logged, and support impersonation only by Super Admins with separate signed tokens.",
  },
  {
    n: 6,
    name: "Patch operating systems",
    maturity: "ML2",
    evidence:
      "Operating system and container base-image patching is handled continuously by the managed hosting provider. Internal Docker images used for auxiliary workers are rebuilt on a defined cadence against the latest upstream security releases.",
  },
  {
    n: 7,
    name: "Multi-factor authentication",
    maturity: "ML3 for staff · ML2 for customers",
    evidence:
      "Staff and administrator accounts require TOTP multi-factor authentication with recovery codes. Customer accounts may enable TOTP optionally and all authentication is protected by per-IP rate limiting and automatic lockout after repeated failures.",
  },
  {
    n: 8,
    name: "Regular backups",
    maturity: "ML2",
    evidence:
      "Encrypted database backups run nightly and are streamed to object storage with a 30-day retention window. Backup job status is recorded and alerts are raised on failure. Known gap: a documented quarterly restore drill is on the roadmap.",
  },
];

export default async function TrustPage() {
  const branding = await getBranding();
  const { siteName, legalName, abn, privacyEmail } = branding;
  const abnLabel = abn ? `ABN ${abn}` : "";

  return (
    <div className="container max-w-3xl py-12">
      <header className="space-y-2">
        <p className="eyebrow text-muted-foreground">Compliance</p>
        <h1 className="h-display">Trust &amp; Security</h1>
        <p className="body-text text-muted-foreground">
          How {siteName} protects the personal information and payment data
          entrusted to us. Self-assessed against the ACSC Essential Eight
          maturity model.
        </p>
      </header>

      <section className="mt-10 space-y-4 text-sm leading-relaxed">
        <h2 className="h3">Platform provider</h2>
        <p>
          The {siteName} platform is a{" "}
          <span className="font-medium">dFortix.ai</span> product, published by{" "}
          <span className="font-medium">Mercury Road Equipment Pty Ltd</span>{" "}
          (ABN 36 614 422 187). {legalName}
          {abnLabel ? ` (${abnLabel})` : ""} operates this deployment as the
          data controller for its customers&apos; personal information; Mercury
          Road Equipment Pty Ltd is the software vendor responsible for the
          platform&apos;s technical security controls described below.
        </p>
      </section>

      <section className="mt-10 space-y-4 text-sm leading-relaxed">
        <h2 className="h3">Essential Eight self-assessment</h2>
        <p>
          The following is our honest, self-assessed maturity against each of
          the eight mitigation strategies published by the Australian Cyber
          Security Centre (ACSC). Where a control was designed for legacy
          Windows enterprise environments, we document the cloud-native
          equivalent we enforce.
        </p>

        <div className="mt-4 overflow-hidden rounded-md border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead className="bg-primary text-primary-foreground">
                <tr>
                  <th
                    scope="col"
                    className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80"
                  >
                    #
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80"
                  >
                    Control
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80"
                  >
                    Maturity
                  </th>
                  <th
                    scope="col"
                    className="px-4 py-2 text-xs font-semibold uppercase tracking-wide text-primary-foreground/80"
                  >
                    Evidence
                  </th>
                </tr>
              </thead>
              <tbody className="bg-card">
                {CONTROLS.map((c) => (
                  <tr
                    key={c.n}
                    className="border-t border-border align-top"
                  >
                    <td className="px-4 py-3 text-muted-foreground">{c.n}</td>
                    <td className="px-4 py-3 font-medium">{c.name}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{c.maturity}</td>
                    <td className="px-4 py-3">{c.evidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <p className="mt-6 text-caption text-muted-foreground">
          Overall self-assessed position:{" "}
          <span className="font-medium text-foreground">
            Essential Eight Maturity Level 2
          </span>{" "}
          across applicable controls, with two declared known gaps (below).
          Self-assessment is not a substitute for a third-party IRAP
          assessment; where a customer or counterparty requires independent
          attestation, we can engage a qualified assessor on request.
        </p>
      </section>

      <section className="mt-10 space-y-4 text-sm leading-relaxed">
        <h2 className="h3">Known gaps</h2>
        <p>
          We surface gaps we are aware of rather than leave them implicit. Each
          is tracked in our internal security backlog with an owner.
        </p>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            Content Security Policy is enforced in report-only mode. We
            actively review reported violations and plan to move to enforcing
            mode once allow-listing is stable across third-party integrations
            (Stripe, map tiles, Sentry).
          </li>
          <li>
            A documented quarterly restore drill from backup is on the
            roadmap. Backups themselves run nightly and are monitored for
            success.
          </li>
        </ul>
      </section>

      <section className="mt-10 space-y-4 text-sm leading-relaxed">
        <h2 className="h3">Data breach response</h2>
        <p>
          We maintain a written Data Breach Response Plan covering detection,
          triage, containment, notification and post-incident review. If we
          become aware of a data breach that is likely to result in serious
          harm to affected individuals, we will assess it within the
          thirty-day statutory window set by section 26WF of the{" "}
          <em>Privacy Act 1988</em> (Cth), notify the Office of the Australian
          Information Commissioner and affected individuals as soon as
          practicable thereafter, and keep our customers informed throughout.
        </p>
        <p>
          See our{" "}
          <Link href="/privacy" className="underline hover:text-foreground">
            Privacy Policy
          </Link>{" "}
          for the access, correction and complaint channels available to
          individuals whose personal information we hold.
        </p>
      </section>

      <section className="mt-10 space-y-4 text-sm leading-relaxed">
        <h2 className="h3">Responsible disclosure</h2>
        <p>
          If you believe you have identified a security vulnerability in the{" "}
          {siteName} platform, please contact us in good faith. We commit to
          acknowledging reports within three business days, investigating
          promptly, and not pursuing legal action against researchers who act
          in good faith and stay within the bounds of the{" "}
          <em>Criminal Code Act 1995</em> (Cth).
        </p>
        {privacyEmail ? (
          <p>
            Email:{" "}
            <a
              href={`mailto:${privacyEmail}`}
              className="underline hover:text-foreground"
            >
              {privacyEmail}
            </a>
          </p>
        ) : (
          <p>
            Contact channels are listed on our{" "}
            <Link
              href="/contact"
              className="underline hover:text-foreground"
            >
              contact page
            </Link>
            .
          </p>
        )}
      </section>

      <footer className="mt-12 border-t border-border pt-6 text-caption text-muted-foreground">
        <p>
          Self-assessment last reviewed: {LAST_REVIEWED}. Next scheduled
          review: {NEXT_REVIEW}.
        </p>
      </footer>
    </div>
  );
}
