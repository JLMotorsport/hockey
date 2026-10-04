// Small inline icons for the tab bar. Stroke icons, currentColor.
const base = {
  width: 24,
  height: 24,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export const PitchIcon = () => (
  <svg {...base}>
    <rect x="4" y="2" width="16" height="20" rx="1" />
    <path d="M4 12h16M9 2a3 3 0 0 0 6 0M9 22a3 3 0 0 1 6 0" />
  </svg>
);
export const SwapIcon = () => (
  <svg {...base}>
    <path d="M7 4v14M3 14l4 4 4-4M17 20V6M13 10l4-4 4 4" />
  </svg>
);
export const TrophyIcon = () => (
  <svg {...base}>
    <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4" />
  </svg>
);
export const CalendarIcon = () => (
  <svg {...base}>
    <rect x="3" y="5" width="18" height="16" rx="2" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
);
export const MenuIcon = () => (
  <svg {...base}>
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>
);
export const HomeIcon = () => (
  <svg {...base}>
    <path d="M3 11l9-8 9 8M5 10v10h14V10" />
  </svg>
);

// Chips. Drawn inside a round badge by the chips panel.
export const TripleCaptainIcon = () => (
  <svg {...base}>
    <path d="M5 7h4.5l-2.5 3.5a2.6 2.6 0 1 1-2.6 3.6" />
    <path d="M13 10l6 7M19 10l-6 7" />
  </svg>
);
export const RollingSubsIcon = () => (
  <svg {...base}>
    <path d="M20 12a8 8 0 0 1-13.7 5.7M4 12a8 8 0 0 1 13.7-5.7" />
    <path d="M18 2.5v4h-4M6 21.5v-4h4" />
  </svg>
);
export const WildcardIcon = () => (
  <svg {...base}>
    <rect x="6" y="3" width="12" height="18" rx="2" />
    <path d="M12 8.2l1.2 2.5 2.7.4-2 1.9.5 2.7-2.4-1.3-2.4 1.3.5-2.7-2-1.9 2.7-.4z" />
  </svg>
);
export const TeamBusIcon = () => (
  <svg {...base}>
    <rect x="3" y="5" width="18" height="12" rx="2" />
    <path d="M3 11h18M8 5v6M14 5v6" />
    <circle cx="7.5" cy="18.5" r="1.5" />
    <circle cx="16.5" cy="18.5" r="1.5" />
  </svg>
);
