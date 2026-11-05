export function LumoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="lumo-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F7B733" />
          <stop offset="1" stopColor="#DE7A17" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="16" fill="url(#lumo-g)" />
      <circle cx="32" cy="32" r="9.5" fill="#FFF8E7" />
      <g stroke="#FFF8E7" strokeWidth="4.2" strokeLinecap="round">
        <line x1="32" y1="11.5" x2="32" y2="16.5" />
        <line x1="32" y1="47.5" x2="32" y2="52.5" />
        <line x1="11.5" y1="32" x2="16.5" y2="32" />
        <line x1="47.5" y1="32" x2="52.5" y2="32" />
        <line x1="18.2" y1="18.2" x2="21.6" y2="21.6" />
        <line x1="42.4" y1="42.4" x2="45.8" y2="45.8" />
        <line x1="18.2" y1="45.8" x2="21.6" y2="42.4" />
        <line x1="42.4" y1="21.6" x2="45.8" y2="18.2" />
      </g>
    </svg>
  )
}

export function LumoWordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <LumoMark className={compact ? 'h-7 w-7' : 'h-9 w-9'} />
      <span className={`font-display font-semibold text-foreground ${compact ? 'text-lg' : 'text-xl'}`}>
        Lumo
      </span>
    </span>
  )
}
