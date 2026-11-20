/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      fontFamily: {
        logo: ['Inter Variable', 'sans-serif'],
        heading: ['Lexend Variable', 'sans-serif'],
        body: ['Inter Variable', 'sans-serif'],
      },
    },
  },
  plugins: [
    function({ addBase }) {
      addBase({
        'h1, h2, h3, h4, h5, h6': { fontFamily: "'Lexend Variable', sans-serif" },
      })
    },
  ],
}
