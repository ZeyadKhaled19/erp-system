import { useId } from 'react';

/**
 * شعار Eco System: ورقة شجر جوه مدار (دورة متكاملة)، بألوان الأزرق والأخضر والبنفسجي.
 * نفس الرسمة في public/eco-logo.svg (لشاشات البداية).
 */
export function EcoMark({ size = 56, className }: { size?: number; className?: string }) {
  const id = useId().replace(/:/g, '');
  const leaf = `eco-leaf-${id}`;
  const ring = `eco-ring-${id}`;
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 64 64" role="img" aria-label="Eco System">
      <defs>
        <linearGradient id={leaf} x1="14" y1="48" x2="50" y2="14" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#3B82F6" />
          <stop offset="0.55" stopColor="#22C55E" />
          <stop offset="1" stopColor="#A3E635" />
        </linearGradient>
        <linearGradient id={ring} x1="6" y1="10" x2="58" y2="54" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#A78BFA" />
          <stop offset="1" stopColor="#3B82F6" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="26.5" fill="none" stroke={`url(#${ring})`} strokeWidth="4" strokeLinecap="round" strokeDasharray="128 39" transform="rotate(-62 32 32)" />
      <path d="M18.5 45.5C17.5 29 29 17.5 46.5 17.5C47.5 34 36 45.5 18.5 45.5Z" fill={`url(#${leaf})`} />
      <path d="M21 43C27 35.5 33.5 29 41 22.5" fill="none" stroke="#fff" strokeOpacity=".55" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="51" cy="14.5" r="3.6" fill="#A78BFA" />
    </svg>
  );
}

/** الشعار + الاسم */
export function EcoLogo({ size = 44, className, light = false }: { size?: number; className?: string; light?: boolean }) {
  return (
    <span className={`eco-logo-full ${light ? 'light' : ''} ${className ?? ''}`} dir="ltr">
      <EcoMark size={size} />
      <span className="eco-word">
        <b>Eco</b> System
      </span>
    </span>
  );
}
