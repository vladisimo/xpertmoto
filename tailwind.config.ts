import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    container: { center: true, padding: "1rem", screens: { "2xl": "1400px" } },
    extend: {
      fontFamily: {
        sans: ["var(--font-rubik)", "Rubik", "system-ui", "sans-serif"],
        display: [
          "var(--font-display)",
          "var(--font-rubik)",
          "system-ui",
          "sans-serif",
        ],
      },
      fontSize: {
        // Semantic heading/body scale. Prefer these over raw text-3xl etc.
        // Weight 500 (medium) in DM Sans reads strong without bolding — matches
        // XPERT's "large but not bold" display style.
        "display": ["clamp(2.25rem, 3vw + 1rem, 3rem)", { lineHeight: "1.1",  letterSpacing: "0.005em", fontWeight: "500" }],
        "h1":      ["clamp(1.5rem, 1vw + 1rem, 2rem)", { lineHeight: "1.2",  letterSpacing: "0.01em",  fontWeight: "500" }],
        "h2":      ["1.375rem",                        { lineHeight: "1.3",  letterSpacing: "0.005em", fontWeight: "500" }],
        "h3":      ["1.0625rem",                       { lineHeight: "1.4",                           fontWeight: "500" }],
        "body":    ["0.9375rem",                       { lineHeight: "1.55", letterSpacing: "0.012em" }],
        "caption": ["0.8125rem",                       { lineHeight: "1.45", letterSpacing: "0.012em" }],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        // Role-specific shell accents. Used only by back-office layout chrome —
        // never inside content. Pages themselves stay on semantic tokens.
        staff: {
          DEFAULT: "hsl(var(--staff-accent))",
          foreground: "hsl(var(--staff-accent-foreground))",
        },
        admin: {
          DEFAULT: "hsl(var(--admin-accent))",
          foreground: "hsl(var(--admin-accent-foreground))",
        },
        // AI Insights surface accent. Kept separate from staff/admin so the
        // insights panel reads as its own distinct product within the back-
        // office shell. Use only on /ai-insights pages.
        insights: {
          DEFAULT: "hsl(var(--insights-accent))",
          foreground: "hsl(var(--insights-accent-foreground))",
          soft: "hsl(var(--insights-accent-soft))",
        },
        // `brand` is DEPRECATED. New code must use semantic tokens above.
        // Retained temporarily so already-shipped marketing pages render
        // until migrated in Phase 3.
        brand: {
          DEFAULT: "hsl(var(--primary))",
          green: "hsl(var(--primary))",
          amber: "hsl(var(--secondary))",
          sky: "hsl(var(--accent))",
          orange: "hsl(var(--primary))",
          blue: "hsl(var(--accent))",
          ink: "hsl(var(--foreground))",
          bg: "hsl(var(--background))",
          soft: "hsl(var(--muted))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      // Named transition-duration so callers can avoid `duration-[1200ms]`,
      // which tailwindcss-animate makes ambiguous (it also registers a
      // `duration-*` namespace for animation-duration). A named key that
      // exists only here resolves unambiguously to transition-duration.
      transitionDuration: {
        "1200": "1200ms",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
