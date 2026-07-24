"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";

const nav = [
  { href: "/", label: "Home" },
  { href: "/faq", label: "FAQ" },
  { href: "/contact", label: "Contact" },
];

export default function Header() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="sticky top-0 z-50 border-b-2 border-ink bg-paper">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-2">
        <Link href="/" className="flex items-center gap-2" aria-label="UniHamper home">
          <Image
            src="/unihamper-logo.png"
            alt="UniHamper"
            width={600}
            height={144}
            priority
            className="-my-8 h-32 w-auto md:-my-10 md:h-40"
          />
          <span className="hidden border-2 border-ink px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest sm:inline">
            .HQ Inside
          </span>
        </Link>

        <nav className="hidden items-center gap-8 md:flex">
          {nav.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`text-sm font-bold uppercase tracking-tight ${
                  active
                    ? "border-b-2 border-brand-orange text-ink"
                    : "text-ink/70 hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-3">
          <Link
            href="/#get-the-app"
            className="hidden bg-ink px-5 py-2.5 text-sm font-bold uppercase tracking-tight text-paper transition-transform active:translate-y-[2px] sm:inline-block"
          >
            Get the App
          </Link>
          <button
            type="button"
            aria-label="Toggle menu"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="border-2 border-ink p-2 md:hidden"
          >
            <span className="block h-0.5 w-5 bg-ink" />
            <span className="mt-1 block h-0.5 w-5 bg-ink" />
            <span className="mt-1 block h-0.5 w-5 bg-ink" />
          </button>
        </div>
      </div>

      {open && (
        <nav className="border-t-2 border-ink bg-paper px-5 py-3 md:hidden">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="block py-2 text-sm font-bold uppercase tracking-tight"
            >
              {item.label}
            </Link>
          ))}
          <Link
            href="/#get-the-app"
            onClick={() => setOpen(false)}
            className="mt-2 block bg-ink px-5 py-2.5 text-center text-sm font-bold uppercase tracking-tight text-paper"
          >
            Get the App
          </Link>
        </nav>
      )}
    </header>
  );
}
