/**
 * Read-only Twilio credential check.
 *
 * Resolves the Twilio Account SID / Auth Token / From number exactly the way
 * sendSms() does (DB-backed integration-config first, then env fallback), then
 * validates them with a *read-only* Twilio API call:
 *
 *   - GET /Accounts/{SID}        — confirms the SID + token authenticate
 *   - GET .../IncomingPhoneNumbers — confirms the From number is owned (best effort)
 *
 * No SMS is sent. Safe to run against any environment. Secrets are never
 * printed — only a masked preview and the resolution source.
 */
import { getString, getSecret, getSource } from "@/lib/integration-config";

function mask(s: string | null): string {
  if (!s) return "(unset)";
  if (s.length <= 8) return "•".repeat(s.length);
  return `${s.slice(0, 4)}…${s.slice(-2)}`;
}

async function main() {
  const [accountSid, authToken, fromNumber] = await Promise.all([
    getString("integration:twilio:accountSid", "TWILIO_ACCOUNT_SID"),
    getSecret("integration:twilio:authToken", "TWILIO_AUTH_TOKEN"),
    getString("integration:twilio:fromNumber", "TWILIO_FROM_NUMBER"),
  ]);
  const [sidSrc, tokenSrc, fromSrc] = await Promise.all([
    getSource("integration:twilio:accountSid", "TWILIO_ACCOUNT_SID"),
    getSource("integration:twilio:authToken", "TWILIO_AUTH_TOKEN"),
    getSource("integration:twilio:fromNumber", "TWILIO_FROM_NUMBER"),
  ]);

  console.log("Resolved Twilio config:");
  console.log(`  accountSid : ${mask(accountSid)}   [source: ${sidSrc}]`);
  console.log(`  authToken  : ${mask(authToken)}   [source: ${tokenSrc}]`);
  console.log(`  fromNumber : ${fromNumber ?? "(unset)"}   [source: ${fromSrc}]`);
  console.log("");

  if (!accountSid || !authToken) {
    console.error("❌ Missing accountSid and/or authToken — cannot test. Set them in admin integration settings or env.");
    process.exit(1);
  }

  const auth = "Basic " + Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  // 1. Validate credentials by fetching the account (read-only).
  const acctRes = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}.json`,
    { headers: { Authorization: auth } },
  );
  if (!acctRes.ok) {
    const body = await acctRes.json().catch(() => ({}));
    console.error(`❌ Auth failed (HTTP ${acctRes.status}): ${body.message ?? acctRes.statusText}`);
    if (acctRes.status === 401) console.error("   → SID/token rejected by Twilio.");
    process.exit(1);
  }
  const acct = await acctRes.json();
  console.log(`✅ Credentials valid. Account "${acct.friendly_name}" — status: ${acct.status}, type: ${acct.type}`);

  // 2. Best-effort: confirm the From number is owned by this account.
  if (fromNumber) {
    const numRes = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(fromNumber)}`,
      { headers: { Authorization: auth } },
    );
    if (numRes.ok) {
      const data = await numRes.json();
      const owned = (data.incoming_phone_numbers ?? []).length > 0;
      console.log(
        owned
          ? `✅ From number ${fromNumber} is owned by this account.`
          : `⚠️  From number ${fromNumber} not found on this account (could be Messaging Service / alphanumeric sender, or wrong number).`,
      );
    } else {
      console.log(`⚠️  Could not verify From number (HTTP ${numRes.status}).`);
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Unexpected error:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
