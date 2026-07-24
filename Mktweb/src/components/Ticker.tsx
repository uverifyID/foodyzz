import { ticker } from "@/lib/siteConfig";

// Infinite horizontal marquee. The list is rendered twice and translated -50%
// so the loop is seamless.
export default function Ticker() {
  const items = [...ticker, ...ticker];
  return (
    <div className="overflow-hidden border-b-2 border-ink bg-accent-light-orange">
      <div className="flex w-max animate-marquee whitespace-nowrap py-2.5">
        {items.map((label, i) => (
          <span
            key={i}
            className="flex items-center gap-3 px-6 text-sm font-bold uppercase tracking-tight"
          >
            <span aria-hidden>★</span>
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}
