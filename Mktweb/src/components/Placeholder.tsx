import Icon from "@/components/Icons";

// Stand-in for a marketing photo. Swap for a real <Image> once you have assets
// (see PHASE2-NOTES.md). Renders a tinted tile so the layout reads as intended.
export default function Placeholder({
  label,
  icon = "smile",
  className = "",
  tint = "bg-accent-blue",
}: {
  label: string;
  icon?: string;
  className?: string;
  tint?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 border-2 border-ink ${tint} text-ink/60 ${className}`}
    >
      <Icon name={icon} width={28} height={28} />
      <span className="text-[10px] font-bold uppercase tracking-widest">
        {label}
      </span>
    </div>
  );
}
