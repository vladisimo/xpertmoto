"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/layout/page-header";
import { PageShell } from "@/components/layout/page-section";
import { formatCurrency } from "@/lib/utils";

type Severity = "MINOR" | "MODERATE" | "MAJOR";

export default function DamageTariffPage() {
  const utils = trpc.useUtils();
  const { data: tariffs } = trpc.damageTariff.list.useQuery({ activeOnly: false });
  const upsert = trpc.damageTariff.upsert.useMutation({
    onSuccess: () => utils.damageTariff.list.invalidate(),
  });
  const disable = trpc.damageTariff.disable.useMutation({
    onSuccess: () => utils.damageTariff.list.invalidate(),
  });
  const enable = trpc.damageTariff.enable.useMutation({
    onSuccess: () => utils.damageTariff.list.invalidate(),
  });

  const [draft, setDraft] = useState({
    id: null as string | null,
    code: "",
    name: "",
    description: "",
    defaultPrice: "0",
    severityHint: "MINOR" as Severity,
    displayOrder: 0,
  });
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setErr(null);
    try {
      await upsert.mutateAsync({
        id: draft.id ?? undefined,
        code: draft.code.toUpperCase(),
        name: draft.name,
        description: draft.description || undefined,
        defaultPrice: Number(draft.defaultPrice),
        severityHint: draft.severityHint,
        categoryScope: [],
        isActive: true,
        displayOrder: draft.displayOrder,
      });
      setDraft({
        id: null,
        code: "",
        name: "",
        description: "",
        defaultPrice: "0",
        severityHint: "MINOR",
        displayOrder: 0,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    }
  }

  return (
    <PageShell>
      <PageHeader
        eyebrow="Administration"
        title="Damage tariff"
        description="Pre-configured damage cost items shown to staff at return, so standard damage is billed on the spot without a mechanic quote."
      />

      <Card>
        <CardHeader>
          <CardTitle className="h3">{draft.id ? "Edit tariff" : "Add tariff"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label>Code</Label>
              <Input
                value={draft.code}
                onChange={(e) => setDraft((d) => ({ ...d, code: e.target.value }))}
                placeholder="MIRROR_REPLACE"
              />
            </div>
            <div>
              <Label>Name</Label>
              <Input
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Mirror replacement"
              />
            </div>
            <div>
              <Label>Default price (A$)</Label>
              <Input
                type="number"
                inputMode="decimal"
                value={draft.defaultPrice}
                onChange={(e) => setDraft((d) => ({ ...d, defaultPrice: e.target.value }))}
              />
            </div>
            <div>
              <Label>Severity hint</Label>
              <div className="mt-2 flex gap-2">
                {(["MINOR", "MODERATE", "MAJOR"] as const).map((s) => (
                  <Button
                    key={s}
                    type="button"
                    variant={draft.severityHint === s ? "default" : "secondary"}
                    size="sm"
                    onClick={() => setDraft((d) => ({ ...d, severityHint: s }))}
                  >
                    {s.slice(0, 1) + s.slice(1).toLowerCase()}
                  </Button>
                ))}
              </div>
            </div>
            <div className="sm:col-span-2">
              <Label>Description</Label>
              <Input
                value={draft.description}
                onChange={(e) => setDraft((d) => ({ ...d, description: e.target.value }))}
              />
            </div>
            <div>
              <Label>Display order</Label>
              <Input
                type="number"
                value={draft.displayOrder}
                onChange={(e) => setDraft((d) => ({ ...d, displayOrder: Number(e.target.value) }))}
              />
            </div>
          </div>
          {err && (
            <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
              {err}
            </div>
          )}
          <div className="flex gap-3">
            <Button onClick={save} disabled={upsert.isPending || !draft.code || !draft.name}>
              {upsert.isPending ? "Saving…" : draft.id ? "Update tariff" : "Add tariff"}
            </Button>
            {draft.id && (
              <Button
                variant="ghost"
                onClick={() =>
                  setDraft({
                    id: null,
                    code: "",
                    name: "",
                    description: "",
                    defaultPrice: "0",
                    severityHint: "MINOR",
                    displayOrder: 0,
                  })
                }
              >
                Cancel edit
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="h3">Catalogue</CardTitle>
        </CardHeader>
        <CardContent>
          {!tariffs || tariffs.length === 0 ? (
            <p className="caption">No tariff items yet. Add one above.</p>
          ) : (
            <div className="overflow-hidden rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="px-3 py-2 text-left">Code</th>
                    <th className="px-3 py-2 text-left">Name</th>
                    <th className="px-3 py-2 text-left">Severity</th>
                    <th className="px-3 py-2 text-right">Price</th>
                    <th className="px-3 py-2 text-left">Active</th>
                    <th className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {tariffs.map((t) => (
                    <tr key={t.id}>
                      <td className="px-3 py-2 font-mono text-xs">{t.code}</td>
                      <td className="px-3 py-2">
                        <div>{t.name}</div>
                        {t.description && <div className="caption">{t.description}</div>}
                      </td>
                      <td className="px-3 py-2">{t.severityHint ?? "—"}</td>
                      <td className="px-3 py-2 text-right">{formatCurrency(Number(t.defaultPrice))}</td>
                      <td className="px-3 py-2">{t.isActive ? "✅" : "—"}</td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() =>
                            setDraft({
                              id: t.id,
                              code: t.code,
                              name: t.name,
                              description: t.description ?? "",
                              defaultPrice: t.defaultPrice.toString(),
                              severityHint: (t.severityHint as Severity) ?? "MINOR",
                              displayOrder: t.displayOrder,
                            })
                          }
                        >
                          Edit
                        </Button>
                        {t.isActive ? (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => disable.mutate({ id: t.id })}
                          >
                            Disable
                          </Button>
                        ) : (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => enable.mutate({ id: t.id })}
                          >
                            Enable
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </PageShell>
  );
}
