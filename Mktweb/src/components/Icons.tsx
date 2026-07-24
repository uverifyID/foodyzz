// Minimal monochrome line-icon set (24px, stroke-based) used across the
// marketing sections. Add a new key here and reference it by name from siteConfig.
import type { SVGProps } from "react";

const paths: Record<string, React.ReactNode> = {
  box: (
    <>
      <path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" />
      <path d="M3 8l9 5 9-5M12 13v8" />
    </>
  ),
  shirt: (
    <path d="M16 3 21 7l-3 3-2-1.5V21H8V8.5L6 10 3 7l5-4 2 2a2.5 2.5 0 0 0 4 0l2-2Z" />
  ),
  truck: (
    <>
      <path d="M3 6h11v9H3zM14 9h4l3 3v3h-7z" />
      <circle cx="7" cy="18" r="1.6" />
      <circle cx="17.5" cy="18" r="1.6" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  cash: (
    <>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
    </>
  ),
  star: <path d="m12 3 2.6 5.6 6.1.8-4.5 4.2 1.2 6L12 17.8 6.6 19.6l1.2-6L3.3 9.4l6.1-.8L12 3Z" />,
  building: (
    <>
      <path d="M4 21V5l8-2 8 2v16" />
      <path d="M9 9h0M9 13h0M15 9h0M15 13h0M10 21v-4h4v4" />
    </>
  ),
  cap: (
    <>
      <path d="m12 4 10 5-10 5L2 9l10-5Z" />
      <path d="M6 11v4c0 1.1 2.7 2.5 6 2.5s6-1.4 6-2.5v-4" />
    </>
  ),
  smile: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 14a4.5 4.5 0 0 0 8 0M9 9h0M15 9h0" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3 5 6v5c0 4.2 2.9 7.6 7 9 4.1-1.4 7-4.8 7-9V6l-7-3Z" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  moon: <path d="M21 12.8A8.5 8.5 0 1 1 11.2 3a6.6 6.6 0 0 0 9.8 9.8Z" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
};

export default function Icon({
  name,
  ...props
}: { name: string } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={20}
      height={20}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    >
      {paths[name] ?? null}
    </svg>
  );
}
