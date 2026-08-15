import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL("./", import.meta.url));
const vitestShim = fileURLToPath(new URL("./vitest.globals-shim.ts", import.meta.url));

export default defineConfig({
  root,
  test: {
    environment: "jsdom",
    include: ["**/__tests__/**/*.test.{ts,tsx}"],
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
  },
  resolve: {
    alias: [
      { find: /^vitest$/, replacement: vitestShim },
      { find: "@", replacement: root },
    ],
  },
});
