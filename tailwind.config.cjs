/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        destructive: 'hsl(0 84% 60%)',
      },
    },
  },
  plugins: [],
};
