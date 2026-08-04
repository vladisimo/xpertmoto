-- Bad-debt write-off: a terminal status for uncollectable charges a manager
-- explicitly forgives. Previously nothing could clear a dead balance —
-- voidPayment only worked on PENDING rows and debtors were dunned forever.
ALTER TYPE "PaymentStatus" ADD VALUE 'WRITTEN_OFF';
