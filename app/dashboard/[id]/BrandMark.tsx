"use client";

import { useState } from "react";

type Props = {
  className?: string;
  imageClassName?: string;
  titleClassName?: string;
  subtitleClassName?: string;
};

const DEFAULT_LOGO_PATH = "/greiner-consulting-logo.png";

export default function BrandMark({
  className = "",
  imageClassName = "h-12 w-auto rounded-md border bg-white p-2",
  titleClassName = "text-lg font-semibold text-slate-950",
  subtitleClassName = "text-xs uppercase tracking-[0.18em] text-slate-500",
}: Props) {
  const [showImage, setShowImage] = useState(true);

  return (
    <div className={`flex items-center gap-3 ${className}`.trim()}>
      {showImage ? (
        <img
          src={DEFAULT_LOGO_PATH}
          alt="Greiner Consulting"
          className={imageClassName}
          onError={() => setShowImage(false)}
        />
      ) : (
        <div className="flex h-12 w-12 items-center justify-center rounded-md border bg-slate-950 text-sm font-semibold text-white">
          GC
        </div>
      )}
      <div>
        <div className={subtitleClassName}>Greiner Consulting</div>
        <div className={titleClassName}>Diagnostic dirigeant — Bilan de Santé</div>
      </div>
    </div>
  );
}
