"use client";

import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NewCustomerSheet } from "./new-customer-sheet";

export function CustomersHeaderActions() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" />
        New customer
      </Button>
      <NewCustomerSheet open={open} onOpenChange={setOpen} />
    </>
  );
}
