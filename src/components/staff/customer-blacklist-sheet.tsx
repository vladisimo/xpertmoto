"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc/client";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export interface BlacklistTarget {
  customerId: string;
  customerName: string;
  currentReason: string | null;
}

export function CustomerBlacklistSheet({
  target,
  onClose,
}: {
  target: BlacklistTarget | null;
  onClose: () => void;
}) {
  return (
    <Sheet open={target !== null} onOpenChange={(v) => !v && onClose()}>
      <SheetContent>
        {target ? (
          <BlacklistForm key={target.customerId} target={target} onClose={onClose} />
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/**
 * Inner form, keyed by customerId so React remounts and resets local
 * state when the operator picks a different customer — avoids the
 * setState-in-useEffect anti-pattern.
 */
function BlacklistForm({
  target,
  onClose,
}: {
  target: BlacklistTarget;
  onClose: () => void;
}) {
  const utils = trpc.useUtils();
  const [reason, setReason] = React.useState(target.currentReason ?? "");

  const setBlacklist = trpc.staffCustomer.setBlacklist.useMutation({
    onSuccess: () => {
      void utils.staffCustomer.riskList.invalidate();
      void utils.staffCustomer.riskStats.invalidate();
      void utils.staffCustomer.audit.invalidate();
      onClose();
    },
    onError: (e) => alert(e.message),
  });

  const isBlacklisted = target.currentReason != null && target.currentReason !== "";

  return (
    <>
      <SheetHeader>
        <SheetTitle>{isBlacklisted ? "Update blacklist" : "Blacklist customer"}</SheetTitle>
        <SheetDescription>
          <span className="font-medium text-foreground">{target.customerName}</span>
          {" — "}
          {isBlacklisted
            ? "Update the recorded reason or clear the blacklist flag."
            : "Document the reason. Customer will be blocked from new check-outs."}
        </SheetDescription>
      </SheetHeader>

      <div className="space-y-3 py-4">
        <Label htmlFor="reason">Reason</Label>
        <textarea
          id="reason"
          rows={4}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Repeated late returns, fraudulent payment, multiple incidents…"
        />
      </div>

      <div className="mt-2 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        {isBlacklisted && (
          <Button
            variant="destructive"
            disabled={setBlacklist.isPending}
            onClick={() => setBlacklist.mutate({ customerId: target.customerId, reason: null })}
          >
            Clear blacklist
          </Button>
        )}
        <Button
          disabled={setBlacklist.isPending || reason.trim().length === 0}
          onClick={() => setBlacklist.mutate({ customerId: target.customerId, reason: reason.trim() })}
        >
          {isBlacklisted ? "Update" : "Blacklist"}
        </Button>
      </div>
    </>
  );
}
