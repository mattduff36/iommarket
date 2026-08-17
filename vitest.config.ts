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
const emblaCarouselReactStub = fileURLToPath(
  new URL("./__tests__/stubs/embla-carousel-react.ts", import.meta.url),
);
const emblaCarouselAutoplayStub = fileURLToPath(
  new URL("./__tests__/stubs/embla-carousel-autoplay.ts", import.meta.url),
);

export default defineConfig({
  root,
  test: {
    environment: "jsdom",
    include: ["**/__tests__/**/*.test.{ts,tsx}"],
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    // Temporary deterministic mitigation while shared env/timer state is isolated.
    maxWorkers: 1,
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
