-- G20 — BondLedger invariant constraints.
--
-- Enforce at the DB level that captured + released never exceeds the held
-- amount, and that terminal states (FULLY_CAPTURED, RELEASED) net to
-- exactly `heldAmount`. Application code already upholds this via
-- transactional writes, but a DB CHECK is belt-and-braces against a buggy
-- future path (or a manual SQL fix gone wrong).

ALTER TABLE "BondLedger"
  ADD CONSTRAINT "BondLedger_amounts_nonneg_chk"
  CHECK (
    "heldAmount" >= 0
    AND "capturedAmount" >= 0
    AND "releasedAmount" >= 0
  );

ALTER TABLE "BondLedger"
  ADD CONSTRAINT "BondLedger_amounts_within_held_chk"
  CHECK ("capturedAmount" + "releasedAmount" <= "heldAmount");

ALTER TABLE "BondLedger"
  ADD CONSTRAINT "BondLedger_terminal_state_chk"
  CHECK (
    (status NOT IN ('FULLY_CAPTURED', 'RELEASED'))
    OR ("capturedAmount" + "releasedAmount" = "heldAmount")
  );
