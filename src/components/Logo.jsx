export default function Logo({ size = 46 }) {
  return (
    <svg className="nav__logo-mark" width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <defs>
        <linearGradient id="lg-crimson" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#f43b5e" />
          <stop offset="100%" stopColor="#9e0b2a" />
        </linearGradient>
      </defs>
      <circle cx="32" cy="32" r="30" fill="url(#lg-crimson)" />
      <circle cx="32" cy="32" r="26.5" fill="none" stroke="rgba(255,255,255,.4)" strokeWidth="1.2" />
      <g fill="#ffffff">
        <path d="M32 50V20" stroke="#ffffff" strokeWidth="2.6" strokeLinecap="round" fill="none" />
        <path d="M32 25c-5.4-.9-8.2-4.5-8.2-9.2 4.6 0 8.2 3.7 8.2 9.2z" />
        <path d="M32 25c5.4-.9 8.2-4.5 8.2-9.2-4.6 0-8.2 3.7-8.2 9.2z" />
        <path d="M32 33.5c-5.4-.9-8.2-4.5-8.2-9.2 4.6 0 8.2 3.7 8.2 9.2z" />
        <path d="M32 33.5c5.4-.9 8.2-4.5 8.2-9.2-4.6 0-8.2 3.7-8.2 9.2z" />
        <path d="M32 42c-5.4-.9-8.2-4.5-8.2-9.2 4.6 0 8.2 3.7 8.2 9.2z" />
        <path d="M32 42c5.4-.9 8.2-4.5 8.2-9.2-4.6 0-8.2 3.7-8.2 9.2z" />
        <path d="M32 17.5c0-3.4 1.2-5.6 0-8.5-1.2 2.9 0 5.1 0 8.5z" />
      </g>
    </svg>
  );
}
