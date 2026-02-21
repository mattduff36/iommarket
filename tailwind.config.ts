/**
 * tailwind.config.ts
 *
 * Reference configuration for the iTrader design system v2.
 *
 * NOTE: Tailwind CSS v4 reads theme values from the @theme block in
 * app/globals.css. This file exists as a programmatic reference of the
 * design-system-2.json tokens and can be consumed by tooling/scripts.
 */

import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  darkMode: ["class", '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        canvas: "var(--sem-bg-canvas)",
        surface: "var(--sem-bg-surface)",
        "surface-elevated": "var(--sem-bg-surfaceElevated)",
        glass: "var(--sem-bg-glass)",
        graphite: {
          600: "var(--color-graphite-600)",
          700: "var(--color-graphite-700)",
          800: "var(--color-graphite-800)",
          900: "var(--color-graphite-900)",
          950: "var(--color-graphite-950)",
        },
        "neon-red": {
          400: "var(--color-neonRed-400)",
          500: "var(--color-neonRed-500)",
          600: "var(--color-neonRed-600)",
          glow: "var(--color-neonRed-glow)",
        },
        "neon-blue": {
          400: "var(--color-neonBlue-400)",
          500: "var(--color-neonBlue-500)",
          600: "var(--color-neonBlue-600)",
          glow: "var(--color-neonBlue-glow)",
        },
        "premium-gold": {
          400: "var(--color-premiumGold-400)",
          500: "var(--color-premiumGold-500)",
          600: "var(--color-premiumGold-600)",
          glow: "var(--color-premiumGold-glow)",
        },
        metallic: {
          100: "var(--color-metallic-100)",
          200: "var(--color-metallic-200)",
          300: "var(--color-metallic-300)",
          400: "var(--color-metallic-400)",
          500: "var(--color-metallic-500)",
        },
      },
      borderRadius: {
        none: "var(--radius-none)",
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        xl: "var(--radius-xl)",
        full: "var(--radius-full)",
      },
      boxShadow: {
        low: "var(--shadow-low)",
        high: "var(--shadow-high)",
        "neon-red": "var(--shadow-neonRed)",
        "neon-blue": "var(--shadow-neonBlue)",
        "glow-red": "var(--glow-red)",
        "glow-blue": "var(--glow-blue)",
        "glow-gold": "var(--glow-gold)",
        "glow-soft": "var(--glow-softWhite)",
      },
      fontFamily: {
        heading: ["var(--font-heading)"],
        body: ["var(--font-body)"],
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
      },
      zIndex: {
        base: "0",
        dropdown: "1000",
        overlay: "1300",
        modal: "1400",
        tooltip: "1500",
      },
      transitionTimingFunction: {
        fast: "cubic-bezier(0.4, 0, 0.2, 1)",
        premium: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
      transitionDuration: {
        fast: "150ms",
        premium: "400ms",
      },
    },
  },
  plugins: [],
};

export default config;
