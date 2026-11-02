interface LogoMarkProps {
  className?: string;
}

export function LogoMark({ className = "size-8" }: LogoMarkProps) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" className="fill-brand-600" />
      <path d="M10 17.5 3.5 12.5 6 20.5Z" fill="#fff" />
      <circle cx="15" cy="18.5" r="7" fill="#fff" />
      <circle cx="20.5" cy="13" r="4.5" fill="#fff" />
      <path d="M24.6 11.4 28.5 13.4 24.6 14.6Z" fill="#fff" />
      <path d="M9.5 17.5 19.5 15.5 13.5 22.5Z" className="fill-brand-500" />
      <circle cx="21.6" cy="12.2" r="1.1" className="fill-brand-900" />
    </svg>
  );
}

interface LogoProps {
  className?: string;
}

export function Logo({ className }: LogoProps) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className ?? ""}`}>
      <LogoMark />
      <span className="text-lg font-semibold tracking-tight">Sendy Birdy</span>
    </span>
  );
}
