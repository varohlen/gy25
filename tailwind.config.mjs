import typography from '@tailwindcss/typography';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      fontFamily: {
        logo: ['Inter', 'sans-serif'],
        heading: ['Lexend', 'sans-serif'],
        body: ['Inter', 'sans-serif'],
      },
      typography: {
        DEFAULT: {
          css: {
            // Läroplanstexter: cirka 68 tecken per rad för brödtext.
            maxWidth: '68ch',
            // "Betyget E/C/A" (GY25 och GY11) och rubriker i GY11:s centrala innehåll.
            h4: {
              fontSize: '1.125em',
              marginTop: '1.75em',
              marginBottom: '0.5em',
            },
            // Mellanrubriker i GY25:s syfte.
            h5: {
              color: 'var(--tw-prose-headings)',
              fontWeight: '600',
              marginTop: '1.5em',
              marginBottom: '0.5em',
            },
            'h4:first-child, h5:first-child': { marginTop: '0' },
            'h5 + *': { marginTop: '0' },
          },
        },
      },
    },
  },
  plugins: [
    typography,
    function({ addBase }) {
      addBase({
        'h1, h2, h3, h4, h5, h6': { fontFamily: "'Lexend', sans-serif" },
      })
    },
  ],
}
