"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import QRCode from "qrcode";
import { Shield, ShieldCheck, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/ui/status-badge";

type Phase = "idle" | "enrolling" | "verifying" | "disabling";

/**
 * `redirectTo` is set by the forced-enrolment gate at /totp/enroll — the
 * customer profile surface leaves it unset so the user stays on their
 * profile page after confirming.
 */
export function TwoFactorCard({ redirectTo }: { redirectTo?: string } = {}) {
  const router = useRouter();
  const status = trpc.totp.status.useQuery();
  const utils = trpc.useUtils();

  const [phase, setPhase] = useState<Phase>("idle");
  const [enrolment, setEnrolment] = useState<{
    otpauthUrl: string;
    secretBase32: string;
    recoveryCodes: string[];
  } | null>(null);
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const beginEnrolment = trpc.totp.beginEnrolment.useMutation({
    onSuccess: (data) => {
      setEnrolment(data);
      setPhase("verifying");
      setErr(null);
    },
    onError: (e) => setErr(e.message),
  });
  const confirmEnrolment = trpc.totp.confirmEnrolment.useMutation({
    onSuccess: () => {
      setEnrolment(null);
      setPhase("idle");
      setCode("");
      utils.totp.status.invalidate();
      if (redirectTo) router.push(redirectTo);
    },
    onError: (e) => setErr(e.message),
  });
  const disable = trpc.totp.disable.useMutation({
    onSuccess: () => {
      setPhase("idle");
      setCode("");
      utils.totp.status.invalidate();
    },
    onError: (e) => setErr(e.message),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="h3 flex items-center gap-2">
          <Shield className="h-4 w-4" aria-hidden />
          Two-factor authentication
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        <div className="flex items-center justify-between">
          <div className="text-muted-foreground">
            Protects your account with a time-based one-time password (TOTP)
            from an authenticator app.
          </div>
          {status.data?.enabled ? (
            <StatusBadge status={"ACTIVE"} />
          ) : (
            <StatusBadge status={"PENDING"} />
          )}
        </div>

        {status.data?.enabled && phase === "idle" && (
          <div className="space-y-2">
            <div className="text-xs text-muted-foreground">
              Enabled {status.data.enabledAt ? new Date(status.data.enabledAt).toLocaleDateString("en-AU") : ""}
              {status.data.lastUsedAt
                ? ` · last used ${new Date(status.data.lastUsedAt).toLocaleDateString("en-AU")}`
                : ""}
              {" · "}
              {status.data.recoveryCodesRemaining} recovery codes remaining
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setPhase("disabling");
                setErr(null);
              }}
            >
              Disable 2FA
            </Button>
          </div>
        )}

        {!status.data?.enabled && phase === "idle" && (
          <Button
            size="sm"
            disabled={beginEnrolment.isPending}
            onClick={() => {
              setErr(null);
              beginEnrolment.mutate();
            }}
          >
            {beginEnrolment.isPending && (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
            )}
            Set up 2FA
          </Button>
        )}

        {phase === "verifying" && enrolment && (
          <div className="space-y-4 rounded-md border bg-muted/30 p-3">
            <div>
              <div className="text-xs font-medium mb-1">1. Scan with your authenticator app</div>
              <p className="text-xs text-muted-foreground">
                Google Authenticator, 1Password, Authy, etc.
              </p>
              <QrCodeView otpauthUrl={enrolment.otpauthUrl} />
              <div className="mt-2 text-xs">
                Or enter manually:{" "}
                <span className="font-mono">{enrolment.secretBase32}</span>
              </div>
            </div>

            <div>
              <div className="text-xs font-medium mb-1">2. Save your recovery codes</div>
              <p className="text-xs text-muted-foreground">
                Each code is single-use and replaces your 2FA app if you lose it.
                Store them in a password manager now — we won&apos;t show them again.
              </p>
              <ul className="mt-2 grid grid-cols-2 gap-1 text-xs font-mono">
                {enrolment.recoveryCodes.map((c) => (
                  <li key={c} className="rounded bg-background border px-2 py-1">
                    {c}
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-1">
              <Label htmlFor="code" className="text-xs">
                3. Enter a code from your authenticator app
              </Label>
              <Input
                id="code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                maxLength={6}
                inputMode="numeric"
              />
            </div>

            {err && <div className="text-xs text-destructive">{err}</div>}

            <div className="flex gap-2 justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPhase("idle");
                  setEnrolment(null);
                  setCode("");
                  setErr(null);
                }}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                disabled={code.length !== 6 || confirmEnrolment.isPending}
                onClick={() => {
                  setErr(null);
                  confirmEnrolment.mutate({ code });
                }}
              >
                {confirmEnrolment.isPending && (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
                )}
                <ShieldCheck className="mr-1.5 h-3.5 w-3.5" aria-hidden />
                Enable 2FA
              </Button>
            </div>
          </div>
        )}

        {phase === "disabling" && (
          <div className="space-y-3 rounded-md border bg-muted/30 p-3">
            <div>
              <Label htmlFor="disable-code" className="text-xs">
                Enter a code from your authenticator to disable 2FA
              </Label>
              <Input
                id="disable-code"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                maxLength={6}
                inputMode="numeric"
              />
            </div>
            {err && <div className="text-xs text-destructive">{err}</div>}
            <div className="flex gap-2 justify-end">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setPhase("idle");
                  setCode("");
                  setErr(null);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                disabled={code.length !== 6 || disable.isPending}
                onClick={() => {
                  setErr(null);
                  disable.mutate({ code });
                }}
              >
                Disable 2FA
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function QrCodeView({ otpauthUrl }: { otpauthUrl: string }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(otpauthUrl, { margin: 1, width: 192 })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : "QR render failed");
      });
    return () => {
      cancelled = true;
    };
  }, [otpauthUrl]);

  if (err) {
    return (
      <div className="mt-2 text-xs text-destructive">
        Couldn&apos;t render QR code: {err}. Enter the secret manually below.
      </div>
    );
  }
  if (!dataUrl) {
    return (
      <div className="mt-2 flex h-48 w-48 items-center justify-center rounded-md border bg-background">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
      </div>
    );
  }
  return (
    <div className="mt-2 inline-block rounded-md border bg-white p-2">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={dataUrl} alt="Scan this QR code with your authenticator app" width={192} height={192} />
    </div>
  );
}
