"use client";

export function FieldError({ message }: { message?: string | null }) {
  if (!message) return null;
  return <p className="text-sm text-destructive mt-1">{message}</p>;
}
