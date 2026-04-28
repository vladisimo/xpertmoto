"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export interface AbandonDialogProps {
  activityId: string;
  onClose: () => void;
  onSubmit: (reason: string, force: boolean) => void;
  pending?: boolean;
}

export function AbandonDialog({ onClose, onSubmit, pending }: AbandonDialogProps) {
  const [reason, setReason] = useState("");
  const [force, setForce] = useState(false);
  const canSubmit = reason.trim().length >= 5;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <Card className="w-full max-w-md">
        <CardContent className="space-y-4 p-6">
          <h2 className="h3">Abandon this task?</h2>
          <p className="text-sm text-muted-foreground">
            The task will return to the pool for someone else to pick up. We capture the reason so
            managers can spot recurring blockers.
          </p>
          <div className="space-y-1">
            <label className="text-sm font-medium">Reason</label>
            <Input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Customer no-show, vehicle missing, waiting on parts"
            />
            <p className="text-xs text-muted-foreground">Minimum 5 characters.</p>
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
            />
            Force-abandon another staff member's task (manager+ only)
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={pending}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => onSubmit(reason.trim(), force)}
              disabled={!canSubmit || pending}
            >
              Abandon
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
