import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "cli:unit",
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
