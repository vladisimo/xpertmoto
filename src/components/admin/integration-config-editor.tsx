"use client";

import { useMemo, useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDateTime } from "@/lib/utils";
import { Eye, EyeOff, Trash2, RotateCw, KeyRound } from "lucide-react";
import type { IntegrationField } from "@/lib/integration-fields";

function SourceBadge({
  source,
}: {
  source: "db-string" | "db-secret" | "env" | "unset";
}) {
  const cfg = {
    "db-string": { label: "Database", className: "bg-green-100 text-green-700" },
    "db-secret": { label: "Database (encrypted)", className: "bg-green-100 text-green-700" },
    env: { label: "Environment", className: "bg-amber-100 text-amber-700" },
    unset: { label: "Not set", className: "bg-muted text-muted-foreground" },
  }[source];
  return (
    <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${cfg.className}`}>
      {cfg.label}
    </span>
  );
}

function FieldRow({ field }: { field: IntegrationField }) {
  const util = trpc.useUtils();
  const { data: rows } = trpc.admin.listIntegrationConfig.useQuery();
  const row = rows?.find((r) => r.key === field.key);
  const [value, setValue] = useState("");
  const [reveal, setReveal] = useState(false);
  const setMutation = trpc.admin.setIntegrationConfig.useMutation({
    onSuccess: () => {
      util.admin.listIntegrationConfig.invalidate();
      util.admin.integrationsOverview.invalidate();
      setValue("");
    },
  });
  const clearMutation = trpc.admin.clearIntegrationConfig.useMutation({
    onSuccess: () => {
      util.admin.listIntegrationConfig.invalidate();
      util.admin.integrationsOverview.invalidate();
    },
  });

  const hasValue = row?.hasValue ?? false;
  const source = row?.source ?? "unset";

  return (
    <div className="py-2 border-b last:border-0">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium">{field.label}</label>
          <SourceBadge source={source} />
          {field.secret && (
            <span className="text-[10px] rounded bg-muted px-1.5 py-0.5 text-muted-foreground">secret</span>
          )}
          {field.publiclyExposable && (
            <span className="text-[10px] rounded bg-muted px-1.5 py-0.5 text-muted-foreground">public</span>
          )}
        </div>
        {row?.updatedAt && (
          <span className="text-[10px] text-muted-foreground">
            updated {formatDateTime(row.updatedAt)}
          </span>
        )}
      </div>
      {field.helperText && (
        <p className="text-xs text-muted-foreground mb-1">{field.helperText}</p>
      )}
      {!field.secret && row?.preview && source.startsWith("db") && (
        <p className="text-xs text-muted-foreground mb-1">
          Current: <code>{row.preview}</code>
        </p>
      )}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Input
            type={field.secret && !reveal ? "password" : "text"}
            placeholder={hasValue ? (field.secret ? "Enter new value to rotate" : "Enter new value to overwrite") : "Enter value"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="off"
          />
          {field.secret && value && (
            <button
              type="button"
              onClick={() => setReveal((r) => !r)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label={reveal ? "Hide" : "Show"}
            >
              {reveal ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button>
          )}
        </div>
        <Button
          size="sm"
          disabled={!value || setMutation.isPending}
          onClick={() => setMutation.mutate({ key: field.key, value })}
        >
          Save
        </Button>
        {source.startsWith("db") && (
          <Button
            size="sm"
            variant="outline"
            disabled={clearMutation.isPending}
            onClick={() => {
              if (confirm(`Clear ${field.label}? This will revert to the environment value if set.`)) {
                clearMutation.mutate({ key: field.key });
              }
            }}
            title="Clear the DB value (env fallback still applies)"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

export function IntegrationConfigEditor({
  fields,
  serviceId,
}: {
  fields: IntegrationField[];
  serviceId?: string;
}) {
  const util = trpc.useUtils();
  const generateVapid = trpc.admin.generateVapidKeys.useMutation({
    onSuccess: () => {
      util.admin.listIntegrationConfig.invalidate();
      util.admin.integrationsOverview.invalidate();
    },
  });
  const generateTelemetry = trpc.admin.generateTelemetryToken.useMutation({
    onSuccess: () => {
      util.admin.listIntegrationConfig.invalidate();
      util.admin.integrationsOverview.invalidate();
    },
  });

  const extraActions = useMemo(() => {
    if (serviceId === "push") {
      return (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            if (confirm("Rotating VAPID keys will invalidate every existing push subscription. Continue?")) {
              generateVapid.mutate();
            }
          }}
          disabled={generateVapid.isPending}
        >
          <RotateCw className="mr-1.5 h-3.5 w-3.5" />
          {generateVapid.isPending ? "Rotating…" : "Generate new VAPID keypair"}
        </Button>
      );
    }
    if (serviceId === "telemetry") {
      return (
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            if (confirm("Generating a new token will immediately invalidate the old one on every tracker. Continue?")) {
              generateTelemetry.mutate();
            }
          }}
          disabled={generateTelemetry.isPending}
        >
          <KeyRound className="mr-1.5 h-3.5 w-3.5" />
          {generateTelemetry.isPending ? "Generating…" : "Generate new ingest token"}
        </Button>
      );
    }
    return null;
  }, [serviceId, generateVapid, generateTelemetry]);

  return (
    <Card>
      <CardContent className="p-4">
        {extraActions && <div className="mb-3">{extraActions}</div>}
        <div>
          {fields.map((f) => (
            <FieldRow key={f.key} field={f} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
