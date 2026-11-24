// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://gy25.se',
  output: 'static',
  // Alla sidor ligger under /sökväg/. Länkar utan snedstreck ger en 308 från Cloudflare (VIK-171).
  trailingSlash: 'always',
  adapter: cloudflare(),
  integrations: [tailwind(), sitemap()],
});
