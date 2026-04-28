import type { SVGProps } from "react";

/**
 * Provider marks used on OAuth buttons. Apple + Microsoft use monochrome
 * marks so they adopt `text-foreground` — keeps the button row visually
 * coherent on light/dark. Google keeps its brand colours because a single-
 * colour Google "G" reads as generic and users look for the four-colour
 * logo to trust the button.
 */

export function AppleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      width="16"
      height="16"
      {...props}
    >
      <path d="M17.05 12.74c-.02-2.43 1.98-3.6 2.07-3.66-1.13-1.65-2.88-1.88-3.5-1.9-1.49-.15-2.9.88-3.65.88-.76 0-1.92-.85-3.16-.83-1.62.02-3.12.94-3.96 2.4-1.69 2.93-.43 7.27 1.22 9.65.8 1.17 1.76 2.49 3.01 2.44 1.21-.05 1.67-.78 3.13-.78s1.88.78 3.16.76c1.31-.02 2.13-1.19 2.93-2.37.92-1.36 1.3-2.67 1.32-2.74-.03-.01-2.54-.98-2.57-3.85zM14.64 5.54c.67-.82 1.12-1.95.99-3.08-.96.04-2.12.64-2.81 1.45-.62.72-1.17 1.88-1.02 2.99 1.07.08 2.17-.55 2.84-1.36z" />
    </svg>
  );
}

export function MicrosoftIcon(props: SVGProps<SVGSVGElement>) {
  // Four-quadrant mark in a single colour so it adopts text-foreground.
  return (
    <svg
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
      width="16"
      height="16"
      {...props}
    >
      <path d="M2 2h9.5v9.5H2zM12.5 2H22v9.5h-9.5zM2 12.5h9.5V22H2zM12.5 12.5H22V22h-9.5z" />
    </svg>
  );
}

export function GoogleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden
      width="16"
      height="16"
      {...props}
    >
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.75h3.57c2.08-1.92 3.28-4.74 3.28-8.07z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.75c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.12A6.6 6.6 0 0 1 5.5 12c0-.74.13-1.45.34-2.12V7.04H2.18A11 11 0 0 0 1 12c0 1.78.43 3.47 1.18 4.96l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.2 1.65l3.15-3.15C17.46 2.08 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.04l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"
      />
    </svg>
  );
}
