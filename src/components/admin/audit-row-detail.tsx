"use client";

/**
 * Readable renderers for AuditLog rows. The staff Activity tab and the
 * admin audit log both feed rows through <AuditRowDetail /> to replace raw
 * JSON blobs with a human-scannable summary for known actions.
 *
 * Unknown actions fall through to the default JSON pre blocks.
 */

type JsonObject = Record<string, unknown>;

function asObject(value: unknown): JsonObject | null {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as JsonObject;
  }
  return null;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "string") return value === "" ? "—" : value;
  if (typeof value === "number") return String(value);
  return JSON.stringify(value);
}

/**
 * Field-level before/after diff — used by profile and customer.updateProfile
 * rows. Previous/new are expected to share the same key set (the diff helper
 * produces exactly that shape).
 */
function FieldDiffTable({
  previousData,
  newData,
}: {
  previousData: JsonObject | null;
  newData: JsonObject | null;
}) {
  const keys = Array.from(
    new Set([
      ...Object.keys(previousData ?? {}),
      ...Object.keys(newData ?? {}),
    ]),
  ).sort();
  if (keys.length === 0) return null;
  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full text-xs">
        <thead className="bg-muted/40">
          <tr>
            <th className="px-2 py-1 text-left font-medium">Field</th>
            <th className="px-2 py-1 text-left font-medium">Before</th>
            <th className="px-2 py-1 text-left font-medium">After</th>
          </tr>
        </thead>
        <tbody>
          {keys.map((k) => (
            <tr key={k} className="border-t">
              <td className="px-2 py-1 font-mono">{k}</td>
              <td className="px-2 py-1 text-muted-foreground">
                {formatValue(previousData?.[k])}
              </td>
              <td className="px-2 py-1">{formatValue(newData?.[k])}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Summary({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-md border bg-muted/20 px-3 py-2 text-sm">
      {children}
    </div>
  );
}

export function AuditRowDetail({
  action,
  previousData,
  newData,
}: {
  action: string;
  previousData: unknown;
  newData: unknown;
}) {
  const prev = asObject(previousData);
  const next = asObject(newData);

  // Profile / customer field edits — render "Field │ Before │ After".
  if (
    action === "customer.updateProfile" ||
    action === "customer.profileUpdated" ||
    action === "profile.updateBasics" ||
    action === "profile.setAvatar" ||
    action === "profile.removeAvatar"
  ) {
    return (
      <div className="space-y-2">
        <div className="eyebrow">Changed fields</div>
        <FieldDiffTable previousData={prev} newData={next} />
      </div>
    );
  }

  // Password change carries no diff payload — the action itself is the
  // whole signal.
  if (action === "profile.passwordChanged") {
    return <Summary>Password rotated via &ldquo;Change password&rdquo;.</Summary>;
  }

  // Documents — uploaded / viewed / downloaded.
  if (
    action === "document.uploaded" ||
    action === "document.viewed" ||
    action === "document.downloaded"
  ) {
    const type = (next?.type as string | undefined) ?? "document";
    const label = next?.label as string | undefined;
    const reason = next?.reason as string | undefined;
    const verb =
      action === "document.uploaded"
        ? "Uploaded"
        : action === "document.downloaded"
          ? "Downloaded"
          : "Viewed";
    return (
      <Summary>
        {verb} <span className="font-mono text-xs">{type}</span>
        {label ? ` — ${label}` : null}
        {reason && action !== "document.uploaded" ? ` (${reason})` : null}
      </Summary>
    );
  }

  // Invoices / agreements / return assessments fetched via API routes.
  if (action === "invoice.viewed") {
    const ref = next?.bookingReference as string | undefined;
    return (
      <Summary>Viewed invoice for booking {ref ? <strong>{ref}</strong> : null}.</Summary>
    );
  }
  if (action === "agreement.downloaded") {
    const version = next?.version as number | undefined;
    return (
      <Summary>
        Downloaded rental agreement{typeof version === "number" ? ` v${version}` : ""}.
      </Summary>
    );
  }
  if (action === "returnAssessment.downloaded") {
    return <Summary>Downloaded return-assessment PDF.</Summary>;
  }

  // Auth events.
  if (action === "auth.login" || action === "auth.signup") {
    const provider = next?.provider as string | undefined;
    const reason = next?.reason as string | undefined;
    const verb = action === "auth.signup" ? "Signed up" : "Signed in";
    return (
      <Summary>
        {verb}
        {provider ? ` via ${provider}` : null}
        {reason ? ` — ${reason}` : null}
      </Summary>
    );
  }
  if (action === "auth.logout") {
    return <Summary>Signed out.</Summary>;
  }
  if (action === "auth.link") {
    const provider = next?.provider as string | undefined;
    return <Summary>Linked {provider ?? "OAuth"} provider.</Summary>;
  }
  if (action === "auth.unlink") {
    const provider = next?.provider as string | undefined;
    return <Summary>Disconnected {provider ?? "OAuth"} provider.</Summary>;
  }
  if (action === "auth.2fa_enabled") {
    return <Summary>Enabled two-factor authentication.</Summary>;
  }
  if (action === "auth.2fa_disabled") {
    return <Summary>Disabled two-factor authentication.</Summary>;
  }

  // Page views — the path lives on the row itself, surfaced by the caller.
  if (action === "page.view") {
    return <Summary>Viewed page.</Summary>;
  }

  // Session revocation.
  if (
    action === "session.revoked_self" ||
    action === "session.revoked_all_self" ||
    action === "session.revoked_by_admin" ||
    action === "session.revoked_all_by_admin"
  ) {
    const count = next?.revoked as number | undefined;
    return (
      <Summary>
        {action.includes("all")
          ? `Revoked ${count ?? 0} active session${count === 1 ? "" : "s"}.`
          : "Revoked an active session."}
      </Summary>
    );
  }

  // Fallback: nothing to render beyond the raw JSON dumps the caller already
  // shows.
  return null;
}
