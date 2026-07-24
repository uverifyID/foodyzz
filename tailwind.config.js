/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}', './public/index.html'],
  theme: {
    extend: {
      colors: {
        // Sampled from the foodyzz wordmark (#86B54F, hue 88°). The 500 tone is a
        // FILL only — white text on it is 2.4:1, so it always carries BLACK ink
        // (8.7:1). Use -dark for green text on a white surface (5.4:1).
        'brand-green':      '#86B54F',
        'brand-green-mid':  '#658F32',
        'brand-green-dark': '#507425',
        'brand-green-ink':  '#2B4011',
      },
      fontFamily: {
        sans:    ['"Inter"', 'system-ui', 'sans-serif'],
        mono:    ['"JetBrains Mono"', '"Courier New"', 'monospace'],
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'brutalist':        '4px 4px 0px 0px rgba(0,0,0,1)',
        'brutalist-green':  '4px 4px 0px 0px rgba(134,181,79,1)',
        'brutalist-white':  '4px 4px 0px 0px rgba(255,255,255,1)',
      },
    },
  },
  plugins: [],
};
