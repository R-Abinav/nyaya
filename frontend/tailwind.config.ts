import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: 'rgb(var(--color-ink) / <alpha-value>)',
        canvas: 'rgb(var(--color-canvas) / <alpha-value>)',
        panel: 'rgb(var(--color-panel) / <alpha-value>)',
        line: 'rgb(var(--color-line) / <alpha-value>)',
        primary: 'rgb(var(--color-primary) / <alpha-value>)',
        'primary-foreground': 'rgb(var(--color-primary-foreground) / <alpha-value>)',
        muted: 'rgb(var(--color-muted) / <alpha-value>)',
        'muted-foreground': 'rgb(var(--color-muted-foreground) / <alpha-value>)',
        highlight: '#fdca40',
        success: '#4f9d69',
        danger: '#b84a62',
        vintage: '#6b4e71',
      },
      boxShadow: { soft: '0 18px 45px rgb(30 45 36 / 0.08)' },
      borderRadius: { xl: '1rem', '2xl': '1.35rem' },
    },
  },
  plugins: [],
} satisfies Config;
