/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}', './hooks/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        navy: {
          950: '#05091A',
          900: '#0A0F1E',
          800: '#111827',
          700: '#1F2937',
          600: '#374151',
        },
        primary: {
          DEFAULT: '#10B981',
          dark: '#059669',
          light: '#34D399',
        },
        league: {
          diamond: '#67E8F9',
          gold: '#FBBF24',
          silver: '#9CA3AF',
          bronze: '#F97316',
          discovery: '#34D399',
        },
      },
      fontFamily: {
        sans: ['System'],
      },
    },
  },
  plugins: [],
};
