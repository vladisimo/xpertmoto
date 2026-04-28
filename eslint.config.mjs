import nextPlugin from "@next/eslint-plugin-next";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
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
      // React Compiler rules (react-hooks v7 preview) are too noisy against
      // an existing codebase; demote to warn so they surface without blocking.
      // Revisit when the React Compiler stabilises.
      "react-hooks/immutability": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/set-state-in-effect": "warn",
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
    ],
    rules: {
      "no-console": "off",
    },
  },
];
