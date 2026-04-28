"use client";

import { useState } from "react";
import { trpc } from "@/lib/trpc/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MessageSquarePlus } from "lucide-react";

export function CustomerTabNotes({
  customerId,
  notes,
}: {
  customerId: string;
  notes: string | null;
}) {
  const util = trpc.useUtils();
  const [note, setNote] = useState("");
  const addNote = trpc.staffCustomer.addNote.useMutation({
    onSuccess: () => {
      setNote("");
      util.staffCustomer.detail.invalidate({ id: customerId });
    },
  });

  const lines = notes
    ? notes.split("\n").filter(Boolean)
    : [];

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Internal Notes</h2>

      {/* Add note form */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-2">
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add a note..."
              onKeyDown={(e) => {
                if (e.key === "Enter" && note.trim()) {
                  addNote.mutate({ customerId, note: note.trim() });
                }
              }}
            />
            <Button
              onClick={() => addNote.mutate({ customerId, note: note.trim() })}
              disabled={!note.trim() || addNote.isPending}
            >
              <MessageSquarePlus className="mr-1.5 h-4 w-4" />
              Add
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Notes list */}
      {lines.length === 0 ? (
        <div className="py-8 text-center text-muted-foreground">No notes yet.</div>
      ) : (
        <div className="space-y-2">
          {lines.map((line, i) => {
            const match = line.match(/^\[(\d{4}-\d{2}-\d{2}T[\d:.]+Z?)\]\s*(.+?):\s*(.+)$/);
            if (match) {
              const [, timestamp, author, content] = match;
              return (
                <Card key={i}>
                  <CardContent className="py-3 px-4">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
                      <span className="font-medium text-foreground">{author}</span>
                      <span>{new Date(timestamp!).toLocaleString("en-AU")}</span>
                    </div>
                    <p className="text-sm">{content}</p>
                  </CardContent>
                </Card>
              );
            }
            return (
              <Card key={i}>
                <CardContent className="py-3 px-4">
                  <p className="text-sm">{line}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
