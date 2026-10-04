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
