import type { ReactElement, SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

export const VisaIcon = (props: IconProps) => (
  <svg viewBox="0 0 48 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
    <text
      x="24"
      y="13"
      textAnchor="middle"
      fontFamily="'Helvetica Neue', Arial, sans-serif"
      fontSize="14"
      fontWeight="900"
      fontStyle="italic"
      fill="#1A1F71"
      letterSpacing="-0.3"
    >
      VISA
    </text>
  </svg>
);

export const MastercardIcon = (props: IconProps) => (
  <svg viewBox="0 0 36 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
    <circle cx="14" cy="12" r="8" fill="#EB001B" />
    <circle cx="22" cy="12" r="8" fill="#F79E1B" />
    <path
      d="M18 6.1a8 8 0 0 1 0 11.8 8 8 0 0 1 0-11.8z"
      fill="#FF5F00"
    />
  </svg>
);

export const MaestroIcon = (props: IconProps) => (
  <svg viewBox="0 0 36 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
    <circle cx="14" cy="12" r="8" fill="#0066B3" />
    <circle cx="22" cy="12" r="8" fill="#E30613" />
    <path
      d="M18 6.1a8 8 0 0 1 0 11.8 8 8 0 0 1 0-11.8z"
      fill="#6C2C9A"
    />
  </svg>
);

export const AmexIcon = (props: IconProps) => (
  <svg viewBox="0 0 48 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
    <rect width="48" height="20" rx="2" fill="#006FCF" />
    <text
      x="24"
      y="13.5"
      textAnchor="middle"
      fontFamily="'Helvetica Neue', Arial, sans-serif"
      fontSize="9"
      fontWeight="800"
      fill="#FFFFFF"
      letterSpacing="0.5"
    >
      AMEX
    </text>
  </svg>
);

export const ApplePayIcon = (props: IconProps) => (
  <svg viewBox="0 0 48 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
    <path
      d="M9.1 6.6c.5-.6.8-1.4.7-2.2-.7 0-1.5.5-2 1.1-.4.5-.8 1.3-.7 2.1.8.1 1.6-.4 2-1zm.7.9c-1.1-.1-2 .6-2.5.6-.6 0-1.4-.6-2.3-.6-1.2 0-2.3.7-2.9 1.8-1.2 2.2-.3 5.4.9 7.2.6.9 1.3 1.9 2.2 1.8.9 0 1.2-.6 2.3-.6s1.4.6 2.3.6c1 0 1.6-.9 2.2-1.8.7-1 1-2 1-2.1 0 0-1.9-.7-1.9-3 0-1.9 1.5-2.8 1.6-2.9-.9-1.2-2.2-1.3-2.9-1.3z"
      fill="#000000"
    />
    <text
      x="26"
      y="14"
      fontFamily="'Helvetica Neue', Arial, sans-serif"
      fontSize="10"
      fontWeight="600"
      fill="#000000"
    >
      Pay
    </text>
  </svg>
);

export const DiscoverIcon = (props: IconProps) => (
  <svg viewBox="0 0 64 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
    <text
      x="1"
      y="12"
      fontFamily="'Helvetica Neue', Arial, sans-serif"
      fontSize="10"
      fontWeight="700"
      fill="#111111"
      letterSpacing="0.3"
    >
      DISCOVER
    </text>
    <circle cx="56" cy="8" r="4" fill="#FF6000" />
  </svg>
);

export const GooglePayIcon = (props: IconProps) => (
  <svg viewBox="0 0 48 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
    <g transform="translate(2 3)">
      <path d="M7 7h5.9c0 2.2-1.5 4.3-4.7 4.3A4.3 4.3 0 1 1 11 4.6l1.7-1.6A6.7 6.7 0 0 0 8.2 1.3a6.3 6.3 0 1 0 0 12.6c3.6 0 6.1-2.5 6.1-6.1 0-.4 0-.8-.1-1.2H7V7z" fill="#4285F4" />
    </g>
    <text
      x="20"
      y="14"
      fontFamily="'Helvetica Neue', Arial, sans-serif"
      fontSize="10"
      fontWeight="600"
      fill="#5F6368"
    >
      Pay
    </text>
  </svg>
);

export const ShopPayIcon = (props: IconProps) => (
  <svg viewBox="0 0 60 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" {...props}>
    <rect width="60" height="20" rx="4" fill="#5A31F4" />
    <text
      x="30"
      y="13.5"
      textAnchor="middle"
      fontFamily="'Helvetica Neue', Arial, sans-serif"
      fontSize="9"
      fontWeight="800"
      fill="#FFFFFF"
      letterSpacing="0.3"
    >
      shop Pay
    </text>
  </svg>
);

export interface PaymentMethod {
  name: string;
  Icon: (props: IconProps) => ReactElement;
}

export const PAYMENT_METHODS: readonly PaymentMethod[] = [
  { name: "Visa", Icon: VisaIcon },
  { name: "Mastercard", Icon: MastercardIcon },
  { name: "Maestro", Icon: MaestroIcon },
  { name: "American Express", Icon: AmexIcon },
  { name: "Apple Pay", Icon: ApplePayIcon },
  { name: "Discover", Icon: DiscoverIcon },
  { name: "Google Pay", Icon: GooglePayIcon },
  { name: "Shop Pay", Icon: ShopPayIcon },
] as const;
