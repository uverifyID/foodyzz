/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./App.{js,jsx,ts,tsx}",
    "./app/**/*.{js,jsx,ts,tsx}",
    "./src/**/*.{js,jsx,ts,tsx}",
    "./screens/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
    "./navigation/**/*.{js,jsx,ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        // Sampled from the foodyzz wordmark (#86B54F, hue 88°). `green` is a FILL
        // tone — pair it with BLACK text (8.7:1); white on it is only 2.4:1.
        // `green.dark` is the text-on-white tone (5.4:1).
        // Nested under `green` with a DEFAULT so Tailwind emits the KEBAB-CASE
        // classes the screens actually use: `bg-brand-green` (DEFAULT) plus
        // `text-brand-green-dark` / `-mid` / `-ink`. The previous flat camelCase
        // keys (greenDark) only ever generated `text-brand-greenDark`, so all 17
        // `text-brand-green-dark` call sites matched NO rule and rendered with no
        // color at all — which on Android falls back to the theme's text color
        // (white under the system dark theme) and made the totals invisible.
        brand: {
          green: {
            DEFAULT: '#86B54F',
            mid: '#658F32',
            dark: '#507425',
            ink: '#2B4011',
          },
        },
      },
      fontFamily: {
        sans: ['Inter'],
        mono: ['JetBrainsMono-Regular'],
        bold: ['Inter-Bold'],
        black: ['Inter-Black'],
        display: ['SpaceGrotesk-Bold'],
      },
    },
  },
  plugins: [],
}
