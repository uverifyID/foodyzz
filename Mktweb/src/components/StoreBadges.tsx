import { apps, type AppInfo } from "@/lib/siteConfig";

// Outlined neo-brutalist store buttons (App Store + Google Play), matching the
// reference site. Inline SVG icons keep us off official badge image assets.
// Pass `app` to target UniHamper (customer) vs UniHamper HQ (provider) listings.
function AppleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16.365 1.43c0 1.14-.42 2.22-1.18 3.05-.9.99-2.37 1.76-3.61 1.66-.15-1.13.46-2.32 1.16-3.07.86-.91 2.32-1.6 3.45-1.64.02.06.18.61.18 0z" />
      <path d="M20.5 17.06c-.62 1.43-.92 2.07-1.72 3.34-1.12 1.77-2.7 3.97-4.65 3.99-1.74.02-2.18-1.13-4.54-1.12-2.36.01-2.85 1.14-4.59 1.12-1.95-.02-3.45-2-4.57-3.77C-2.1 16.99-2.42 9.97 1.05 6.32c1.24-1.31 2.86-2.04 4.39-2.04 1.56 0 2.54 1.06 4.49 1.06 1.89 0 2.86-1.06 4.49-1.06 1.36 0 2.81.74 3.84 2.02-3.37 1.85-2.82 6.66.25 8.36z" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M3.6 2.3c-.3.2-.5.6-.5 1.1v17.2c0 .5.2.9.5 1.1l9.4-9.7L3.6 2.3z" opacity=".9" />
      <path d="M16.8 8.9 13 12.7l3.8 3.8 3.5-2c.8-.5.8-1.7 0-2.2l-3.5-1.4z" />
      <path d="M3.6 2.3 14 12.7l2.8-2.8L5.3 1.6c-.6-.3-1.2-.2-1.7.7z" />
      <path d="m3.6 23.1 11.2-10.4 2 2L5.3 23.8c-.5.3-1.1.2-1.7-.7z" />
    </svg>
  );
}

export default function StoreBadges({
  app = apps.customer,
  size = "md",
}: {
  app?: AppInfo;
  size?: "sm" | "md";
}) {
  const pad = size === "sm" ? "px-3 py-2" : "px-4 py-2.5";
  return (
    <div className="flex flex-col gap-3">
      <a
        href={app.appStore}
        target="_blank"
        rel="noopener noreferrer"
        className={`flex items-center gap-3 border-2 border-ink bg-paper ${pad} shadow-brutal-sm transition-transform active:translate-x-[2px] active:translate-y-[2px] active:shadow-none`}
      >
        <AppleIcon />
        <span className="text-left leading-tight">
          <span className="block text-[9px] font-semibold uppercase tracking-widest">
            Download on the
          </span>
          <span className="block text-base font-bold">App Store</span>
        </span>
      </a>

      <a
        href={app.playStore}
        target="_blank"
        rel="noopener noreferrer"
        className={`flex items-center gap-3 border-2 border-ink bg-paper ${pad} shadow-brutal-sm transition-transform active:translate-x-[2px] active:translate-y-[2px] active:shadow-none`}
      >
        <PlayIcon />
        <span className="text-left leading-tight">
          <span className="block text-[9px] font-semibold uppercase tracking-widest">
            Get it on
          </span>
          <span className="block text-base font-bold">Google Play</span>
        </span>
      </a>
    </div>
  );
}
