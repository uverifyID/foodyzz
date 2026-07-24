import type { Config } from "tailwindcss";

// PHASE 1 palette — mirrors the Emergent reference site's neo-brutalist look.
// PHASE 2: swap these for final brand colors (UniHamper brand orange #FF4D00 etc.
// from scrubs/src/theme.ts) without touching component markup.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0A0A0A", // near-black for borders/text
        paper: "#FFFFFF",
        accent: {
          yellow: "#F7F75C", // hero highlight + provider card + ticker
          blue: "#AEBEF2", // customer card
          pink: "#F2A7A0", // "built for college life" tag
          "light-orange": "#FFB866", // ticker + tagline highlight
          silver: "#B4BCC8", // customer card silver
        },
        brand: {
          orange: "#FF4D00", // UniHamper brand (used sparingly in phase 1)
          "logo-orange": "#F07830", // warm orange matching the UniHamper logo
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "Impact", "sans-serif"],
      },
      boxShadow: {
        // Hard neo-brutalist drop shadows (no blur).
        brutal: "6px 6px 0 0 #0A0A0A",
        "brutal-sm": "4px 4px 0 0 #0A0A0A",
        "brutal-lg": "8px 8px 0 0 #0A0A0A",
      },
      keyframes: {
        marquee: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
      },
      animation: {
        marquee: "marquee 28s linear infinite",
      },
    },
  },
  plugins: [],
};

export default config;
