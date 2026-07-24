import Link from "next/link";
import StoreBadges from "@/components/StoreBadges";
import QrCode from "@/components/QrCode";
import Icon from "@/components/Icons";
import Placeholder from "@/components/Placeholder";
import {
  site,
  apps,
  customerSteps,
  providerOffers,
  providerStats,
  providerStatsFootnote,
  busyFeatures,
  type AppInfo,
} from "@/lib/siteConfig";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://mkt.unihamper.com";

export default function HomePage() {
  return (
    <div className="mx-auto max-w-6xl px-5">
      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="pb-16 pt-8 md:pb-24 md:pt-12">
        <div className="flex flex-wrap gap-3">
          <span className="border-2 border-ink bg-paper px-3 py-1.5 text-xs font-bold uppercase tracking-tight shadow-brutal-sm">
            ✦ {site.tagline}
          </span>
          <span className="border-2 border-ink bg-accent-pink px-3 py-1.5 text-xs font-bold uppercase tracking-tight shadow-brutal-sm">
            Built for College Life
          </span>
        </div>

        <h1 className="display-heading mt-8 text-6xl sm:text-7xl md:text-8xl">
          Stop washing.
          <br />
          Start{" "}
          <span className="inline-block -rotate-1 border-2 border-ink bg-accent-light-orange px-3 shadow-brutal-sm">
            living.
          </span>
        </h1>

        <p className="mt-8 max-w-xl text-lg leading-relaxed text-ink/70">
          One tap to send out your laundry. Or one tap to start earning by
          washing it. UniHamper connects busy people with neighbors and laundromats
          who&apos;ll handle it for them.
        </p>
      </section>

      {/* ── Dual download cards ──────────────────────────────────────────── */}
      <section id="get-the-app" className="grid gap-8 pb-8 md:grid-cols-2">
        <DownloadCard
          tag="For Customers"
          cardClass="bg-brand-logo-orange"
          title="Need laundry done?"
          body="Schedule a pickup in 30 seconds. We wash, dry, fold and bring it back fresh. Perfect for dorms, late-night study marathons, and adulting."
          app={apps.customer}
        />
        <DownloadCard
          tag="For Providers"
          cardClass="bg-accent-silver"
          title="Want to earn money?"
          body="Got a washer, a car and free time? Or an under-used laundromat? Turn your free time and vehicle into cash by doing laundry. Set your hours. UBER/Lyft drivers can also join and drive less, save on gas, and out-earn rideshare apps."
          app={apps.provider}
        />
      </section>

      {/* ── How it works (customers) ─────────────────────────────────────── */}
      <section className="border-t-2 border-ink py-16">
        <Eyebrow>For Customers · 3 Steps</Eyebrow>
        <h2 className="display-heading mt-5 max-w-2xl text-4xl sm:text-5xl">
          From dirty pile to delivered, while you finish your Friday.
        </h2>

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {customerSteps.map((step) => (
            <div key={step.n} className="brutal-card p-6">
              <span className="inline-flex border-2 border-ink bg-accent-light-orange p-2">
                <Icon name={step.icon} />
              </span>
              <p className="mt-4 font-display text-4xl text-ink/25">{step.n}</p>
              <h3 className="mt-1 text-lg font-bold tracking-tight">
                {step.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-ink/70">
                {step.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* ── Two ways to earn (providers) ─────────────────────────────────── */}
      <section className="py-8">
        <Eyebrow>For Providers</Eyebrow>
        <h2 className="display-heading mt-5 text-4xl sm:text-5xl">
          Two ways to earn with UniHamper HQ.
        </h2>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {providerOffers.map((offer) => (
            <div key={offer.tag} className="brutal-card flex flex-col p-7">
              <span className="inline-flex w-fit items-center gap-2 border-2 border-ink bg-paper px-3 py-1 text-xs font-bold uppercase tracking-widest">
                <Icon name={offer.icon} width={14} height={14} />
                {offer.tag}
              </span>
              <h3 className="display-heading mt-5 text-2xl sm:text-3xl">
                {offer.title}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-ink/70">
                {offer.body}
              </p>

              {offer.features.length > 0 ? (
                <div className="mt-6 grid gap-4 sm:grid-cols-3">
                  {offer.features.map((f) => (
                    <div key={f.label} className="border-2 border-ink p-3">
                      <Icon name={f.icon} />
                      <p className="mt-2 text-sm font-bold leading-tight">
                        {f.label}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <Placeholder
                  label="Laundromat photo"
                  icon="building"
                  tint="bg-ink/5"
                  className="mt-6 aspect-[16/9] w-full"
                />
              )}
            </div>
          ))}
        </div>

        {/* Stats bar — the gap shows the black container through as dividers. */}
        <div className="mt-6 grid grid-cols-2 gap-[2px] border-2 border-ink bg-ink shadow-brutal md:grid-cols-4">
          {providerStats.map((stat) => (
            <div key={stat.label} className="bg-paper p-6">
              <p className="font-display text-3xl sm:text-4xl">{stat.value}</p>
              <p className="mt-1 text-xs uppercase tracking-widest text-ink/60">
                {stat.label}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-ink/50">{providerStatsFootnote}</p>
      </section>

      {/* ── Built for busy people ────────────────────────────────────────── */}
      <section className="py-16">
        <span className="inline-block border-2 border-ink bg-paper px-3 py-1.5 text-xs font-bold uppercase tracking-widest shadow-brutal-sm">
          Built for Busy People
        </span>
        <h2 className="display-heading mt-5 max-w-2xl text-4xl sm:text-5xl">
          Made for dorm rooms, demo days and double shifts.
        </h2>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <Placeholder
            label="Lifestyle photo"
            icon="smile"
            tint="bg-accent-blue"
            className="min-h-[18rem]"
          />
          <div className="grid gap-6 sm:grid-cols-2">
            {busyFeatures.map((f) => (
              <div key={f.title} className="brutal-card p-5">
                <span className="inline-flex border-2 border-ink bg-accent-light-orange p-2">
                  <Icon name={f.icon} />
                </span>
                <h3 className="mt-3 text-base font-bold tracking-tight">
                  {f.title}
                </h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink/70">
                  {f.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Closing dual-app CTA ─────────────────────────────────────────── */}
      <section className="mb-4 border-2 border-ink bg-ink p-8 text-paper shadow-brutal md:p-12">
        <div className="grid items-center gap-8 md:grid-cols-2">
          <div>
            <span className="inline-block bg-accent-light-orange px-3 py-1 text-xs font-bold uppercase tracking-widest text-ink">
              Tap. Toss. Done.
            </span>
            <h2 className="display-heading mt-5 text-4xl sm:text-5xl">
              Skip the wash. Or get paid to wash.
            </h2>
            <p className="mt-4 max-w-md text-paper/70">
              Two apps. One platform. Pick whichever side of the laundry economy
              you&apos;re on — or both.
            </p>
          </div>

          <div className="flex flex-col gap-4">
            <AppLinkRow app={apps.customer} note="Send out laundry" />
            <AppLinkRow app={apps.provider} note="Earn as a provider" />
            <Link
              href="/faq"
              className="mt-1 inline-flex items-center justify-center border-2 border-paper px-5 py-3 text-sm font-bold uppercase tracking-tight text-paper transition-transform active:translate-y-[2px]"
            >
              Read FAQ first
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}

// ── Local building blocks ─────────────────────────────────────────────────────

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block border-2 border-ink bg-paper px-3 py-1.5 text-xs font-bold uppercase tracking-widest shadow-brutal-sm">
      {children}
    </span>
  );
}

function DownloadCard({
  tag,
  cardClass,
  title,
  body,
  app,
}: {
  tag: string;
  cardClass: string;
  title: string;
  body: string;
  app: AppInfo;
}) {
  return (
    <div className={`brutal-card ${cardClass} p-7 shadow-brutal-lg`}>
      <span className="inline-block border-2 border-ink bg-paper px-3 py-1 text-xs font-bold uppercase tracking-widest">
        {tag}
      </span>
      <h2 className="display-heading mt-5 text-4xl sm:text-5xl">{title}</h2>
      <p className="mt-4 text-sm leading-relaxed text-ink/80">{body}</p>

      <div className="mt-7 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <StoreBadges app={app} />
        <QrCode value={siteUrl} label={`Scan for ${app.name}`} />
      </div>
    </div>
  );
}

function AppLinkRow({ app, note }: { app: AppInfo; note: string }) {
  return (
    <a
      href={app.appStore}
      target="_blank"
      rel="noopener noreferrer"
      className="group flex items-center justify-between gap-4 border-2 border-paper bg-ink px-5 py-3 transition-colors hover:bg-paper hover:text-ink"
    >
      <span>
        <span className="block font-display text-lg uppercase tracking-tight">
          Get {app.name}
        </span>
        <span className="block text-xs uppercase tracking-widest opacity-60">
          {note}
        </span>
      </span>
      <Icon name="arrow" className="transition-transform group-hover:translate-x-1" />
    </a>
  );
}
