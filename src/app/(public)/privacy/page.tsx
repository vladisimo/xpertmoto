import type { Metadata } from "next";
import Link from "next/link";
import { getBranding } from "@/lib/branding";
import { buildMetadata } from "@/lib/seo/metadata";

export async function generateMetadata(): Promise<Metadata> {
  const { legalName } = await getBranding();
  return buildMetadata({
    title: "Privacy Policy",
    description: `How ${legalName} collects, uses, stores and discloses personal information under the Australian Privacy Principles.`,
    path: "/privacy",
  });
}

const VERSION = "2.0";
const EFFECTIVE_DATE = "21 April 2026";

export default async function PrivacyPage() {
  const branding = await getBranding();
  const { siteName, legalName, abn, privacyEmail, postalAddress } = branding;
  const abnLabel = abn ? ` (ABN ${abn})` : "";

  return (
    <div className="container max-w-3xl py-12">
      <header className="space-y-2">
        <p className="eyebrow text-muted-foreground">Legal</p>
        <h1 className="h-display">Privacy Policy</h1>
        <p className="body-text text-muted-foreground">
          Version {VERSION} — effective {EFFECTIVE_DATE}
        </p>
      </header>

      <section className="mt-10 space-y-6 text-sm leading-relaxed">
        <p>
          This Privacy Policy explains how {legalName}
          {abnLabel} (&ldquo;{siteName}&rdquo;, &ldquo;we&rdquo;,
          &ldquo;us&rdquo;, &ldquo;our&rdquo;) handles your personal
          information. We are bound by the{" "}
          <em>Privacy Act 1988</em> (Cth) and the thirteen Australian Privacy
          Principles (APPs) set out in Schedule 1 to that Act. Each section
          below addresses a single APP so you can see exactly how we meet our
          obligations.
        </p>
        <p>
          For a summary of our technical security controls, see our{" "}
          <Link href="/trust" className="underline hover:text-foreground">
            Trust &amp; Security page
          </Link>
          .
        </p>

        <h2 className="h3">APP 1 — Open and transparent management</h2>
        <p>
          This policy is published on our website and is available free of
          charge. Our Privacy Officer is the point of contact for any privacy
          question, access request, correction request or complaint:
        </p>
        <ul className="list-disc pl-6">
          {privacyEmail ? (
            <li>
              Email:{" "}
              <a
                href={`mailto:${privacyEmail}`}
                className="underline hover:text-foreground"
              >
                {privacyEmail}
              </a>
            </li>
          ) : (
            <li>
              Email: see our{" "}
              <Link
                href="/contact"
                className="underline hover:text-foreground"
              >
                contact page
              </Link>
            </li>
          )}
          {postalAddress ? (
            <li>Post: {postalAddress}</li>
          ) : (
            <li>
              Post: the registered office of {legalName}
              {abnLabel}
            </li>
          )}
        </ul>
        <p>
          We review this policy at least annually and whenever our practices
          change materially. Prior versions are preserved on request.
        </p>

        <h2 className="h3">APP 2 — Anonymity and pseudonymity</h2>
        <p>
          You may browse our public website, fleet pages, pricing and
          locations anonymously. We do not require you to identify yourself
          to read information about our services. To make a booking, ride
          insurance, or hold a bond, we must identify you — this is required
          by the <em>Road Transport Acts</em> of each state in which we
          operate, our insurer, and our obligations under the{" "}
          <em>Anti-Money Laundering and Counter-Terrorism Financing Act 2006</em>{" "}
          (Cth) in relation to payment processing.
        </p>

        <h2 className="h3">APP 3 — Collection of solicited personal information</h2>
        <p>
          We collect only the personal information reasonably necessary to
          provide our vehicle hire services. Specifically:
        </p>
        <ul className="list-disc pl-6">
          <li>
            <strong>Identity and contact:</strong> name, email address, mobile
            phone number, date of birth, residential address.
          </li>
          <li>
            <strong>Driver licence:</strong> licence number, issuing state,
            class, expiry date, and a photograph of the front and back of the
            licence. Required to verify your legal entitlement to ride.
          </li>
          <li>
            <strong>Passport (optional, overseas visitors):</strong> passport
            number, country of issue, expiry and a photograph where the
            licence alone is insufficient for identification.
          </li>
          <li>
            <strong>Emergency contact:</strong> name, phone number and
            relationship to you, for use in the event of an accident during
            your hire.
          </li>
          <li>
            <strong>Booking and rental records:</strong> pickup and return
            depot, dates and times, vehicle assigned, odometer readings, fuel
            level, pre- and post-hire inspection notes and photographs, and
            your digital signature on the rental agreement.
          </li>
          <li>
            <strong>Payment information:</strong> billing details and
            tokenised payment method references processed by our payment
            provider, Stripe. We never store full card numbers, CVV codes or
            card-not-present credentials on our systems.
          </li>
          <li>
            <strong>Device and usage data:</strong> IP address, browser and
            device identifiers, pages viewed, and cookie data when you use
            the site.
          </li>
          <li>
            <strong>Communications:</strong> records of emails, SMS messages
            and phone calls between you and our team.
          </li>
          <li>
            <strong>Incidents and infringements:</strong> accident reports,
            damage photographs, police and insurance reference numbers, and
            any traffic or parking infringement notices issued in respect of
            a vehicle you hired.
          </li>
          <li>
            <strong>Marketing preferences:</strong> your email and SMS
            marketing opt-in status, recorded explicitly, defaulting to
            off.
          </li>
        </ul>

        <h2 className="h3">APP 4 — Dealing with unsolicited personal information</h2>
        <p>
          If we receive personal information we did not ask for and could not
          have collected under APP 3, we will, within a reasonable time,
          destroy or de-identify it unless we are required by law or a court
          order to retain it or it is otherwise contained in a Commonwealth
          record.
        </p>

        <h2 className="h3">APP 5 — Notification of collection</h2>
        <p>
          When we collect personal information directly from you, we take
          reasonable steps to make you aware of: our identity and contact
          details, the purposes of collection, the consequences of not
          providing the information, the types of organisations we may
          disclose it to, and the fact that this policy contains
          information about how to access, correct or complain about our
          handling of your personal information. For website and booking
          flows, this notice is provided at the point of collection. For
          telephone or in-person collection, it is provided verbally or in
          the rental agreement you sign.
        </p>

        <h2 className="h3">APP 6 — Use or disclosure of personal information</h2>
        <p>
          We use your personal information only for the primary purpose for
          which it was collected — providing our hire services — or for a
          secondary purpose you would reasonably expect and that is related
          to the primary purpose. This includes:
        </p>
        <ul className="list-disc pl-6">
          <li>Processing bookings, payments, bond holds and releases, and issuing tax invoices;</li>
          <li>Verifying your identity, age and licence before a vehicle is handed over;</li>
          <li>Sending booking confirmations, reminders and return notifications;</li>
          <li>Managing incidents, damage claims, infringements and recoveries;</li>
          <li>Meeting our tax, consumer law and insurance obligations;</li>
          <li>Responding to your enquiries and support requests.</li>
        </ul>
        <p>
          We disclose personal information only where necessary for these
          purposes or where required by law, including to Stripe (payment
          processing), Twilio (SMS), our email provider, our cloud
          infrastructure providers, insurers and assessors in the event of
          damage, theft or accident, state transport authorities where
          infringements must be nominated, and police or regulators in
          response to a lawful request. We do not sell your personal
          information.
        </p>

        <h2 className="h3">APP 7 — Direct marketing</h2>
        <p>
          We send marketing communications (offers, fleet updates,
          promotions) only where you have explicitly opted in. Marketing
          opt-in defaults to off when you register. Every marketing email and
          SMS includes a clear unsubscribe mechanism, and you may also update
          your preferences at any time by signing in to your customer
          dashboard or contacting our Privacy Officer.
        </p>

        <h2 className="h3">APP 8 — Cross-border disclosure</h2>
        <p>
          Some of the service providers we rely on to operate this service
          store or process personal information outside Australia. Before we
          disclose information to them, we take reasonable steps to ensure
          they handle it consistently with the APPs. Our current offshore
          sub-processors include:
        </p>
        <ul className="list-disc pl-6">
          <li>
            <strong>Stripe, Inc.</strong> (United States, European Union):
            payment processing and bond authorisation.
          </li>
          <li>
            <strong>Twilio, Inc.</strong> (United States): SMS and messaging
            delivery.
          </li>
          <li>
            <strong>Resend, Inc.</strong> (United States): transactional
            email delivery.
          </li>
          <li>
            <strong>Sentry, Inc. / Functional Software, Inc.</strong> (United
            States): application error monitoring.
          </li>
          <li>
            <strong>Amazon Web Services, Inc.</strong> (Australia, with
            replication depending on the service tier): object storage and
            application hosting.
          </li>
        </ul>
        <p>
          We select providers with equivalent privacy and security
          safeguards. Where processing occurs in jurisdictions with privacy
          frameworks different from the APPs, contractual safeguards cover
          the gap.
        </p>

        <h2 className="h3">APP 9 — Government identifiers</h2>
        <p>
          We collect driver licence numbers and (for visitors who do not hold
          an Australian licence) passport numbers solely to verify your
          identity and legal entitlement to ride. We do not use these
          government identifiers as our own internal identifier for you; our
          systems key customer records to an internally generated identifier.
          We do not disclose government identifiers except as required by
          law or to our insurer in connection with a claim.
        </p>

        <h2 className="h3">APP 10 — Quality of personal information</h2>
        <p>
          We take reasonable steps to ensure that the personal information we
          collect, use and disclose is accurate, up to date, complete and
          relevant. You can review and update most of your personal
          information through your customer dashboard. For fields you cannot
          edit directly — licence details, for example — contact our Privacy
          Officer and we will correct the record.
        </p>

        <h2 className="h3">APP 11 — Security of personal information</h2>
        <p>
          We hold personal information in access-controlled systems and
          protect it with the following measures:
        </p>
        <ul className="list-disc pl-6">
          <li>
            <strong>Encryption:</strong> TLS in transit across all public
            endpoints (with HTTP Strict Transport Security); licence and
            passport numbers are additionally encrypted at the application
            layer using AES-256-GCM with keys managed outside the database.
          </li>
          <li>
            <strong>Access control:</strong> role-based access, with
            multi-factor authentication enforced for all staff and
            administrator accounts. All access to customer records is
            audit-logged.
          </li>
          <li>
            <strong>Payment data:</strong> full card numbers and CVV codes
            never reach our servers. Payments are processed directly by
            Stripe, a PCI-DSS Level 1 certified provider.
          </li>
          <li>
            <strong>Backups:</strong> nightly encrypted backups with a
            30-day retention window.
          </li>
          <li>
            <strong>Breach response:</strong> we maintain a written Data
            Breach Response Plan aligned with the Notifiable Data Breaches
            scheme under Part IIIC of the <em>Privacy Act 1988</em> (Cth).
            See the <Link href="/trust" className="underline hover:text-foreground">Trust &amp; Security</Link> page for more.
          </li>
        </ul>
        <p>
          We retain personal information only as long as reasonably required
          for the purpose for which it was collected or as required by
          Australian tax, consumer protection and transport law. Financial
          and tax records are retained for seven years in line with
          obligations under the{" "}
          <em>Income Tax Assessment Act 1997</em> (Cth) and{" "}
          <em>A New Tax System (Goods and Services Tax) Act 1999</em> (Cth).
          When information is no longer needed and no legal retention
          obligation applies, we destroy or de-identify it.
        </p>

        <h2 className="h3">APP 12 — Access to personal information</h2>
        <p>
          You have a right to request access to the personal information we
          hold about you. Submit a request to our Privacy Officer using the
          contact details in APP 1. We will respond within 30 days, usually
          by providing a copy of your record at no charge. In limited
          circumstances we may be permitted or required to refuse access
          (for example, where disclosure would unreasonably impact the
          privacy of another person). If we refuse, we will set out the
          reasons in writing and explain how to complain.
        </p>

        <h2 className="h3">APP 13 — Correction of personal information</h2>
        <p>
          If the personal information we hold about you is inaccurate, out
          of date, incomplete, irrelevant or misleading, you may ask us to
          correct it. We will respond to correction requests within 30 days.
          Where we have disclosed the information to a third party, we will,
          if you ask, take reasonable steps to notify that third party of
          the correction, unless it is impracticable or unlawful to do so.
        </p>

        <h2 className="h3">Complaints</h2>
        <p>
          If you believe we have breached the APPs or mishandled your
          personal information, please contact our Privacy Officer first. We
          will acknowledge your complaint within five business days and aim
          to resolve it within 30 days. If you are not satisfied with our
          response, you may lodge a complaint with the Office of the
          Australian Information Commissioner at{" "}
          <a
            href="https://www.oaic.gov.au/"
            className="underline hover:text-foreground"
            rel="noreferrer noopener"
            target="_blank"
          >
            oaic.gov.au
          </a>
          .
        </p>

        <h2 className="h3">Cookies and analytics</h2>
        <p>
          We use cookies and similar technologies to keep you signed in,
          remember your booking progress and measure site performance. You
          can disable cookies in your browser, but some parts of the booking
          flow may stop working.
        </p>

        <h2 className="h3">Children</h2>
        <p>
          Our services are not intended for people under the minimum
          licensing age for the vehicle categories we hire. We do not
          knowingly collect personal information from minors outside a
          parent- or guardian-supervised booking.
        </p>

        <h2 className="h3">Changes to this policy</h2>
        <p>
          We may update this policy from time to time. The current version
          and its effective date are always shown at the top of this page.
          Material changes will be communicated through a notice on the
          site. Previous versions are retained internally and available on
          request.
        </p>

        <h2 className="h3">Version history</h2>
        <ul className="list-disc pl-6">
          <li>
            <strong>2.0</strong> — {EFFECTIVE_DATE}. Restructured into
            thirteen APP-indexed sections; added explicit offshore
            sub-processor list, security control summary, and complaint
            handling timeframe.
          </li>
          <li>
            <strong>1.0</strong> — April 2026. Initial policy.
          </li>
        </ul>
      </section>
    </div>
  );
}
