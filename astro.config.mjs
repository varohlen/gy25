// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import cloudflare from '@astrojs/cloudflare';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://gy25.se',
  output: 'static',
  adapter: cloudflare(),
  integrations: [tailwind(), sitemap()],
});
