import type { Metadata } from "next";
import { buildMetadata } from "@/lib/seo/metadata";

// The gift-cards page itself is a client component (interactive purchase form),
// so its metadata lives here in a server layout.
export function generateMetadata(): Promise<Metadata> {
  return buildMetadata({
    title: "Gift Cards",
    description:
      "Give the gift of the ride — purchase a digital gift card redeemable on any scooter or motorbike hire.",
    path: "/gift-cards",
  });
}

export default function GiftCardsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
