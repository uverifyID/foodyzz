/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export: `next build` emits a self-contained `out/` folder of plain
  // HTML/CSS/JS that drops straight into Hostinger's public_html — no Node
  // process. (No server routes; the contact form posts to Formspree.)
  output: "export",
  // Image Optimization needs a server, which a static export doesn't have.
  images: { unoptimized: true },
  // Emit /faq/index.html etc. so clean URLs resolve on Apache static hosting.
  trailingSlash: true,
  reactStrictMode: true,
  poweredByHeader: false,
};

module.exports = nextConfig;
