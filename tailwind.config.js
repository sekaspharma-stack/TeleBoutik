/** @type {import('tailwindcss').Config} */
export default {
  // Mode sombre piloté par la classe `dark` posée sur <html> (voir src/lib/theme.ts).
  darkMode: 'class',
  // Les variantes hover: ne s'appliquent que sur les appareils qui survolent réellement (souris/trackpad).
  // Évite le « survol collant » sur tablette/smartphone : au toucher, le retour visuel passe par :active.
  future: { hoverOnlyWhenSupported: true },
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#effafa',
          100: '#d4f1f0',
          200: '#ade3e2',
          300: '#79cecf',
          400: '#3fb3b6',
          500: '#1f999c',
          600: '#0f7d82',
          700: '#0b6568',
          800: '#0c5154',
          900: '#0c4144',
          950: '#062a2c',
        },
        ink: {
          700: '#17383d',
          800: '#10292d',
          900: '#0a1f23',
          950: '#06151a',
        },
        accent: {
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
          800: '#92400e',
          900: '#78350f',
        },
        success: {
          50: '#f0fdf4',
          100: '#dcfce7',
          500: '#22c55e',
          600: '#16a34a',
          700: '#15803d',
        },
        warning: {
          50: '#fff7ed',
          100: '#ffedd5',
          500: '#f97316',
          600: '#ea580c',
        },
        error: {
          50: '#fef2f2',
          100: '#fee2e2',
          500: '#ef4444',
          600: '#dc2626',
          700: '#b91c1c',
        },
      },
      fontFamily: {
        sans: ['Manrope', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        sm: '0 1px 2px 0 rgb(16 42 46 / 0.05), 0 0 0 1px rgb(16 42 46 / 0.02)',
        DEFAULT: '0 1px 3px 0 rgb(16 42 46 / 0.08), 0 1px 2px -1px rgb(16 42 46 / 0.06)',
        md: '0 4px 10px -2px rgb(16 42 46 / 0.08), 0 2px 4px -2px rgb(16 42 46 / 0.05)',
        lg: '0 12px 24px -6px rgb(16 42 46 / 0.12), 0 4px 8px -4px rgb(16 42 46 / 0.06)',
        xl: '0 20px 40px -10px rgb(16 42 46 / 0.16), 0 8px 16px -8px rgb(16 42 46 / 0.08)',
        '2xl': '0 28px 60px -12px rgb(6 21 26 / 0.28)',
        ring: '0 0 0 4px rgb(31 153 156 / 0.18)',
      },
      transitionTimingFunction: {
        smooth: 'cubic-bezier(0.2, 0.7, 0.2, 1)',
      },
    },
  },
  plugins: [],
};
