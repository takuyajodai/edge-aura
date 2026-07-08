import { defineConfig } from "vitest/config";

// Engine tests run in plain node with the stub-canvas harness; the React
// adapter tests opt into jsdom via a `@vitest-environment jsdom` docblock.
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.{ts,tsx}"],
  },
});
