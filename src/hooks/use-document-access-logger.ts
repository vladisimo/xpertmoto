"use client";

import * as React from "react";
import { trpc } from "@/lib/trpc/client";

/**
 * Fire-and-forget audit-log hook for the customer documents UI. Call the
 * returned function when the user clicks a "View" or "Download" button on a
 * personal document (signed consent PDF, licence, passport). Records a row
 * under `customer.recordDocumentAccess` without blocking the browser from
 * opening the underlying signed URL — the `<a href>` proceeds in parallel.
 */
export function useDocumentAccessLogger() {
  const mutate = trpc.customer.recordDocumentAccess.useMutation();
  return React.useCallback(
    (args: { documentId: string; reason: "view" | "download" }) => {
      // Errors here are not surfaced — the download href has already fired
      // and an audit-write failure must not break the user's flow.
      mutate.mutate(args, {
        onError: () => undefined,
      });
    },
    [mutate],
  );
}
