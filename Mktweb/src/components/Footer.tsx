import Link from "next/link";
import { site } from "@/lib/siteConfig";

export default function Footer() {
  const year = "2026"; // bump on each release; kept static for deterministic builds
  return (
    <footer className="mt-20 border-t-2 border-ink bg-ink text-paper">
      <div className="mx-auto grid max-w-6xl gap-8 px-5 py-12 sm:grid-cols-2 md:grid-cols-4">
        <div className="sm:col-span-2">
          <p className="font-display text-2xl uppercase tracking-tight">
            {site.name}
          </p>
          <p className="mt-2 max-w-xs text-sm text-paper/70">
            {site.tagline}. Stop washing. Start living.
          </p>
        </div>

        <div>
          <p className="mb-3 text-xs font-bold uppercase tracking-widest text-paper/50">
            Explore
          </p>
          <ul className="space-y-2 text-sm">
            <li><Link href="/" className="hover:underline">Home</Link></li>
            <li><Link href="/faq" className="hover:underline">FAQ</Link></li>
            <li><Link href="/contact" className="hover:underline">Contact</Link></li>
            <li><Link href="/terms" className="hover:underline">Terms &amp; Conditions</Link></li>
            <li><Link href="/privacy" className="hover:underline">Privacy</Link></li>
          </ul>
        </div>

        <div>
          <p className="mb-3 text-xs font-bold uppercase tracking-widest text-paper/50">
            Follow
          </p>
          <ul className="space-y-2 text-sm">
            <li><a href={site.social.instagram} className="hover:underline">Instagram</a></li>
            <li><a href={site.social.tiktok} className="hover:underline">TikTok</a></li>
            <li><a href={site.social.x} className="hover:underline">X</a></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-paper/20 px-5 py-4 text-center text-xs text-paper/50">
        © {year} {site.name}. All rights reserved.
      </div>
    </footer>
  );
}
