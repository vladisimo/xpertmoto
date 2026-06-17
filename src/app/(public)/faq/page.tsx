import { ChevronDown } from "lucide-react";
import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/metadata";
import { faqPageLd } from "@/lib/seo/json-ld";
import { JsonLd } from "@/components/seo/json-ld";

export function generateMetadata(): Promise<Metadata> {
  return buildMetadata({
    title: "FAQ",
    description:
      "Answers to common questions about scooter & motorbike hire — licences, insurance, bonds, age limits, pickup and returns.",
    path: "/faq",
  });
}

type FAQ = { q: string; a: string };
type FAQSection = { heading: string; intro?: string; items: FAQ[] };

const GENERAL: FAQ[] = [
  {
    q: "What licence do I need?",
    a: "A valid Australian or international driver's licence. 50cc scooters can be ridden on a car licence in QLD. All other categories require an RE or R motorcycle licence.",
  },
  {
    q: "Is insurance included?",
    a: "Yes, basic insurance with a $3,000 excess is included. You can reduce the excess by selecting Standard ($1,500) or Premium ($0) insurance at checkout.",
  },
  {
    q: "How old do I need to be?",
    a: "Minimum age is 18 for most categories and 21 for 300cc+ scooters. You must also have held your licence for at least 12 months.",
  },
  {
    q: "What's the bond?",
    a: "We place a refundable security hold on your card at pickup ($300–$1000 depending on vehicle). It's released within 14 days of return, assuming no damage.",
  },
  {
    q: "Can I return to a different depot?",
    a: "Yes, one-way rentals are available between Gold Coast, Byron Bay, and Noosa for a flat fee of $99.",
  },
  {
    q: "What if I return late?",
    a: "A one-hour grace period applies. After that, hourly fees accrue up to a full day's rate.",
  },
  {
    q: "Is delivery available?",
    a: "Yes, we deliver within 25km of each depot. $25 within 10km, $45 for 10–25km.",
  },
  {
    q: "Can I extend my booking?",
    a: "Yes, via your customer portal or by calling the depot. Subject to availability.",
  },
];

const ADVENTURE: FAQ[] = [
  {
    q: "Why should I choose an adventure motorcycle rental from Xpert in Sydney?",
    a: "Adventure motorcycles are built for versatility, allowing riders to tackle both on-road and off-road terrains. Renting an adventure motorcycle from Xpert in Sydney gives you access to well-maintained, high-performance bikes that are perfect for any journey. Xpert provides flexible rental options, unlimited kilometers, and expert customer service, making us the best choice for adventure motorcycle rental in Sydney.",
  },
  {
    q: "How can I hire an adventure motorcycle in Sydney with Xpert?",
    a: "Hiring an adventure motorcycle in Sydney with Xpert is easy with our online booking system. In just a few clicks, you can reserve your preferred model and rental period. Xpert offers a range of adventure motorcycles, flexible pickup options, and even doorstep delivery for long-term rentals, ensuring a hassle-free experience when you hire an adventure motorcycle in Sydney.",
  },
  {
    q: "Why is Sydney rent adventure motorbike from Xpert the ideal choice for off-road trips?",
    a: "Sydney rent adventure motorbike services from Xpert are ideal for off-road trips because our bikes are equipped to handle rough terrains and long distances. Adventure motorcycles from Xpert are perfect for those looking to explore beyond the city. With unlimited kilometers, you can venture off-road with confidence, knowing that your adventure motorbike is in peak condition and supported by 24/7 roadside assistance.",
  },
  {
    q: "Why should I hire adventure motorcycle in Sydney from Xpert?",
    a: "Hiring an adventure motorcycle from Xpert in Sydney ensures you get a reliable, high-performance bike for your journey. We offer a wide selection of adventure motorcycles, all maintained by expert mechanics. Xpert provides comprehensive accident cover, unlimited kilometers, and flexible rental terms, making us the best choice for anyone looking to hire adventure motorcycles in Sydney.",
  },
  {
    q: "Can I rent an adventure motorbike for a long-distance trip from Sydney with Xpert?",
    a: "Absolutely! Xpert offers adventure motorbikes designed for long-distance travel, whether you're heading out on an off-road adventure or a long highway trip. Our adventure motorcycles come with features like large fuel tanks and comfortable seating for extended rides. With unlimited kilometers and 24/7 roadside assistance, Xpert makes renting an adventure motorbike for long-distance trips from Sydney easy and convenient.",
  },
  {
    q: "What additional services does Xpert offer for Sydney adventure motorbike rental?",
    a: "Xpert offers several value-added services for Sydney adventure motorbike rental, including unlimited kilometers, comprehensive accident cover, and 24/7 roadside assistance. We also provide free helmets, phone holders, and expert advice to ensure your rental experience is smooth and enjoyable. Whether you're planning a short off-road trip or a long-distance adventure, Xpert has you covered.",
  },
];

