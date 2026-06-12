import { test, expect } from "../_fixtures/test";
import {
  bookingRefData,
  quoteWindow,
  fetchQuote,
  assertQuoteInvariants,
} from "../_fixtures/pricing";

/**
 * Pricing correctness at the API/engine layer. The public booking wizard shows
 * exactly what `booking.quote` returns, so verifying the quote here pins the
 * numbers the customer will see. UI↔API display parity is checked separately in
 * tests/e2e/booking/.
 */
test.describe("pricing engine — public quote", () => {
  test("GST, bond and pay-now split are internally consistent across durations", async ({
    publicApi,
  }) => {
    const ref = await bookingRefData(publicApi);

    for (const days of [3, 10, 35]) {
      const win = quoteWindow(days);
      const quote = await fetchQuote(publicApi, {
        categoryId: ref.categoryId,
        pickupDepotId: ref.depotId,
        returnDepotId: ref.depotId,
        ...win,
      });

      assertQuoteInvariants(quote);
      // Bond is the category bond, held separately from the charge.
      expect(quote.bondAmount).toBeGreaterThan(0);
      // Every quote carries a human-readable breakdown.
      expect(quote.lineItems.length).toBeGreaterThan(0);
    }
  });

  test("a longer hire costs more in total than a shorter one", async ({ publicApi }) => {
    const ref = await bookingRefData(publicApi);
    const base = {
      categoryId: ref.categoryId,
      pickupDepotId: ref.depotId,
      returnDepotId: ref.depotId,
    };
    const short = await fetchQuote(publicApi, { ...base, ...quoteWindow(3) });
    const long = await fetchQuote(publicApi, { ...base, ...quoteWindow(14) });
    expect(long.totalAmount).toBeGreaterThan(short.totalAmount);
  });

  test("an invalid discount code does not reduce the total", async ({ publicApi }) => {
    const ref = await bookingRefData(publicApi);
    const win = quoteWindow(5);
    const base = {
      categoryId: ref.categoryId,
      pickupDepotId: ref.depotId,
      returnDepotId: ref.depotId,
      ...win,
    };
    const plain = await fetchQuote(publicApi, base);
    const withBogus = await fetchQuote(publicApi, { ...base, discountCode: "NOTAREALCODE" });
    expect(withBogus.totalAmount).toBeCloseTo(plain.totalAmount, 2);
    assertQuoteInvariants(withBogus);
  });
});
