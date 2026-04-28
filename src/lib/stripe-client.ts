"use client";

import { loadStripe, type Stripe } from "@stripe/stripe-js";

// Loaded once at module scope — Stripe.js is a singleton and reloading it
// breaks Elements rendering. Returns `null` when the publishable key isn't
// set (stub mode / misconfigured env), so components can fall back to a
// stub-only payment flow.
let stripePromise: Promise<Stripe | null> | null = null;

export function getStripeClient(): Promise<Stripe | null> {
  if (stripePromise) return stripePromise;
  const key = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
  if (!key) {
    stripePromise = Promise.resolve(null);
    return stripePromise;
  }
  stripePromise = loadStripe(key);
  return stripePromise;
}
