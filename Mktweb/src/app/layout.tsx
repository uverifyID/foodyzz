import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";
import Header from "@/components/Header";
import Ticker from "@/components/Ticker";
import Footer from "@/components/Footer";
import { site } from "@/lib/siteConfig";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "700"],
  variable: "--font-display",
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://mkt.unihamper.com";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "UniHamper — Stop washing. Start living.",
    template: "%s · UniHamper",
  },
  description:
    "UniHamper connects busy people with neighbors and laundromats who'll wash, dry, and fold for them. One tap to send out your laundry — or one tap to start earning.",
  openGraph: {
    title: "UniHamper — Stop washing. Start living.",
    description:
      "Uber for laundry. One tap to send out your laundry, or one tap to start earning.",
    url: siteUrl,
    siteName: site.name,
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "UniHamper",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "UniHamper — Stop washing. Start living.",
    description:
      "Uber for laundry. One tap to send out your laundry, or one tap to start earning.",
    images: ["/og-image.png"],
  },
  icons: { icon: "/unihamper-icon.png" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <body className="font-sans antialiased">
        <Header />
        <Ticker />
        <main>{children}</main>
        <Footer />
      </body>
    </html>
  );
}
