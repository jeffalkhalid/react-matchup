/** @type {import('tailwindcss').Config} */
const { Colors } = require('./lib/colors');

module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './components/**/*.{js,jsx,ts,tsx}', './hooks/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // Brand jaune (parcimonie : accents, liens, pills)
        brand: {
          DEFAULT: Colors.brand,
          bright: Colors.brandBright,
          deep: Colors.brandDeep,
        },
        // CTA = noir
        primary: {
          DEFAULT: Colors.primary,
          dark: Colors.primaryDark,
          light: Colors.primaryLight,
        },
        accent: {
          DEFAULT: Colors.accent,
          dark: Colors.accentDark,
          light: Colors.accentLight,
        },
        ink: {
          DEFAULT: Colors.bgDark,
          alt: Colors.bgDarkAlt,
          from: Colors.bgDarkFrom,
          to: Colors.bgDarkTo,
        },
        surface: {
          DEFAULT: Colors.bg,
          card: Colors.bgCard,
          alt: Colors.bgCardAlt,
          cream: Colors.bgCream,
        },
        league: Colors.league,
      },
      fontFamily: {
        sans: ['Manrope_600SemiBold', 'System'],
        display: ['Anton_400Regular', 'System'],
        ui: ['Manrope_600SemiBold', 'System'],
        'ui-bold': ['Manrope_700Bold', 'System'],
      },
    },
  },
  plugins: [],
};
