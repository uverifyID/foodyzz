import type { Metadata } from "next";
import ContactForm from "@/components/ContactForm";
import { site } from "@/lib/siteConfig";

export const metadata: Metadata = {
  title: "Contact",
  description: "Get in touch with the UniHamper team — questions, partnerships, or provider onboarding.",
};

export default function ContactPage() {
  return (
    <div className="mx-auto max-w-5xl px-5 py-16">
      <div className="grid gap-12 md:grid-cols-2">
        <div>
          <span className="inline-block border-2 border-ink bg-accent-blue px-3 py-1.5 text-xs font-bold uppercase tracking-widest shadow-brutal-sm">
            Say hello
          </span>
          <h1 className="display-heading mt-6 text-5xl sm:text-6xl">
            Contact us
          </h1>
          <p className="mt-5 text-lg text-ink/70">
            Questions, partnership ideas, or want to bring your laundromat
            onboard? Drop us a line and we&apos;ll get back to you.
          </p>

          <div className="mt-10 space-y-4">
            <ContactRow label="Email">
              <a href={`mailto:${site.email}`} className="font-bold underline">
                {site.email}
              </a>
            </ContactRow>
            <ContactRow label="Social">
              <span className="flex gap-4 font-bold">
                <a href={site.social.instagram} className="underline">Instagram</a>
                <a href={site.social.tiktok} className="underline">TikTok</a>
                <a href={site.social.x} className="underline">X</a>
              </span>
            </ContactRow>
          </div>
        </div>

        <div className="brutal-card bg-paper p-7">
          <ContactForm />
        </div>
      </div>
    </div>
  );
}

function ContactRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-4">
      <span className="w-16 shrink-0 text-xs font-bold uppercase tracking-widest text-ink/50">
        {label}
      </span>
      <span>{children}</span>
    </div>
  );
}
