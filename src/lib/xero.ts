import { logger } from "@/lib/logger";
import { prisma } from "@/lib/prisma";
import { getSecret, getString } from "@/lib/integration-config";

async function getCreds(): Promise<{ id: string; secret: string } | null> {
  const [id, secret] = await Promise.all([
    getString("integration:xero:clientId", "XERO_CLIENT_ID"),
    getSecret("integration:xero:clientSecret", "XERO_CLIENT_SECRET"),
  ]);
  if (!id || !secret) return null;
  return { id, secret };
}

export async function xeroEnabled(): Promise<boolean> {
  return !!(await getCreds());
}

const AUTH_URL = "https://login.xero.com/identity/connect/authorize";
const TOKEN_URL = "https://identity.xero.com/connect/token";
const API_BASE = "https://api.xero.com/api.xro/2.0";
const CONNECTIONS_URL = "https://api.xero.com/connections";
const SCOPES = [
  "offline_access",
  "accounting.contacts",
  "accounting.transactions",
  "accounting.settings.read",
];

type XeroTokens = {
  access_token: string;
  refresh_token: string;
  expires_at: number;
  tenant_id: string | null;
};

const SETTING_KEY = "xero:tokens";

async function saveTokens(t: XeroTokens) {
  await prisma.systemSetting.upsert({
    where: { key: SETTING_KEY },
    create: {
      key: SETTING_KEY,
      value: t,
      group: "integrations",
      description: "Xero OAuth2 tokens — rotate via /admin/integrations",
    },
    update: { value: t },
  });
}

async function loadTokens(): Promise<XeroTokens | null> {
  const row = await prisma.systemSetting.findUnique({ where: { key: SETTING_KEY } });
  return (row?.value as XeroTokens | undefined) ?? null;
}

export async function buildAuthorizeUrl(redirectUri: string, state: string): Promise<string> {
  const creds = await getCreds();
  if (!creds) throw new Error("Xero not configured");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: creds.id,
    redirect_uri: redirectUri,
    scope: SCOPES.join(" "),
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeCode(code: string, redirectUri: string): Promise<XeroTokens> {
  const creds = await getCreds();
  if (!creds) throw new Error("Xero not configured");
  const basic = Buffer.from(`${creds.id}:${creds.secret}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }).toString(),
  });
  if (!res.ok) throw new Error(`Xero token exchange failed (${res.status})`);
  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };

  const connRes = await fetch(CONNECTIONS_URL, {
    headers: { Authorization: `Bearer ${data.access_token}` },
  });
  const connections = (await connRes.json()) as Array<{ tenantId: string }>;
  const tokens: XeroTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000 - 60_000,
    tenant_id: connections[0]?.tenantId ?? null,
  };
  await saveTokens(tokens);
  return tokens;
}

async function refreshIfNeeded(t: XeroTokens): Promise<XeroTokens> {
  if (t.expires_at > Date.now()) return t;
  const creds = await getCreds();
  if (!creds) throw new Error("Xero credentials missing");
  const basic = Buffer.from(`${creds.id}:${creds.secret}`).toString("base64");
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: t.refresh_token,
    }).toString(),
  });
  if (!res.ok) throw new Error(`Xero token refresh failed (${res.status})`);
  const data = (await res.json()) as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
  };
  const next: XeroTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + data.expires_in * 1000 - 60_000,
    tenant_id: t.tenant_id,
  };
  await saveTokens(next);
  return next;
}

export async function syncInvoice(invoiceId: string): Promise<"pushed" | "skipped"> {
  if (!(await xeroEnabled())) return "skipped";
  const tokens = await loadTokens();
  if (!tokens || !tokens.tenant_id) {
    logger.warn({ invoiceId }, "xero: tokens not configured");
    return "skipped";
  }
  const fresh = await refreshIfNeeded(tokens);

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { booking: { include: { customer: true } } },
  });
  if (!invoice) return "skipped";
  const customer = invoice.booking?.customer;
  if (!customer) return "skipped";

  const lineItems = Array.isArray(invoice.lineItems)
    ? (invoice.lineItems as Array<{ description?: string; quantity?: number; unitAmount?: number }>)
    : [];

  const body = {
    Type: "ACCREC",
    Contact: {
      Name: `${customer.firstName} ${customer.lastName}`,
      EmailAddress: customer.email,
    },
    InvoiceNumber: invoice.invoiceNumber,
    Date: invoice.createdAt.toISOString().split("T")[0],
    DueDate: invoice.dueDate?.toISOString().split("T")[0],
    LineAmountTypes: "Inclusive",
    LineItems: lineItems.map((li) => ({
      Description: li.description ?? "Scootering hire",
      Quantity: li.quantity ?? 1,
      UnitAmount: li.unitAmount ?? Number(invoice.totalAmount),
      TaxType: "OUTPUT",
    })),
    Status: invoice.status === "PAID" ? "AUTHORISED" : "DRAFT",
    Reference: invoice.booking?.bookingReference ?? "",
  };

  if (!fresh.tenant_id) return "skipped";
  const res = await fetch(`${API_BASE}/Invoices`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${fresh.access_token}`,
      "Xero-Tenant-Id": fresh.tenant_id,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    logger.warn({ invoiceId, status: res.status, body: text.slice(0, 500) }, "xero invoice push failed");
    return "skipped";
  }
  return "pushed";
}
