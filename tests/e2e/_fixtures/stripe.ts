import type { Page, FrameLocator } from "@playwright/test";

/**
 * Stripe Elements renders three iframes (card number, expiry, CVC). The
 * combined "Card" element renders all three inside one iframe. Both shapes
 * exist depending on the wizard step. These helpers paper over both.
 *
 * Test cards (Stripe-documented):
 *   - 4242424242424242 → succeeds
 *   - 4000002760003184 → requires 3DS
 *   - 4000000000009995 → declines (insufficient funds)
 */

export const STRIPE_TEST_CARDS = {
  success: "4242424242424242",
  requires3ds: "4000002760003184",
  decline: "4000000000009995",
} as const;

export const STRIPE_READY = Boolean(
  process.env.STRIPE_TEST_SECRET_KEY && process.env.STRIPE_TEST_PUBLISHABLE_KEY,
);

function cardFrame(page: Page): FrameLocator {
  return page.frameLocator('iframe[name^="__privateStripeFrame"]').first();
}

export async function fillStripeCard(
  page: Page,
  card: { number: string; expiry?: string; cvc?: string; postcode?: string },
): Promise<void> {
  const frame = cardFrame(page);
  await frame.getByPlaceholder("Card number").fill(card.number);
  await frame.getByPlaceholder("MM / YY").fill(card.expiry ?? "12 / 34");
  await frame.getByPlaceholder("CVC").fill(card.cvc ?? "123");
  if (card.postcode) {
    const postcodeInput = frame.getByPlaceholder(/postal|postcode|zip/i);
    if (await postcodeInput.count()) await postcodeInput.fill(card.postcode);
  }
}

export async function completeStripe3dsChallenge(page: Page): Promise<void> {
  const challengeFrame = page.frameLocator('iframe[name="stripe-challenge-frame"]');
  await challengeFrame
    .getByRole("button", { name: /complete authentication/i })
    .click({ timeout: 30_000 });
}
