-- Linkt auto-scrape opt-in. Additive, non-breaking:
--   scrapeEnabled  — per-account toggle for the stealth-browser scraper
--                    (default false → existing accounts keep manual upload).
--   reauthNeededAt — set when the scraper is blocked (Incapsula / login);
--                    while non-null the scheduler skips scraping the account.
ALTER TABLE "LinktAccount" ADD COLUMN "scrapeEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "LinktAccount" ADD COLUMN "reauthNeededAt" TIMESTAMP(3);
