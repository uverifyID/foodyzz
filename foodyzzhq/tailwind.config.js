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
        // `greenDark` is the text-on-white tone (5.4:1).
        brand: {
          green: '#86B54F',
          greenMid: '#658F32',
          greenDark: '#507425',
          greenInk: '#2B4011',
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
