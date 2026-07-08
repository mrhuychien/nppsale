import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        // Legacy shadcn aliases — driven by CSS vars in globals.css.
        // Values updated to match Precision Enterprise palette so existing
        // components inherit the new look without code changes.
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        // Legacy surface aliases (kept for backwards compat with existing code).
        "surface-lowest": "hsl(var(--surface-container-lowest))",
        "surface-low": "hsl(var(--surface-container-low))",
        "surface-container": "hsl(var(--surface-container))",
        "surface-high": "hsl(var(--surface-container-high))",
        "surface-highest": "hsl(var(--surface-container-highest))",
        success: "#10b981",
        warning: "#f59e0b",
        danger: "#ba1a1a",

        // === Precision Enterprise tokens (Stitch design system) ===
        // Direct hex so they don't depend on the CSS-var bridge.
        surface: "#f7fafd",
        "surface-dim": "#d7dadd",
        "surface-bright": "#f7fafd",
        "surface-container-lowest": "#ffffff",
        "surface-container-low": "#f1f4f7",
        "surface-container-high": "#e5e8eb",
        "surface-container-highest": "#e0e3e6",
        "on-surface": "#181c1e",
        "on-surface-variant": "#434654",
        "inverse-surface": "#2d3133",
        "inverse-on-surface": "#eef1f4",
        outline: "#737685",
        "outline-variant": "#c3c6d6",
        "surface-tint": "#0c56d0",
        "on-primary": "#ffffff",
        "primary-container": "#0052cc",
        "on-primary-container": "#c4d2ff",
        "inverse-primary": "#b2c5ff",
        "primary-fixed": "#dae2ff",
        "primary-fixed-dim": "#b2c5ff",
        "on-primary-fixed": "#001848",
        "on-primary-fixed-variant": "#0040a2",
        "on-secondary": "#ffffff",
        "secondary-container": "#d6e3fb",
        "on-secondary-container": "#586579",
        "secondary-fixed": "#d6e3fb",
        "secondary-fixed-dim": "#bac7de",
        "on-secondary-fixed": "#0f1c2d",
        "on-secondary-fixed-variant": "#3b485a",
        tertiary: "#004e33",
        "on-tertiary": "#ffffff",
        "tertiary-container": "#006846",
        "on-tertiary-container": "#5debaf",
        "tertiary-fixed": "#6ffbbe",
        "tertiary-fixed-dim": "#4edea3",
        "on-tertiary-fixed": "#002113",
        "on-tertiary-fixed-variant": "#005236",
        error: "#ba1a1a",
        "on-error": "#ffffff",
        "error-container": "#ffdad6",
        "on-error-container": "#93000a",
        "surface-variant": "#e0e3e6",
        "on-background": "#181c1e",
      },
      fontFamily: {
        sans: ["var(--font-manrope)", "system-ui", "-apple-system", "sans-serif"],
        manrope: ["var(--font-manrope)", "system-ui", "sans-serif"],
        // Kept so any stray `font-inter` class doesn't break — resolves to Manrope.
        inter: ["var(--font-manrope)", "system-ui", "sans-serif"],
      },
      fontSize: {
        "headline-xl": ["30px", { lineHeight: "38px", letterSpacing: "-0.02em", fontWeight: "700" }],
        "headline-lg": ["24px", { lineHeight: "32px", fontWeight: "600" }],
        "headline-md": ["20px", { lineHeight: "28px", fontWeight: "600" }],
        "body-lg": ["16px", { lineHeight: "24px", fontWeight: "400" }],
        "body-md": ["14px", { lineHeight: "20px", fontWeight: "400" }],
        "label-md": ["12px", { lineHeight: "16px", letterSpacing: "0.05em", fontWeight: "600" }],
        "data-tabular": ["14px", { lineHeight: "20px", fontWeight: "500" }],
      },
      spacing: {
        "stack-sm": "8px",
        gutter: "16px",
        "stack-md": "16px",
        "card-gap": "20px",
        "stack-lg": "24px",
        "container-padding": "24px",
      },
      borderRadius: {
        // Shadcn legacy radius (drives lg/md/sm via --radius).
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        // Refreshed scale — softer, more modern corners.
        xl: "0.875rem",
        "2xl": "1.25rem",
        "3xl": "1.5rem",
      },
      boxShadow: {
        card: "0 1px 2px rgba(16, 24, 40, 0.04), 0 4px 16px -4px rgba(16, 24, 40, 0.06)",
        "card-hover": "0 4px 10px -2px rgba(16, 24, 40, 0.06), 0 16px 40px -8px rgba(16, 24, 40, 0.1)",
        overlay: "0 8px 20px -6px rgba(16, 24, 40, 0.1), 0 24px 56px -12px rgba(16, 24, 40, 0.16)",
        brand: "0 8px 24px -6px hsl(222 83% 53% / 0.35)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
export default config;
