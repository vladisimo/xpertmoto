import type { Metadata } from "next";
import Image from "next/image";

import { Button } from "@/components/ui/button";
import { DividedTitle } from "@/components/marketing/divided-title";
import { FaqList } from "@/components/marketing/faq-list";
import { getBranding } from "@/lib/branding";
import { buildMetadata } from "@/lib/seo/metadata";

export function generateMetadata(): Promise<Metadata> {
  return buildMetadata({
    title: "Motorcycle & Scooter Servicing, Sydney",
    description:
      "Expert motorcycle and scooter servicing in Sydney. 40+ years combined experience across all makes and models. Transparent pricing, honest work.",
    path: "/mechanic-services",
  });
}

const MECHANICDESK_BOOKING_URL =
  "https://www.mechanicdesk.com.au/online-booking/index.html?token=0074fd638e36e611c13b96453c9bf63981b62bf3";
const WHATSAPP_SERVICE_URL =
  "https://api.whatsapp.com/send?phone=61433880748&text=Hi%2C+I%27d+like+to+book+a+motorcycle+service.";

const PRICING: { type: string; price: string }[] = [
  { type: "Scooters up to 200cc", price: "From $120" },
  { type: "All scooters above 200cc", price: "From $180" },
  { type: "Motorcycles up to 400cc", price: "From $180" },
  { type: "Motorcycles 400–700cc", price: "From $220" },
  { type: "Motorcycles 700–1000cc", price: "From $250" },
  { type: "Motorcycles 1000+cc", price: "From $280" },
];

const REPAIR_PHOTOS = [
  "/mechanic/repair1.webp",
  "/mechanic/repair3.webp",
  "/mechanic/repair4.webp",
  "/mechanic/repair6.webp",
  "/mechanic/repair7.webp",
  "/mechanic/repair8.webp",
  "/mechanic/repair9.webp",
  "/mechanic/repair10.webp",
];

const BRAND_LOGOS = [
  { name: "Honda", src: "/mechanic/brands/honda.png" },
  { name: "Yamaha", src: "/mechanic/brands/yamaha.png" },
  { name: "Kawasaki", src: "/mechanic/brands/kawasaki.jpg" },
  { name: "Suzuki", src: "/mechanic/brands/suzuki.jpg" },
  { name: "Ducati", src: "/mechanic/brands/ducati.png" },
  { name: "KTM", src: "/mechanic/brands/ktm.png" },
  { name: "BMW", src: "/mechanic/brands/bmw.png" },
  { name: "Triumph", src: "/mechanic/brands/triumph.png" },
  { name: "Royal Enfield", src: "/mechanic/brands/royal-enfield.jpg" },
  { name: "CFMOTO", src: "/mechanic/brands/cfmoto.png" },
];

const DID_YOU_KNOW: { title: string; items: string[] }[] = [
  {
    title: "Maintenance schedules",
    items: [
      "Most bikes need a full service every 6 months or 6,000 km",
      "Chain lubrication every 500–800 km",
      "Engine oil degrades over time — change at least annually",
      "Coolant and brake fluid flushed every 2 years",
      "Spark plugs due at 12,000–24,000 km",
    ],
  },
  {
    title: "The real cost of skipping a service",
    items: [
      "Basic service ($150–$250) prevents $1,000–$3,000+ failures",
      "Worn brake pads → $350–$500 rotor job",
      "Snapped chain → $500–$2,000 repair",
      "Old coolant → $800–$2,500 head gasket failure",
      "Full service history adds $500–$1,500 resale value",
      "Negligent maintenance voids insurance claims",
    ],
  },
  {
    title: "Tyres — Sydney riders' #1 overlooked item",
    items: [
      "5-year expiry from date of manufacture",
      "Under-inflation risk in 40°C+ summer heat",
      "Sport/naked tyres last 5,000–10,000 km",
      "Rear tyres wear 2–3× faster than fronts",
      "Check date codes on the sidewall (last 4 digits)",
    ],
  },
  {
    title: "Riding in Sydney — local conditions",
    items: [
      "Coastal salt air accelerates corrosion",
      "Stop-start riding wears brakes 30–40% faster",
      "Summer heat stresses cooling systems",
      "Wet season increases chain rust",
      "Speed humps affect suspension over time",
    ],
  },
  {
    title: "Smart upgrades worth considering",
    items: [
      "Sintered brake pads",
      "Vibration-dampening handlebar grips",
      "Gel seat inserts or aftermarket seats",
      "USB / USB-C charging ports",
      "Heated grips",
      "Scottoiler automatic chain oiler",
    ],
  },
];

