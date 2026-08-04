import { Image, Text, View } from "@react-pdf/renderer";

import type { PdfTheme } from "@/lib/pdf/theme";

/** One labelled issue pinned on a photo, as rendered in the PDFs. */
export type PdfPhotoIssue = {
  /** 1-based number shown on the pin and in the list. */
  n: number;
  label: string;
  severity: string;
  note?: string | null;
  posX?: number | null;
  posY?: number | null;
};

/** A condition photo plus the issues identified against it. */
export type PdfPhotoWithIssues = {
  url: string;
  caption?: string | null;
  side?: string | null;
  issues: PdfPhotoIssue[];
};

function severityColour(theme: PdfTheme, severity: string): string {
  if (severity === "MAJOR") return theme.colors.errorInk;
  if (severity === "MODERATE") return theme.colors.warnStrong;
  return theme.colors.alertBorder; // MINOR
}

function titleCase(s: string): string {
  return s ? s.charAt(0) + s.slice(1).toLowerCase() : s;
}

/**
 * Renders each condition photo with its labelled issues pinned on it (numbered
 * dots at the normalised posX/posY captured on the tablet) and listed beneath.
 * Replaces the old silhouette "damage map" — the evidence is the photo itself.
 * The photo box is a fixed 4:3 with object-cover to match the capture UI so the
 * pin coordinates line up.
 */
export function PhotoIssues({ theme, photos }: { theme: PdfTheme; photos: PdfPhotoWithIssues[] }) {
  if (photos.length === 0) {
    return (
      <Text style={{ fontSize: theme.size.body, color: theme.colors.muted }}>No photos were recorded.</Text>
    );
  }
  return (
    <View style={{ gap: theme.spacing.md }}>
      {photos.map((photo, pi) => {
        const pinned = photo.issues.filter((i) => i.posX != null && i.posY != null);
        return (
          <View key={`ph-${pi}`} wrap={false} style={{ marginBottom: theme.spacing.sm }}>
            <View
              style={{
                position: "relative",
                width: 200,
                height: 150,
                borderWidth: 1,
                borderColor: theme.colors.divider,
                borderRadius: theme.radii.sm,
              }}
            >
              <Image src={photo.url} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
              {pinned.map((iss) => (
                <View
                  key={`pin-${iss.n}`}
                  style={{
                    position: "absolute",
                    left: `${(iss.posX ?? 0) * 100}%`,
                    top: `${(iss.posY ?? 0) * 100}%`,
                    width: 14,
                    height: 14,
                    marginLeft: -7,
                    marginTop: -7,
                    borderRadius: 7,
                    backgroundColor: severityColour(theme, iss.severity),
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ fontSize: 8, color: "#FFFFFF", fontFamily: theme.font.bodyBold }}>{iss.n}</Text>
                </View>
              ))}
            </View>
            <Text style={{ fontSize: theme.size.micro, color: theme.colors.muted, marginTop: theme.spacing.xs }}>
              {photo.caption ?? photo.side ?? "Photo"}
            </Text>
            {photo.issues.length > 0 ? (
              <View style={{ marginTop: theme.spacing.xs }}>
                {photo.issues.map((iss) => (
                  <Text key={`li-${iss.n}`} style={{ fontSize: theme.size.body, marginBottom: 1 }}>
                    {iss.n}. {iss.label} · {titleCase(iss.severity)}
                    {iss.note ? ` — ${iss.note}` : ""}
                  </Text>
                ))}
              </View>
            ) : (
              <Text style={{ fontSize: theme.size.micro, color: theme.colors.muted, marginTop: theme.spacing.xs }}>
                No damage noted on this photo.
              </Text>
            )}
          </View>
        );
      })}
    </View>
  );
}
