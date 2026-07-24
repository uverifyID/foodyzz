import type { Metadata } from "next";
import Link from "next/link";
import FaqAccordion from "@/components/FaqAccordion";
import { faqs } from "@/lib/siteConfig";

export const metadata: Metadata = {
  title: "FAQ",
  description: "Answers to common questions about UniHamper — pricing, pickups, earning as a provider, and availability.",
};

export default function FaqPage() {
  return (
    <div className="mx-auto max-w-3xl px-5 py-16">
      <span className="inline-block border-2 border-ink bg-accent-pink px-3 py-1.5 text-xs font-bold uppercase tracking-widest shadow-brutal-sm">
        Got questions?
      </span>
      <h1 className="display-heading mt-6 text-5xl sm:text-6xl">
        Frequently asked questions
      </h1>
      <p className="mt-5 text-lg text-ink/70">
        Everything you need to know about sending out laundry and earning on
        UniHamper. Still stuck?{" "}
        <Link href="/contact" className="font-bold underline">
          Contact us
        </Link>
        .
      </p>

      <div className="mt-12">
        <FaqAccordion items={faqs} />
      </div>
    </div>
  );
}
