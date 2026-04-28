"use client";

import { UserCheck, Loader2 } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { Button } from "@/components/ui/button";

type Props = {
  customerId: string;
};

/**
 * "View as this customer" button — super-admin only. Calls
 * `impersonation.start` for a one-shot handoff token, then redirects
 * the browser to `/api/impersonate?token=...` which signs the admin
 * back in as the target customer with `impersonatorId` embedded in the
 * JWT. The persistent red banner in the root layout stays visible on
 * every page until "End impersonation" is clicked.
 */
export function ViewAsCustomerButton({ customerId }: Props) {
  const me = trpc.session.whoAmI.useQuery(undefined, { staleTime: 60_000 });
  const start = trpc.impersonation.start.useMutation({
    onSuccess: ({ token }) => {
      window.location.href = `/api/impersonate?token=${encodeURIComponent(token)}`;
    },
  });

  if (me.data?.role !== "SUPER_ADMIN") return null;

  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={start.isPending}
      onClick={() => start.mutate({ targetUserId: customerId })}
    >
      {start.isPending ? (
        <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden />
      ) : (
        <UserCheck className="mr-1.5 h-3.5 w-3.5" aria-hidden />
      )}
      View as customer
    </Button>
  );
}
