import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import reactHooks from "eslint-plugin-react-hooks";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // Flat config only resolves a plugin's rules from the same object. Keep
    // new React Compiler diagnostics visible while the existing UI is migrated
    // incrementally; correctness rules such as rules-of-hooks remain errors.
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      "react-hooks/immutability": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "next-env.d.ts",
    "private/**",
  ]),
]);
