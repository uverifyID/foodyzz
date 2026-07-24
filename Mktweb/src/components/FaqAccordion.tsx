"use client";

import { useState } from "react";
import type { Faq } from "@/lib/siteConfig";

export default function FaqAccordion({ items }: { items: Faq[] }) {
  const [open, setOpen] = useState<number | null>(0);

  return (
    <div className="space-y-4">
      {items.map((item, i) => {
        const isOpen = open === i;
        return (
          <div key={i} className="brutal-card overflow-hidden">
            <button
              type="button"
              onClick={() => setOpen(isOpen ? null : i)}
              aria-expanded={isOpen}
              className={`flex w-full items-center justify-between gap-4 px-5 py-4 text-left ${
                isOpen ? "bg-accent-yellow" : "bg-paper"
              }`}
            >
              <span className="text-lg font-bold tracking-tight">{item.q}</span>
              <span
                className={`shrink-0 font-display text-2xl transition-transform ${
                  isOpen ? "rotate-45" : ""
                }`}
                aria-hidden
              >
                +
              </span>
            </button>
            {isOpen && (
              <div className="border-t-2 border-ink px-5 py-4 text-ink/75">
                {item.a}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
