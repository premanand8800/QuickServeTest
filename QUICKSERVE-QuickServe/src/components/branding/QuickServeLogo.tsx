import Link from "next/link";

type QuickServeLogoProps = {
  subtitle?: string;
  href?: string | null;
  compact?: boolean;
  className?: string;
};

export default function QuickServeLogo({
  subtitle,
  href,
  compact = false,
  className = "",
}: QuickServeLogoProps) {
  const content = (
    <div className={`flex items-center gap-3 ${className}`}>
      <div className="w-11 h-11 rounded-2xl bg-primary shadow-xl shadow-orange-900/40 border-b-2 border-orange-800 flex items-center justify-center">
        <svg
          viewBox="0 0 24 24"
          className="w-6 h-6 text-white"
          fill="currentColor"
          aria-hidden
        >
          <path d="M13.4 2.2c.2 2-.6 3.6-2.4 5.1-1.8 1.5-2.6 2.8-2.6 4.4 0 2 1.5 3.2 3.4 3.2 2.4 0 4.2-1.8 4.2-4.9 0-1.3-.4-2.7-1.2-4 2.3 1.4 3.8 4 3.8 6.8 0 4.3-2.8 8-7.1 8-3.7 0-6.3-2.7-6.3-6.4 0-3 1.6-5.2 4.1-7.1C10.3 5.8 11.7 4.4 13.4 2.2z" />
        </svg>
      </div>
      <div className="leading-none">
        <p
          className={`font-black uppercase tracking-tight ${compact ? "text-lg" : "text-2xl"}`}
        >
          QuickServe
        </p>
        {subtitle ? (
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-text-muted mt-1">
            {subtitle}
          </p>
        ) : null}
      </div>
    </div>
  );

  return typeof href === "string" && href.length > 0 ? (
    <Link href={href} className="inline-flex items-center">
      {content}
    </Link>
  ) : (
    content
  );
}
