import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL("./", import.meta.url));
const vitestShim = fileURLToPath(new URL("./vitest.globals-shim.ts", import.meta.url));
const nextCacheStub = fileURLToPath(
  new URL("./__tests__/stubs/next-cache.ts", import.meta.url),
);
const nextNavigationStub = fileURLToPath(
  new URL("./__tests__/stubs/next-navigation.ts", import.meta.url),
);
const nextHeadersStub = fileURLToPath(
  new URL("./__tests__/stubs/next-headers.ts", import.meta.url),
);
const supabaseJsStub = fileURLToPath(
  new URL("./__tests__/stubs/supabase-js.ts", import.meta.url),
);
const emblaCarouselReactStub = fileURLToPath(
  new URL("./__tests__/stubs/embla-carousel-react.ts", import.meta.url),
);
const emblaCarouselAutoplayStub = fileURLToPath(
  new URL("./__tests__/stubs/embla-carousel-autoplay.ts", import.meta.url),
);

export default defineConfig({
  root,
  test: {
    environment: "node",
    include: ["**/__tests__/**/*.test.{ts,tsx}"],
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // Separate processes so env mutations cannot cross workers.
    // vitest.setup.ts restores process.env after each file.
    pool: "forks",
    // Subprocess and disposable-Postgres hooks exceed the 5s/10s defaults when workers share the machine.
    testTimeout: 20_000,
    hookTimeout: 30_000,
    server: {
      deps: {
        inline: [
          "embla-carousel-react",
          "embla-carousel-autoplay",
          "embla-carousel",
          "embla-carousel-reactive-utils",
        ],
      },
    },
  },
  resolve: {
    alias: [
      { find: /^vitest$/, replacement: vitestShim },
      { find: "@", replacement: root },
      {
        find: /^next\/cache(?:\.js)?$/,
        replacement: nextCacheStub,
      },
      {
        find: /(?:^|\/)next\/dist\/server\/web\/spec-extension\/revalidate(?:\.js)?$/,
        replacement: nextCacheStub,
      },
      {
        find: /^next\/navigation(?:\.js)?$/,
        replacement: nextNavigationStub,
      },
      {
        find: /^next\/headers(?:\.js)?$/,
        replacement: nextHeadersStub,
      },
      {
        find: /^@supabase\/supabase-js$/,
        replacement: supabaseJsStub,
      },
      {
        find: /(?:^|\/)next\/dist\/(?:client\/components\/(?:navigation(?:\.react-server)?|redirect|not-found)|api\/navigation)(?:\.js)?$/,
        replacement: nextNavigationStub,
      },
      {
        find: /^embla-carousel-react$/,
        replacement: emblaCarouselReactStub,
      },
      {
        find: /^embla-carousel-autoplay$/,
        replacement: emblaCarouselAutoplayStub,
      },
    ],
  },
});
