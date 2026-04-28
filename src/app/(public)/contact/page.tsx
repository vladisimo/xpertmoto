import Link from "next/link";
import { Mail, Phone, MapPin } from "lucide-react";
import { prisma } from "@/lib/prisma";
import { getBranding } from "@/lib/branding";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

const telHref = (value: string) => `tel:${value.replace(/[^+\d]/g, "")}`;

export default async function ContactPage() {
  const [branding, depots] = await Promise.all([
    getBranding(),
    prisma.depot.findMany({
      where: { isActive: true, deletedAt: null },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        addressLine1: true,
        addressLine2: true,
        suburb: true,
        state: true,
        postcode: true,
        phone: true,
        email: true,
      },
    }),
  ]);

  return (
    <div className="container max-w-5xl py-12">
      <h1 className="h-display">Contact us</h1>
      <p className="mt-2 text-muted-foreground">
        We&apos;re here to help seven days a week.
      </p>

      <section className="mt-10 rounded-lg border bg-card p-6 text-card-foreground">
        <div className="h3">{branding.siteName} head office</div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {branding.supportPhone && (
            <div className="flex items-start gap-3">
              <Phone className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Phone
                </div>
                <a
                  href={telHref(branding.supportPhone)}
                  className="text-sm font-medium hover:underline"
                >
                  {branding.supportPhone}
                </a>
              </div>
            </div>
          )}
          {branding.supportEmail && (
            <div className="flex items-start gap-3">
              <Mail className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Email
                </div>
                <a
                  href={`mailto:${branding.supportEmail}`}
                  className="text-sm font-medium hover:underline"
                >
                  {branding.supportEmail}
                </a>
              </div>
            </div>
          )}
          {branding.postalAddress && (
            <div className="flex items-start gap-3 sm:col-span-2">
              <MapPin className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div>
                <div className="text-xs uppercase tracking-wide text-muted-foreground">
                  Postal address
                </div>
                <div className="text-sm font-medium">{branding.postalAddress}</div>
              </div>
            </div>
          )}
        </div>
      </section>

      {depots.length > 0 && (
        <section className="mt-10">
          <h2 className="h2">Our depots</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Prefer to talk to a local? Reach your nearest depot directly.
          </p>

          <div className="mt-6 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {depots.map((d) => {
              const phone = d.phone ?? branding.supportPhone;
              const email = d.email ?? branding.supportEmail;
              return (
                <Card key={d.id}>
                  <CardHeader>
                    <CardTitle>{d.name}</CardTitle>
                    <CardDescription>
                      {d.addressLine1}
                      {d.addressLine2 ? `, ${d.addressLine2}` : ""}
                      <br />
                      {d.suburb} {d.state} {d.postcode}
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {phone && (
                      <div className="flex items-center gap-2">
                        <Phone className="h-4 w-4 text-muted-foreground" />
                        <a href={telHref(phone)} className="hover:underline">
                          {phone}
                        </a>
                      </div>
                    )}
                    {email && (
                      <div className="flex items-center gap-2">
                        <Mail className="h-4 w-4 text-muted-foreground" />
                        <a href={`mailto:${email}`} className="hover:underline">
                          {email}
                        </a>
                      </div>
                    )}
                    <Button asChild variant="secondary" size="sm" className="mt-4 w-full">
                      <Link href={`/locations#${d.id}`}>View depot</Link>
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}
