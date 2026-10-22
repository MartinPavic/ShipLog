export function ShipWheel({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true" className={className}>
      <circle cx="16" cy="16" r="8" />
      <circle cx="16" cy="16" r="2.5" fill="currentColor" stroke="none" />
      <path d="M16 3v10.5M16 18.5V29M3 16h10.5M18.5 16H29M6.8 6.8l7.4 7.4M17.8 17.8l7.4 7.4M25.2 6.8l-7.4 7.4M14.2 17.8l-7.4 7.4" />
    </svg>
  );
}
