"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { WalkInBookingSheet } from "@/components/staff/walk-in-booking-sheet";

export function NewWalkInButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>+ New walk-in</Button>
      <WalkInBookingSheet open={open} onOpenChange={setOpen} />
    </>
  );
}