const MECHANIC_FAQS: { q: string; a: string }[] = [
  {
    q: "How do I book a motorcycle service online?",
    a: "Booking is simple — use our online booking form to select your service type, preferred date, and drop-off time. We'll confirm your booking by email. Walk-ins are also welcome during business hours.",
  },
  {
    q: "What are your workshop hours?",
    a: "We're open Monday to Friday 8:30am–4:30pm and Saturday 9:00am–1:00pm. You're welcome to walk in or book online in advance to secure your preferred time slot.",
  },
  {
    q: "What types of motorcycle services do you offer?",
    a: "We handle everything from routine maintenance (oil changes, chain adjustments, tyre replacements) to more complex repairs including brake servicing, engine diagnostics, and electrical faults — covering most makes and models.",
  },
  {
    q: "How long does a motorcycle service take?",
    a: "A standard service typically takes 2–4 hours depending on the work required. For more involved repairs, our team will give you a timeframe when you drop off your bike. We'll keep you updated throughout.",
  },
  {
    q: "Do I need to stay while my bike is being serviced?",
    a: "No — just drop your bike off at our Sydney workshop during opening hours and we'll get to work. We'll contact you once it's ready for pickup.",
  },
  {
    q: "Can I walk in without a booking?",
    a: "Yes, walk-ins are welcome during business hours. However, booking online is recommended to guarantee your preferred time, especially on Saturdays when workshop hours are shorter.",
  },
  {
    q: "Do you offer a motorcycle pickup service?",
    a: "Yes! We offer a pickup service within the Sydney Metro Area for a flat fee of $149 AUD. Pickups are available Monday to Friday, 10:00am–2:00pm. Once your pickup is confirmed and payment is received, our team will collect your bike as soon as scheduling allows. To arrange a pickup, book online or contact us directly.",
  },
];

function ServiceCtas() {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:justify-center">
      <Button asChild variant="cta" size="lg">
        <a href={MECHANICDESK_BOOKING_URL} target="_blank" rel="noopener noreferrer">
          Book a service ➔
        </a>
      </Button>
      <Button asChild variant="secondary" size="lg">
        <a href={WHATSAPP_SERVICE_URL} target="_blank" rel="noopener noreferrer">
          WhatsApp us
        </a>
      </Button>
    </div>
  );
}