const COMMUTING: FAQ[] = [
  {
    q: "Why should I choose a commuting motorcycle rental from Xpert in Sydney?",
    a: "Commuting motorcycles are designed for efficiency, ease of use, and comfort, making them ideal for daily commutes. Renting a commuting motorcycle from Xpert in Sydney offers flexibility, reliability, and competitive pricing. Xpert provides a wide range of well-maintained commuting motorcycles that are perfect for city navigation, with added benefits like unlimited kilometers and flexible rental terms, making us the best choice for commuting motorcycle rental in Sydney.",
  },
  {
    q: "How can I hire a commuting motorcycle in Sydney from Xpert?",
    a: "Hiring a commuting motorcycle from Xpert in Sydney is quick and convenient with our online booking system. You can browse our fleet, select your preferred commuting bike or scooter, and choose the rental duration that fits your needs. Xpert's flexible pickup options and doorstep delivery for long-term rentals ensure a smooth and easy rental process when you hire a commuting motorcycle in Sydney.",
  },
  {
    q: "Why is Sydney rent commuting motorbike from Xpert the ideal choice for city rides?",
    a: "Sydney rent commuting motorbike services from Xpert are ideal for city rides because our bikes and scooters are fuel-efficient, easy to maneuver, and perfect for avoiding traffic. With our well-maintained commuting motorbikes and scooters, you'll be able to navigate Sydney with ease. Additionally, our unlimited kilometers policy means you can commute freely without worrying about distance restrictions.",
  },
  {
    q: "Why is Xpert the best place to hire commuting scooter in Sydney?",
    a: "Xpert is the best place to hire commuting scooters in Sydney because we offer a wide selection of scooters designed specifically for urban commuting. Our scooters are regularly serviced by qualified mechanics, ensuring you get a reliable and smooth ride. With perks like free helmets, unlimited kilometers, and flexible rental terms, Xpert provides everything you need for hassle-free commuting scooter rentals in Sydney.",
  },
  {
    q: "Can I rent a commuting motorbike for a short-term rental in Sydney with Xpert?",
    a: "Yes! Xpert offers short-term rental options for commuting motorbikes, making it easy to rent a bike for a day, a week, or a weekend. Whether you're looking for a quick and affordable way to get around Sydney or need a commuting motorbike for a short-term need, Xpert provides flexible rental options that suit your schedule.",
  },
  {
    q: "What additional services does Xpert offer for Sydney rent commuting scooter options?",
    a: "Xpert offers several value-added services for Sydney rent commuting scooter rentals, including unlimited kilometers, comprehensive accident cover, and 24/7 roadside assistance. We also provide free helmets and phone holders for your convenience, ensuring that your commuting experience is smooth and enjoyable. With Xpert, renting a commuting scooter in Sydney is simple, affordable, and reliable.",
  },
];

const DELIVERY: FAQ[] = [
  {
    q: "Why should I choose a delivery motorcycle rental from Xpert in Sydney?",
    a: "Delivery motorcycles are built for reliability and efficiency, making them ideal for businesses or individuals needing to make quick and frequent deliveries. Renting a delivery motorcycle from Xpert in Sydney ensures you get a well-maintained, high-performance bike that's perfect for navigating city streets. With flexible rental terms and competitive pricing, Xpert provides the best delivery motorcycle rental services in Sydney.",
  },
  {
    q: "How can I hire a delivery motorcycle in Sydney from Xpert?",
    a: "Hiring a delivery motorcycle in Sydney from Xpert is simple and convenient with our online booking system. You can select from our wide range of delivery motorcycles or scooters, customize your rental duration, and choose the best pickup or delivery options. Xpert's seamless process ensures that hiring a delivery motorcycle in Sydney is fast and efficient.",
  },
  {
    q: "Why is Sydney rent delivery motorbike from Xpert the best choice for businesses?",
    a: "Sydney rent delivery motorbike services from Xpert are perfect for businesses needing reliable transportation for deliveries. Our delivery motorbikes are fuel-efficient, easy to maneuver in busy city traffic, and available with unlimited kilometers, allowing you to manage deliveries without restrictions. With well-maintained bikes and flexible rental terms, Xpert offers the best solution for businesses in need of delivery vehicles.",
  },
  {
    q: "Why should I hire a delivery scooter in Sydney from Xpert?",
    a: "Hiring a delivery scooter from Xpert in Sydney ensures that you have a reliable and economical vehicle for deliveries. Xpert offers a wide range of delivery scooters that are regularly serviced and maintained by expert mechanics. With perks like free helmets, flexible rental periods, and unlimited kilometers, Xpert provides the best value for businesses or individuals looking to hire delivery scooters in Sydney.",
  },
  {
    q: "Can I rent a delivery motorbike for short-term delivery needs in Sydney?",
    a: "Yes, Xpert offers short-term rental options for delivery motorbikes, making it easy for businesses or individuals to rent a bike for short-term delivery needs. Whether you're looking to rent a delivery motorbike for a day, a week, or a few months, Xpert provides flexible options that fit your schedule and delivery demands.",
  },
  {
    q: "What additional services does Xpert offer for Sydney delivery motorbike rental?",
    a: "Xpert offers several value-added services for Sydney delivery motorbike rental, including unlimited kilometers, comprehensive accident cover, and 24/7 roadside assistance. We also provide free helmets, phone holders, and expert advice to ensure your rental experience is smooth and enjoyable. Whether you're running deliveries across the city or handling frequent drops, Xpert has you covered.",
  },
];

