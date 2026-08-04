-- Persist the server-created PaymentIntent ids on the booking so payment
-- confirmation can verify the client-supplied id (identity + amount) instead
-- of trusting it.
ALTER TABLE "Booking" ADD COLUMN "stripePaymentIntentId" TEXT;
ALTER TABLE "Booking" ADD COLUMN "bondPaymentIntentId" TEXT;
