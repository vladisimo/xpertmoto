import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["tests/setup.ts"],
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["tests/e2e/**", "tests/integration/**", "node_modules/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      exclude: ["tests/**", ".next/**", "node_modules/**"],
    },
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["tests/**/*.test.ts"],
          exclude: [
            "tests/e2e/**",
            "tests/integration/**",
            "tests/unit/components/**",
            "tests/unit/hooks/**",
            "tests/unit/stores/**",
            "node_modules/**",
          ],
        },
      },
      {
        extends: true,
        test: {
          name: "jsdom",
          environment: "jsdom",
          include: [
            "tests/unit/components/**/*.test.{ts,tsx}",
            "tests/unit/hooks/**/*.test.{ts,tsx}",
            "tests/unit/stores/**/*.test.{ts,tsx}",
          ],
        },
      },
    ],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
