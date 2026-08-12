import type { Config } from 'tailwindcss';

/**
 * Tailwind is a thin projection of tokens.css. Every value is `var(--token)`,
 * never a literal — so a utility class and a hand-written rule can never
 * disagree, and dark mode works without a single `dark:` variant.
 */
export default {
  darkMode: ['class', '[data-theme="dark"]'],
  content: ['./app/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: 'var(--brand-50)', 100: 'var(--brand-100)', 200: 'var(--brand-200)',
          300: 'var(--brand-300)', 400: 'var(--brand-400)', 500: 'var(--brand-500)',
          600: 'var(--brand-600)', 700: 'var(--brand-700)', 800: 'var(--brand-800)',
          900: 'var(--brand-900)',
        },
        accent: {
          50: 'var(--accent-50)', 100: 'var(--accent-100)',
          500: 'var(--accent-500)', 600: 'var(--accent-600)', 700: 'var(--accent-700)',
        },
        success: {
          50: 'var(--success-50)', 100: 'var(--success-100)',
          500: 'var(--success-500)', 600: 'var(--success-600)', 700: 'var(--success-700)',
        },
        warning: {
          50: 'var(--warning-50)', 100: 'var(--warning-100)',
          500: 'var(--warning-500)', 600: 'var(--warning-600)', 700: 'var(--warning-700)',
        },
        danger: {
          50: 'var(--danger-50)', 100: 'var(--danger-100)',
          500: 'var(--danger-500)', 600: 'var(--danger-600)', 700: 'var(--danger-700)',
        },
        info: {
          50: 'var(--info-50)', 100: 'var(--info-100)',
          500: 'var(--info-500)', 600: 'var(--info-600)', 700: 'var(--info-700)',
        },
        neutral: {
          0: 'var(--neutral-0)', 25: 'var(--neutral-25)', 50: 'var(--neutral-50)',
          100: 'var(--neutral-100)', 200: 'var(--neutral-200)', 300: 'var(--neutral-300)',
          400: 'var(--neutral-400)', 500: 'var(--neutral-500)', 600: 'var(--neutral-600)',
          700: 'var(--neutral-700)', 800: 'var(--neutral-800)', 900: 'var(--neutral-900)',
          950: 'var(--neutral-950)',
        },
        surface: {
          canvas: 'var(--surface-canvas)', raised: 'var(--surface-raised)',
          sunken: 'var(--surface-sunken)', hover: 'var(--surface-hover)',
          active: 'var(--surface-active)', brand: 'var(--surface-brand)',
        },
        content: {
          primary: 'var(--text-primary)', secondary: 'var(--text-secondary)',
          tertiary: 'var(--text-tertiary)', disabled: 'var(--text-disabled)',
          inverse: 'var(--text-inverse)', brand: 'var(--text-brand)',
        },
        stroke: {
          subtle: 'var(--border-subtle)', DEFAULT: 'var(--border-default)',
          strong: 'var(--border-strong)',
        },
      },
      spacing: {
        1: 'var(--space-1)', 2: 'var(--space-2)', 3: 'var(--space-3)',
        4: 'var(--space-4)', 5: 'var(--space-5)', 6: 'var(--space-6)',
        8: 'var(--space-8)', 10: 'var(--space-10)', 12: 'var(--space-12)',
        16: 'var(--space-16)', 20: 'var(--space-20)',
        card: 'var(--pad-card)', 'page-x': 'var(--pad-page-x)', 'page-y': 'var(--pad-page-y)',
      },
      fontSize: {
        xs: ['var(--text-xs)', { lineHeight: 'var(--leading-normal)' }],
        sm: ['var(--text-sm)', { lineHeight: 'var(--leading-normal)' }],
        md: ['var(--text-md)', { lineHeight: 'var(--leading-normal)' }],
        lg: ['var(--text-lg)', { lineHeight: 'var(--leading-tight)' }],
        xl: ['var(--text-xl)', { lineHeight: 'var(--leading-tight)' }],
        '2xl': ['var(--text-2xl)', { lineHeight: 'var(--leading-tight)' }],
        '3xl': ['var(--text-3xl)', { lineHeight: 'var(--leading-tight)' }],
      },
      fontFamily: {
        sans: 'var(--font-sans)', bengali: 'var(--font-bengali)',
        arabic: 'var(--font-arabic)', mono: 'var(--font-mono)',
      },
      borderRadius: {
        sm: 'var(--radius-sm)', md: 'var(--radius-md)', lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)', full: 'var(--radius-full)',
      },
      boxShadow: {
        xs: 'var(--shadow-xs)', sm: 'var(--shadow-sm)',
        md: 'var(--shadow-md)', lg: 'var(--shadow-lg)', focus: 'var(--shadow-focus)',
      },
      transitionDuration: { fast: 'var(--duration-fast)', normal: 'var(--duration-normal)' },
      transitionTimingFunction: { out: 'var(--ease-out)' },
      width: { sidebar: 'var(--sidebar-width)' },
      height: { topbar: 'var(--topbar-height)' },
      maxWidth: { content: 'var(--content-max)' },
    },
  },
  plugins: [],
} satisfies Config;
