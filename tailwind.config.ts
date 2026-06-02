import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "rgb(var(--hub-ink-950) / <alpha-value>)",
          800: "rgb(var(--hub-ink-800) / <alpha-value>)",
          600: "rgb(var(--hub-ink-600) / <alpha-value>)",
        },
        mint: {
          600: "rgb(var(--hub-mint-600) / <alpha-value>)",
          500: "rgb(var(--hub-mint-500) / <alpha-value>)",
          100: "rgb(var(--hub-mint-100) / <alpha-value>)",
        },
        amberRisk: {
          500: "rgb(var(--hub-amber-500) / <alpha-value>)",
          100: "rgb(var(--hub-amber-100) / <alpha-value>)",
        },
        danger: {
          600: "rgb(var(--hub-danger-600) / <alpha-value>)",
          100: "rgb(var(--hub-danger-100) / <alpha-value>)",
        },
      },
      boxShadow: {
        soft: "0 18px 45px rgba(18, 20, 23, 0.08)",
      },
    },
  },
  plugins: [],
};

export default config;
