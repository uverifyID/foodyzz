"use client";

import { QRCodeSVG } from "qrcode.react";

// Scannable QR rendered from a URL. Defaults to a smart link that sends the
// visitor to the right store; pass `value` to override.
export default function QrCode({
  value,
  size = 116,
  label,
}: {
  value: string;
  size?: number;
  label?: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="border-2 border-ink bg-paper p-2 shadow-brutal-sm">
        <QRCodeSVG value={value} size={size} level="M" />
      </div>
      {label && (
        <span className="text-[10px] font-bold uppercase tracking-widest text-ink/60">
          {label}
        </span>
      )}
    </div>
  );
}
