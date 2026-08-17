// The package export map is aliased to this file, so the real ESM build is
// loaded by path. Package types live on the public specifier.
// @ts-expect-error -- ESM build ships without adjacent declarations.
export { default } from "../../node_modules/embla-carousel-autoplay/esm/embla-carousel-autoplay.esm.js";
