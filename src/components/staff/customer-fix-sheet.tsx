"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import type { CustomerAuditRemedy } from "@/server/services/customer-audit";

export interface CustomerFixTarget {
  customerId: string;
  customerName: string;
  remedy: CustomerAuditRemedy;
  label: string;
}

/**
 * Maps a remedy to the destination tab on the customer detail page.
 * Identity/document checks land on Documents; everything else lands on
 * the Personal tab where address, contact, consent and risk fields live.
 */
function destinationTab(remedy: CustomerAuditRemedy): string {
  return remedy === "identity" ? "documents" : "personal";
}

const REMEDY_HINT: Record<CustomerAuditRemedy, string> = {
  identity:   "Open the customer's Documents tab to upload images, capture verification, or update licence details.",
  compliance: "Open the customer's record to set risk rating, capture an internal note, or update payment method.",
  consent:    "Open the customer's record to capture T&C / privacy acceptance or marketing preferences.",
  contact:    "Open the customer's record to update address or emergency contact details.",
};

export function CustomerFixSheet({
  target,
  onClose,
}: {
  target: CustomerFixTarget | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const open = target !== null;

  const handleOpen = () => {
    if (!target) return;
    router.push(`/staff/customers/${target.customerId}?tab=${destinationTab(target.remedy)}`);
    onClose();
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Fix audit issue</SheetTitle>
          <SheetDescription>
            {target ? (
              <>
                <span className="font-medium text-foreground">{target.customerName}</span>
                {" — "}
                {target.label}
              </>
            ) : null}
          </SheetDescription>
        </SheetHeader>

        <div className="space-y-4 py-4 text-sm text-muted-foreground">
          {target ? <p>{REMEDY_HINT[target.remedy]}</p> : null}
        </div>

        <div className="mt-2 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleOpen} disabled={!target}>
            Open customer
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
