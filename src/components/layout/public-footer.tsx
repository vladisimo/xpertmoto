import Link from "next/link";
import { cacheLife, cacheTag } from "next/cache";
import { Facebook, Instagram, Mail, MapPin, Phone, Youtube } from "lucide-react";
import { BrandLogo } from "@/components/shared/brand-logo";
import { PublicFooterShell } from "@/components/layout/public-footer-shell";
import { PAYMENT_METHODS } from "@/components/layout/payment-icons";
import { getBranding } from "@/lib/branding";

export async function PublicFooter() {
  "use cache";
  cacheLife("days");
  cacheTag("branding");
  const { legalName, abn, supportEmail, supportPhone, postalAddress, social } =
    await getBranding();
  const year = new Date().getFullYear();
  const copyright = [
    `© ${year}`,
    legalName ? ` ${legalName}.` : "",
    abn ? ` ABN: ${abn}` : "",
  ]
    .join("")
    .trim();

  return (
    <PublicFooterShell>
      <div className="container grid grid-cols-2 gap-x-6 gap-y-8 py-12 md:grid-cols-2 md:gap-10 lg:grid-cols-12 lg:gap-8">
        <div className="col-span-2 space-y-4 md:col-span-2 lg:col-span-4">
          <BrandLogo variant="inverse" height={38} />
          <ul className="space-y-2 text-sm text-background/75">
            {postalAddress ? (
              <li className="flex items-start gap-2">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-secondary" aria-hidden="true" />
                <span>{postalAddress}</span>
              </li>
            ) : null}
            {supportPhone ? (
              <li className="flex items-center gap-2">
                <Phone className="h-4 w-4 shrink-0 text-secondary" aria-hidden="true" />
                <a
                  href={`tel:${supportPhone.replace(/\s+/g, "")}`}
                  className="transition-colors hover:text-secondary"
                >
                  {supportPhone}
                </a>
              </li>
            ) : null}
            {supportEmail ? (
              <li className="flex items-center gap-2 pt-1">
                <Mail className="h-4 w-4 shrink-0 text-secondary" aria-hidden="true" />
                <a
                  href={`mailto:${supportEmail}`}
                  className="text-secondary underline-offset-4 hover:underline"
                >
                  {supportEmail}
                </a>
              </li>
            ) : null}
          </ul>
        </div>

        <FooterColumn
          title="Learn More"
          className="lg:col-span-2"
          links={[
            { href: "/faq", label: "FAQs" },
            { href: "/reviews", label: "Reviews" },
            { href: "/contact", label: "About Us" },
            { href: "/contact", label: "Contact Us" },
          ]}
        />

        <FooterColumn
          title="Legal"
          className="lg:col-span-3"
          links={[
            { href: "/privacy", label: "Privacy Policy" },
            { href: "/terms", label: "Rental Terms & Conditions" },
            { href: "/terms", label: "Terms Of Service" },
            { href: "/refund-policy", label: "Refund & Cancellation Policy" },
          ]}
        />

        <FooterColumn
          title="Services"
          className="lg:col-span-2"
          links={[
            { href: "/fleet", label: "Motorcycle Rentals" },
            { href: "/tours", label: "Motorcycle Tours" },
            { href: "/mechanic-services", label: "Motorcycle Mechanic" },
            { href: "/gift-cards", label: "Online Moto Gear Shop" },
          ]}
        />

        <div className="lg:col-span-1">
          <FooterHeading>Stay In Touch</FooterHeading>
          <ul className="flex flex-wrap gap-2">
            {social.facebook ? (
              <SocialIcon href={social.facebook} label="Facebook">
                <Facebook className="h-4 w-4" aria-hidden="true" />
              </SocialIcon>
            ) : null}
            {social.instagram ? (
              <SocialIcon href={social.instagram} label="Instagram">
                <Instagram className="h-4 w-4" aria-hidden="true" />
              </SocialIcon>
            ) : null}
            {social.tiktok ? (
              <SocialIcon href={social.tiktok} label="TikTok">
                <TikTokIcon />
              </SocialIcon>
            ) : null}
            {social.youtube ? (
              <SocialIcon href={social.youtube} label="YouTube">
                <Youtube className="h-4 w-4" aria-hidden="true" />
              </SocialIcon>
            ) : null}
          </ul>
        </div>
      </div>

      <div className="border-t border-background/10">
        <div className="container flex flex-col-reverse items-start gap-4 py-4 md:flex-row md:items-center md:justify-between">
          <p className="text-xs text-background/60">{copyright}</p>
          <PaymentBadges />
        </div>
      </div>
    </PublicFooterShell>
  );
}

function FooterHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-3 text-xs font-semibold uppercase tracking-[0.14em] text-secondary">
      {children}
    </div>
  );
}

function FooterColumn({
  title,
  links,
  className,
}: {
  title: string;
  links: Array<{ href: string; label: string }>;
  className?: string;
}) {
  return (
    <div className={className}>
      <FooterHeading>{title}</FooterHeading>
      <ul className="space-y-2 text-sm">
        {links.map((l) => (
          <li key={`${l.href}-${l.label}`}>
            <Link
              href={l.href}
              className="text-background/75 transition-colors hover:text-secondary"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SocialIcon({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <li>
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        aria-label={label}
        className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-background text-foreground transition-colors hover:bg-secondary hover:text-secondary-foreground"
      >
        {children}
      </a>
    </li>
  );
}

function TikTokIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-4 w-4"
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M19.6 6.7a5.2 5.2 0 0 1-3.1-1 5.2 5.2 0 0 1-2.1-3.3h-3v13.1a2.6 2.6 0 1 1-1.9-2.5v-3a5.6 5.6 0 1 0 4.9 5.5V9.6a8 8 0 0 0 5.2 1.8v-3A5.2 5.2 0 0 1 19.6 6.7Z" />
    </svg>
  );
}

function PaymentBadges() {
  return (
    <ul className="flex flex-wrap items-center gap-1.5" aria-label="Accepted payment methods">
      {PAYMENT_METHODS.map(({ name, Icon }) => (
        <li
          key={name}
          title={name}
          className="flex h-6 w-10 items-center justify-center rounded-[4px] bg-white px-1 shadow-sm ring-1 ring-background/10"
        >
          <Icon className="h-full w-auto max-w-full" />
          <span className="sr-only">{name}</span>
        </li>
      ))}
    </ul>
  );
}
