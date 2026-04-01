import Link from "next/link";

type Props = {
  compact?: boolean;
  href?: string | null;
  className?: string;
};

export default function PortalBrand({
  compact = false,
  href = "/",
  className = "",
}: Props) {
  const content = (
    <div className={`flex items-center gap-3 ${className}`.trim()}>
      <img
        src="/greiner-consulting-logo.png"
        alt="Greiner Consulting"
        className={
          compact
            ? "h-11 w-auto rounded-md border bg-white p-2"
            : "h-14 w-auto rounded-md border bg-white p-2 shadow-sm"
        }
      />
      <div>
        <div className="text-[11px] uppercase tracking-[0.22em] text-slate-500">
          Greiner Consulting
        </div>
        <div
          className={
            compact
              ? "text-base font-semibold text-slate-950"
              : "text-xl font-semibold text-slate-950"
          }
        >
          Diagnostic dirigeant — Bilan de Santé
        </div>
      </div>
    </div>
  );

  if (!href) return content;

  return (
    <Link href={href} className="inline-flex">
      {content}
    </Link>
  );
}
