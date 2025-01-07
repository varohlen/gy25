// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  output: 'static',  // This is the default, allows per-page server rendering
  adapter: cloudflare({
    mode: 'directory'
  }),
  integrations: [tailwind()],
});
