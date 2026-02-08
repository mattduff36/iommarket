/**
 * tailwind.config.ts
 *
 * Reference configuration for the Marketplace Pro design system.
 *
 * NOTE: Tailwind CSS v4 reads theme values from the @theme block in
 * app/globals.css. This file exists as a programmatic reference of the
 * design-system.json tokens and can be consumed by tooling/scripts.
 *
 * If you need v3-style config loading, add `@config "../tailwind.config.ts"`
 * to your CSS file.
 */

import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: "var(--sem-bg-canvas)",
        surface: "var(--sem-bg-surface)",
        "surface-subtle": "var(--sem-bg-surfaceSubtle)",
        primary: {
          DEFAULT: "var(--sem-action-primary-bg)",
          hover: "var(--sem-action-primary-bgHover)",
          text: "var(--sem-action-primary-text)",
        },
        destructive: {
          DEFAULT: "var(--sem-action-destructive-bg)",
          hover: "var(--sem-action-destructive-bgHover)",
          text: "var(--sem-action-destructive-text)",
        },
        royal: {
          50: "var(--color-royalBlue-50)",
          100: "var(--color-royalBlue-100)",
          500: "var(--color-royalBlue-500)",
          600: "var(--color-royalBlue-600)",
          700: "var(--color-royalBlue-700)",
          800: "var(--color-royalBlue-800)",
        },
      },
      borderRadius: {
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        full: "var(--radius-full)",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        md: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
        outline: "var(--shadow-outline)",
      },
      fontFamily: {
        sans: [
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica",
          "Arial",
          "sans-serif",
        ],
      },
      fontSize: {
        xs: ["12px", { lineHeight: "1.5" }],
        sm: ["14px", { lineHeight: "1.5" }],
        base: ["16px", { lineHeight: "1.5" }],
        lg: ["18px", { lineHeight: "1.25" }],
        xl: ["20px", { lineHeight: "1.25" }],
        "2xl": ["24px", { lineHeight: "1.25" }],
        "3xl": ["30px", { lineHeight: "1.25" }],
      },
      spacing: {
        "0": "0px",
        "1": "4px",
        "2": "8px",
        "3": "12px",
        "4": "16px",
        "5": "20px",
        "6": "24px",
        "8": "32px",
        "10": "40px",
        "12": "48px",
        "16": "64px",
      },
      zIndex: {
        dropdown: "1000",
        sticky: "1100",
        fixed: "1200",
        "modal-backdrop": "1300",
        modal: "1400",
        tooltip: "1500",
      },
    },
  },
  plugins: [],
};

export default config;