const LAMS: FAQ[] = [
  {
    q: "Why should I choose a LAMS approved practice motorcycle rental from Xpert in Sydney?",
    a: "LAMS approved practice motorcycles are designed for learners and those looking to gain confidence on the road. Renting a LAMS approved practice motorcycle from Xpert in Sydney ensures that you get a safe, learner-friendly bike that's ideal for practice sessions. Xpert offers flexible rental periods, unlimited kilometers, and well-maintained motorcycles, making us the best choice for LAMS approved practice motorcycle rental in Sydney.",
  },
  {
    q: "How can I hire a LAMS approved practice motorbike in Sydney from Xpert?",
    a: "Hiring a LAMS approved practice motorbike in Sydney from Xpert is easy and convenient with our online booking system. You can select from our range of learner-approved bikes, customize your rental duration, and choose the pickup option that works for you. Xpert ensures a hassle-free experience when you hire LAMS approved practice motorbikes in Sydney.",
  },
  {
    q: "Why is Sydney rent LAMS approved practice motorbike from Xpert the ideal choice for learners?",
    a: "Sydney rent LAMS approved practice motorbike options from Xpert are perfect for learners looking to practice safely. Our bikes are learner-friendly and maintained to the highest standards. With unlimited kilometers, you can practice at your own pace, without worrying about distance limitations. Xpert's flexible rental options make it easy for new riders to gain the experience they need.",
  },
  {
    q: "Why should I hire a LAMS approved practice scooter in Sydney from Xpert?",
    a: "Hiring a LAMS approved practice scooter from Xpert in Sydney ensures that learners get a reliable, easy-to-handle scooter for practice sessions. Xpert offers a range of LAMS approved scooters, all of which are regularly serviced and ready for the road. With free helmets, unlimited kilometers, and comprehensive accident cover, Xpert provides a safe and convenient solution for those looking to hire LAMS approved practice scooters in Sydney.",
  },
  {
    q: "Can I rent a LAMS approved practice motorbike for short-term use in Sydney?",
    a: "Yes! Xpert offers short-term rental options for LAMS approved practice motorbikes, allowing learners to rent bikes for a day, a weekend, or longer. Whether you're looking to prepare for your test or gain more confidence on the road, Xpert provides flexible and affordable short-term rental options to suit your practice needs.",
  },
  {
    q: "What additional services does Xpert offer for Sydney rent LAMS approved practice scooter rentals?",
    a: "Xpert offers several value-added services for Sydney rent LAMS approved practice scooter rentals, including unlimited kilometers, comprehensive accident cover, and 24/7 roadside assistance. We also provide free helmets and phone holders, ensuring that your practice sessions are safe and comfortable. With Xpert, renting a LAMS approved practice scooter in Sydney is easy, affordable, and reliable.",
  },
];

const SECTIONS: FAQSection[] = [
  {
    heading: "General",
    intro: "The essentials for every booking — licences, insurance, bond, returns and delivery.",
    items: GENERAL,
  },
  {
    heading: "Adventure motorcycle rental",
    intro: "For riders heading off-road or out on long-distance trips.",
    items: ADVENTURE,
  },
  {
    heading: "Commuting motorcycle rental",
    intro: "For everyday city riding — efficient, easy to handle, and fuss-free.",
    items: COMMUTING,
  },
  {
    heading: "Delivery motorcycle rental",
    intro: "For couriers, food delivery and businesses needing a reliable drop-off bike.",
    items: DELIVERY,
  },
  {
    heading: "LAMS approved practice motorcycle rental",
    intro: "For learners building road confidence on a safe, approved bike.",
    items: LAMS,
  },
];

export default function FAQPage() {
  return (
    <div className="container max-w-3xl py-12">
      <JsonLd
        data={faqPageLd(
          SECTIONS.flatMap((s) => s.items).map((i) => ({
            question: i.q,
            answer: i.a,
          })),
        )}
      />
      <h1 className="h-display">Frequently asked questions</h1>
      <p className="mt-3 text-muted-foreground">
        Answers to the most common questions about hiring a bike or scooter with us.
      </p>

      <div className="mt-12 space-y-14">
        {SECTIONS.map((section) => (
          <section key={section.heading}>
            <h2 className="h2">{section.heading}</h2>
            {section.intro && (
              <p className="mt-2 text-sm text-muted-foreground">{section.intro}</p>
            )}
            <div className="mt-6 divide-y rounded-lg border bg-card">
              {section.items.map((item) => (
                <details
                  key={item.q}
                  className="group [&_summary::-webkit-details-marker]:hidden"
                >
                  <summary className="flex cursor-pointer items-start justify-between gap-4 p-5 text-left font-medium text-foreground transition-colors hover:bg-muted/50">
                    <span>{item.q}</span>
                    <ChevronDown
                      aria-hidden
                      className="mt-1 h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
                    />
                  </summary>
                  <div className="px-5 pb-5 text-sm text-muted-foreground">
                    {item.a}
                  </div>
                </details>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
