import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Space Grotesk', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      colors: {
        // ─── Design system tokens (brief §7) ─────────────────────────────────
        canvas:   'rgb(var(--color-canvas) / <alpha-value>)',
        ink:      'rgb(var(--color-ink) / <alpha-value>)',
        'muted-fg': 'rgb(var(--color-muted-fg) / <alpha-value>)',
        line:     'rgb(var(--color-line) / <alpha-value>)',
        panel:    'rgb(var(--color-panel) / <alpha-value>)',
        muted:    'rgb(var(--color-muted) / <alpha-value>)',
        accent:   'rgb(var(--color-accent) / <alpha-value>)',
        correct:  'rgb(var(--color-correct) / <alpha-value>)',
        incorrect:'rgb(var(--color-incorrect) / <alpha-value>)',
        // ─── Legacy compat ───────────────────────────────────────────────────
        primary:  'rgb(var(--color-primary) / <alpha-value>)',
        'primary-foreground': 'rgb(var(--color-primary-foreground) / <alpha-value>)',
        success:  'rgb(var(--color-success) / <alpha-value>)',
        danger:   'rgb(var(--color-danger) / <alpha-value>)',
        highlight: '#fdca40',
        vintage:  'rgb(var(--color-vintage) / <alpha-value>)',
      },
      boxShadow: {
        soft: '0 1px 3px rgb(0 0 0 / 0.06), 0 4px 16px rgb(0 0 0 / 0.04)',
      },
      borderRadius: {
        DEFAULT: '0.5rem',
        md: '0.5rem',
        lg: '0.625rem',
        xl: '0.75rem',
        '2xl': '1rem',
      },
    },
  },
  plugins: [],
} satisfies Config;
