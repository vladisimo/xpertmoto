"use client";
import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Chrome, Github } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";
import { AppleIcon, MicrosoftIcon } from "@/components/auth/provider-icons";
import type { OAuthProviderId } from "@/lib/auth-providers";

const PROVIDER_LABELS: Record<OAuthProviderId, string> = {
  google: "Google",
  apple: "Apple",
  "microsoft-entra-id": "Microsoft",
  github: "GitHub",
};

function ProviderIcon({ id }: { id: OAuthProviderId }) {
  switch (id) {
    case "google":
      return <Chrome className="h-4 w-4" aria-hidden />;
    case "github":
      return <Github className="h-4 w-4" aria-hidden />;
    case "apple":
      return <AppleIcon />;
    case "microsoft-entra-id":
      return <MicrosoftIcon />;
  }
}

interface ConnectedAccountsProps {
  enabledProviders: OAuthProviderId[];
  hasPassword: boolean;
}

export function ConnectedAccounts({
  enabledProviders,
  hasPassword,
}: ConnectedAccountsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const linkedQuery = trpc.auth.listLinkedProviders.useQuery();
  const disconnect = trpc.auth.disconnectProvider.useMutation({
    onSuccess: async () => {
      await linkedQuery.refetch();
      router.refresh();
    },
  });
  const [workingOn, setWorkingOn] = useState<OAuthProviderId | null>(null);
  const [notice, setNotice] = useState<string | null>(() => {
    const linked = searchParams?.get("linked");
    return linked ? `${PROVIDER_LABELS[linked as OAuthProviderId] ?? linked} connected.` : null;
  });

  const linked = new Set(linkedQuery.data?.map((a) => a.provider) ?? []);

  async function onConnect(id: OAuthProviderId) {
    setWorkingOn(id);
    // Authenticated call to signIn — NextAuth's handler sees the existing
    // session and treats this as an account-link flow, not a sign-in. The
    // callback lands here with `?linked=<id>` so we can show confirmation.
    await signIn(id, {
      redirect: true,
      callbackUrl: `/dashboard/security?linked=${id}`,
    });
  }

  async function onDisconnect(id: OAuthProviderId) {
    setWorkingOn(id);
    setNotice(null);
    try {
      await disconnect.mutateAsync({ provider: id });
      setNotice(`${PROVIDER_LABELS[id]} disconnected.`);
    } catch (err) {
      setNotice(
        err instanceof Error
          ? err.message
          : "Couldn't disconnect — please try again.",
      );
    } finally {
      setWorkingOn(null);
    }
  }

  return (
    <div className="space-y-4">
      {notice && <p className="text-sm text-foreground">{notice}</p>}
      <ul className="divide-y divide-border rounded-md border border-border">
        {enabledProviders.map((id) => {
          const isLinked = linked.has(id);
          const isLastMethod =
            isLinked && !hasPassword && linked.size <= 1;
          return (
            <li
              key={id}
              className="flex items-center justify-between gap-3 px-4 py-3"
            >
              <div className="flex items-center gap-3">
                <span
                  className={
                    isLinked
                      ? "inline-flex h-2 w-2 rounded-full bg-primary"
                      : "inline-flex h-2 w-2 rounded-full bg-muted-foreground/30"
                  }
                  aria-hidden
                />
                <ProviderIcon id={id} />
                <div className="flex flex-col">
                  <span className="text-sm font-medium text-foreground">
                    {PROVIDER_LABELS[id]}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {isLinked ? "Connected" : "Not connected"}
                  </span>
                </div>
              </div>
              {isLinked ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onDisconnect(id)}
                  disabled={workingOn !== null || isLastMethod}
                  title={
                    isLastMethod
                      ? "Set a password before disconnecting your last sign-in method."
                      : undefined
                  }
                >
                  {workingOn === id && disconnect.isPending
                    ? "Disconnecting…"
                    : "Disconnect"}
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => onConnect(id)}
                  disabled={workingOn !== null}
                >
                  {workingOn === id ? "Redirecting…" : "Connect"}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      {!hasPassword && linked.size === 1 && (
        <p className="text-xs text-muted-foreground">
          You have one sign-in method. Set a password above if you&apos;d like
          to disconnect it later.
        </p>
      )}
    </div>
  );
}