export default async function MechanicServicesPage() {
  const { siteName } = await getBranding();
  return (
    <>
      {/* Hero */}
      <section className="relative isolate">
        <div className="relative h-[60vh] min-h-[420px] w-full overflow-hidden">
          <Image
            src="/mechanic/repair1.webp"
            alt={`Motorcycle being serviced in the ${siteName} workshop`}
            fill
            priority
            sizes="100vw"
            className="object-cover"
          />
          <div aria-hidden className="absolute inset-0 bg-foreground/55" />
          <div className="container relative z-10 flex h-full flex-col items-center justify-center text-center text-background">
            <span className="eyebrow text-background/80">{`${siteName} Mechanic`}</span>
            <h1 className="h-display mt-3 max-w-3xl text-background">
              Your bike deserves the best.
            </h1>
            <p className="mt-6 max-w-3xl text-lg text-background/90">
              At our workshop, your bike is in expert hands. Our mechanics bring over 40 years of
              combined experience working across all makes and models, so no matter what you ride,
              we know how to keep it performing at its best.
            </p>
          </div>
        </div>
      </section>

      {/* Workshop gallery */}
      <section className="container py-20">
        <DividedTitle>Inside the workshop</DividedTitle>
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {REPAIR_PHOTOS.map((src) => (
            <div
              key={src}
              className="relative aspect-square overflow-hidden rounded-md border border-border bg-muted"
            >
              <Image
                src={src}
                alt={`${siteName} workshop`}
                fill
                sizes="(min-width: 1024px) 25vw, (min-width: 640px) 50vw, 100vw"
                className="object-cover"
              />
            </div>
          ))}
        </div>
      </section>

      {/* Service pricing */}
      <section className="bg-muted py-20">
        <div className="container max-w-4xl">
          <DividedTitle>What a service costs</DividedTitle>
          <p className="mt-4 text-center text-muted-foreground">
            Transparent, upfront pricing. No surprises.
          </p>
          <div className="mt-12 overflow-hidden rounded-lg border border-border bg-background">
            <table className="w-full">
              <thead className="bg-muted text-left text-sm uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-6 py-4 font-medium">Bike type</th>
                  <th className="px-6 py-4 text-right font-medium">Starting price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {PRICING.map((row) => (
                  <tr key={row.type}>
                    <td className="px-6 py-4 font-medium text-foreground">{row.type}</td>
                    <td className="px-6 py-4 text-right text-lg font-semibold text-foreground">
                      {row.price}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            Prices are indicative and in AUD. Final cost may vary depending on bike make, model,
            and condition. Labour included.
          </p>
          <div className="mt-10">
            <ServiceCtas />
          </div>
        </div>
      </section>

      {/* Did you know */}
      <section className="container py-20">
        <DividedTitle>Did you know?</DividedTitle>
        <p className="mx-auto mt-4 max-w-2xl text-center text-muted-foreground">
          Everything Sydney riders should know about keeping their bike safe, reliable, and
          road-ready.
        </p>
        <div className="mt-12 grid gap-6 md:grid-cols-2">
          {DID_YOU_KNOW.map((section) => (
            <div
              key={section.title}
              className="rounded-lg border border-border bg-card p-8 text-card-foreground"
            >
              <h3 className="h3">{section.title}</h3>
              <ul className="mt-4 space-y-2 text-muted-foreground">
                {section.items.map((item) => (
                  <li key={item} className="flex gap-3">
                    <span
                      aria-hidden
                      className="mt-2 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-secondary"
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Brand support */}
      <section className="bg-muted py-20">
        <div className="container">
          <DividedTitle>Xpert with every brand</DividedTitle>
          <div className="mt-12 grid grid-cols-2 gap-8 sm:grid-cols-3 md:grid-cols-5">
            {BRAND_LOGOS.map((brand) => (
              <div
                key={brand.name}
                className="flex aspect-[3/2] items-center justify-center rounded-md border border-border bg-background p-6"
              >
                <Image
                  src={brand.src}
                  alt={brand.name}
                  width={140}
                  height={80}
                  className="h-auto max-h-full w-auto max-w-full object-contain grayscale transition-all hover:grayscale-0"
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* FAQs */}
      <section className="container py-20">
        <div className="mx-auto max-w-4xl">
          <DividedTitle>{`FAQs about ${siteName} mechanic services`}</DividedTitle>
          <div className="mt-12">
            <FaqList items={MECHANIC_FAQS} />
          </div>
        </div>
      </section>

      {/* Ready to book */}
      <section className="bg-foreground text-background">
        <div className="container py-16 text-center">
          <h2 className="h1 text-background">Ready to book?</h2>
          <p className="mx-auto mt-3 max-w-xl text-background/70">
            Your bike is more than a ride, it&rsquo;s your freedom. At {siteName}, we handle
            everything from quick check-ups to full repairs.
          </p>
          <div className="mt-8">
            <ServiceCtas />
          </div>
        </div>
      </section>
    </>
  );
}
