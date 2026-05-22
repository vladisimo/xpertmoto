"use client";

/**
 * Front + back driver's licence drag-and-drop pair. Renders two
 * IdentityDropzones side-by-side (stacked on mobile). The BACK zone is
 * gated until the FRONT has been uploaded so customers always upload in
 * order — required because the OCR pre-fill on FRONT writes the licence
 * fields into the profile/wizard form before the BACK upload runs the
 * projection that depends on the row existing.
 */

import * as React from "react";

import { IdentityDropzone, type IdentityExtractedPatch } from "./identity-dropzone";

interface LicenceProfileSlice {
  licenceImageFront: string | null;
  licenceImageBack: string | null;
  licenceExpiry: Date | string | null;
  licenceVerifiedAt: Date | string | null;
}

interface Props {
  profile: LicenceProfileSlice | null;
  /** Wizard-mode callback — extracted FRONT fields are emitted here. */
  onExtracted?: (patch: IdentityExtractedPatch) => void;
  /** Called after either side uploads — used to refetch parent queries. */
  onUploaded?: () => void;
}

export function LicenceDropzonePair({ profile, onExtracted, onUploaded }: Props) {
  const [frontJustUploaded, setFrontJustUploaded] = React.useState(false);
  const frontDone = !!profile?.licenceImageFront || frontJustUploaded;

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
      <IdentityDropzone
        kind="LICENCE_FRONT"
        currentImageUrl={profile?.licenceImageFront ?? null}
        currentExpiry={profile?.licenceExpiry ?? null}
        currentVerifiedAt={profile?.licenceVerifiedAt ?? null}
        onExtracted={onExtracted}
        onUploaded={() => {
          setFrontJustUploaded(true);
          onUploaded?.();
        }}
      />
      <IdentityDropzone
        kind="LICENCE_BACK"
        currentImageUrl={profile?.licenceImageBack ?? null}
        disabled={!frontDone}
        disabledHint="Upload the front first"
        onUploaded={onUploaded}
      />
    </div>
  );
}
