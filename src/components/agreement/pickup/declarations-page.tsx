"use client";

import { useState } from "react";

import { useBranding } from "@/components/shared/branding-provider";

function buildItems(siteName: string): string[] {
  return [
    "I am the person named on the cover page and I have presented my current, valid licence.",
    "I have not consumed alcohol or any drug that could impair my ability to drive safely.",
    "I will be the sole driver of this vehicle unless another driver has been named and signed this agreement.",
    "I understand that all traffic and parking infringements and tolls incurred during the hire period are my responsibility.",
    `I will notify ${siteName} as soon as possible of any collision, theft, fire, damage, mechanical issue, or infringement.`,
    "I have reviewed the vehicle's pre-hire condition and accept it as the starting condition of the hire.",
  ];
}

export function DeclarationsPage() {
  const { siteName } = useBranding();
  const ITEMS = buildItems(siteName);
  const [checked, setChecked] = useState<boolean[]>(() => ITEMS.map(() => false));
  return (
    <div className="space-y-3 text-sm">
      <p>By initialling this page, you confirm each of the following:</p>
      <ul className="space-y-2">
        {ITEMS.map((text, i) => (
          <li key={i}>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4"
                checked={checked[i]}
                onChange={(e) =>
                  setChecked((prev) => {
                    const next = [...prev];
                    next[i] = e.target.checked;
                    return next;
                  })
                }
              />
              <span>{text}</span>
            </label>
          </li>
        ))}
      </ul>
      <p className="caption">
        Tick each declaration as the staff member reads it aloud. The initials pad below records your agreement to all
        declarations together.
      </p>
    </div>
  );
}
