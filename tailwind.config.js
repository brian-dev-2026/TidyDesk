/** @type {import('tailwindcss').Config} */
const v = (name) => `rgb(var(--${name}) / <alpha-value>)`

module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg: v('bg'),
        surface: v('surface'),
        raised: v('raised'),
        line: v('line'),
        fg: v('fg'),
        muted: v('muted'),
        accent: v('accent')
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'Segoe UI', 'sans-serif'] },
      boxShadow: { glow: '0 10px 40px -10px rgb(99 102 241 / 0.55)' },
      keyframes: {
        'fade-in': { from: { opacity: 0, transform: 'translateY(6px)' }, to: { opacity: 1, transform: 'none' } }
      },
      animation: { 'fade-in': 'fade-in .25s ease-out both' }
    }
  },
  plugins: []
}
