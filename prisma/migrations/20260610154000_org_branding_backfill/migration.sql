-- Data backfill, no schema change.
--
-- renderTaxInvoicePdf / renderAdjustmentNotePdf now refuse to render a tax
-- document when org.legalName / org.abn are unset (ATO requirement). Fresh
-- databases get these from prisma/seed.ts, but existing deployments only run
-- `prisma migrate deploy` — without this backfill, every invoice on an
-- unconfigured deployment would fail at render time after this release.
--
-- ON CONFLICT DO NOTHING: a deployment that already configured its branding
-- through Admin → Settings keeps its values untouched.
--
-- NOTE: entity values mirror prisma/seed.ts. Verify the invoicing entity
-- before launch — Organisation data says "XPERT Moto Group Pty Ltd /
-- 72 629 456 408" while the platform contract names Mercury Road Equipment
-- Pty Ltd / 36 614 422 187.
INSERT INTO "SystemSetting" ("id", "key", "value", "group", "updatedAt")
VALUES
  ('org-branding-bf-legalname', 'org.legalName', '"XPERT Moto Group Pty Ltd"'::jsonb, 'org', NOW()),
  ('org-branding-bf-abn', 'org.abn', '"72 629 456 408"'::jsonb, 'org', NOW()),
  ('org-branding-bf-tradingname', 'org.tradingName', '"XPERT Moto"'::jsonb, 'org', NOW())
ON CONFLICT ("key") DO NOTHING;
