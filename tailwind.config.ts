import type { Config } from 'tailwindcss';

// Felixstowe HC: white kit with red. Palette lives in CSS variables
// (src/index.css) so it flips for dark mode.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Archivo', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['Archivo', 'system-ui', 'sans-serif'],
      },
      colors: {
        ink: {
          DEFAULT: 'rgb(var(--ink) / <alpha-value>)',
          soft: 'rgb(var(--ink-soft) / <alpha-value>)',
        },
        paper: 'rgb(var(--paper) / <alpha-value>)',
        surface: 'rgb(var(--surface) / <alpha-value>)',
        line: 'rgb(var(--line) / <alpha-value>)',
        brand: {
          DEFAULT: 'rgb(var(--brand) / <alpha-value>)',
          dark: 'rgb(var(--brand-dark) / <alpha-value>)',
          ink: 'rgb(var(--brand-ink) / <alpha-value>)',
        },
        navy: 'rgb(var(--navy) / <alpha-value>)',
        // Kept for older class names; the club palette has no gold.
        accent: 'rgb(var(--brand) / <alpha-value>)',
        turf: { DEFAULT: '#1f7a4a', dark: '#17643c', line: '#ffffff' },
      },
      minHeight: { tap: '44px' },
      minWidth: { tap: '44px' },
      boxShadow: {
        card: '0 1px 2px rgb(0 0 0 / 0.06), 0 4px 16px rgb(0 0 0 / 0.06)',
      },
    },
  },
  plugins: [],
} satisfies Config;
