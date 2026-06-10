import nextPlugin from "@next/eslint-plugin-next";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      ".next-e2e/**",
      ".next-loadtest/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
      "public/**",
      "prisma/migrations/**",
      "next-env.d.ts",
      "tsconfig.tsbuildinfo",
      ".claude/hooks/**",
    ],
  },
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "@next/next": nextPlugin,
      "react-hooks": reactHooks,
    },
    rules: {
      ...nextPlugin.configs["core-web-vitals"].rules,
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "react-hooks/exhaustive-deps": "warn",
      // React Compiler rules (react-hooks v7 preview). Three of these fire
      // only on known false-positives / intentional patterns in this codebase
      // and are turned off:
      //   - immutability: trips on `window.location.href = ...` navigation
      //   - set-state-in-effect: prop->state sync effects we keep on purpose
      //   - incompatible-library: react-hook-form's `form.watch()`, unfixable
      // The rest stay at "warn" so genuinely new issues still surface.
      // Revisit when the React Compiler stabilises.
      "react-hooks/immutability": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/incompatible-library": "off",
      "react-hooks/purity": "warn",
      "react-hooks/set-state-in-render": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/static-components": "warn",
      "no-console": ["warn", { allow: ["warn", "error"] }],
    },
  },
  {
    // Server-only code (tRPC, jobs, services) must route through the pino
    // logger at src/lib/logger.ts so PII redaction applies. console.* bypasses
    // that path.
    files: ["src/server/**/*.{ts,tsx}", "src/app/api/**/*.{ts,tsx}"],
    rules: {
      "no-console": "error",
    },
  },
  {
    // CLI entry points. stdout is the intended output channel, not a
    // logger path — these scripts run one-shot and print progress/results
    // directly to the terminal.
    files: [
      "scripts/**/*.{ts,tsx,js,mjs,cjs}",
      "prisma/seed*.ts",
      // e2e global setup/teardown run one-shot before Playwright and print
      // progress directly to the terminal, same as the scripts above.
      "tests/e2e/global-*.ts",
    ],
    rules: {
      "no-console": "off",
    },
  },
  {
    // Playwright fixtures destructure a callback parameter named `use`
    // (`async ({ ... }, use) => { await use(value); }`). The
    // react-hooks/rules-of-hooks rule misreads `use(value)` as a React `use()`
    // hook call. Disable inside the fixtures dir only; product code is
    // unaffected.
    files: ["tests/e2e/_fixtures/**/*.{ts,tsx}"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
    },
  },
];
