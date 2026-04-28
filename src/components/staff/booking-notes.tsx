"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageSquarePlus } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatDateTime } from "@/lib/utils";

type Note = {
  id: string;
  note: string;
  isInternal: boolean;
  createdAt: string;
  user: { firstName: string; lastName: string; role: string };
};

export function BookingNotes({ bookingId, initialNotes }: { bookingId: string; initialNotes: Note[] }) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [internal, setInternal] = useState(true);
  const add = trpc.staffBooking.addNote.useMutation({
    onSuccess: () => {
      setNote("");
      router.refresh();
    },
  });

  return (
    <Card>
      <CardHeader><CardTitle className="text-lg">Notes</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex gap-2 items-center flex-wrap">
          <Input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a note…"
            onKeyDown={(e) => {
              if (e.key === "Enter" && note.trim()) {
                add.mutate({ bookingId, note: note.trim(), isInternal: internal });
              }
            }}
          />
          <label className="flex items-center gap-1 text-xs text-muted-foreground">
            <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
            internal
          </label>
          <Button
            size="sm"
            onClick={() => add.mutate({ bookingId, note: note.trim(), isInternal: internal })}
            disabled={!note.trim() || add.isPending}
          >
            <MessageSquarePlus className="mr-1.5 h-4 w-4" /> Add
          </Button>
        </div>

        {initialNotes.length === 0 ? (
          <p className="text-sm text-muted-foreground">No notes yet.</p>
        ) : (
          <div className="space-y-2">
            {initialNotes.map((n) => (
              <div key={n.id} className="border rounded p-3 text-sm">
                <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                  <span className="font-medium text-foreground">{n.user.firstName} {n.user.lastName}</span>
                  <span>·</span>
                  <span>{formatDateTime(n.createdAt)}</span>
                  {n.isInternal && <StatusBadge status="INTERNAL" className="ml-auto" />}
                </div>
                <p>{n.note}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
