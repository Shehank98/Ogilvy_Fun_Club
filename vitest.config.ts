import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // The Postgres integration tests share one database, so they must not run
    // in parallel with each other.
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
