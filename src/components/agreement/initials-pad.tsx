"use client";

import { SignaturePad, type SignaturePadProps } from "./signature-pad";

export function InitialsPad(props: Omit<SignaturePadProps, "aspectRatio" | "label">) {
  return (
    <SignaturePad
      {...props}
      aspectRatio={1.6}
      label="Initials"
      acceptLabel={props.acceptLabel ?? "Apply initials"}
    />
  );
}
