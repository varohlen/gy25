// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  output: 'static',
  adapter: cloudflare({
    mode: 'directory',
    headers: {
      '/*': [
        {
          key: 'Alt-Svc',
          value: ''  // Empty value to prevent HTTP/3 upgrade
        },
        {
          key: 'Strict-Transport-Security',
          value: 'max-age=31536000; includeSubDomains; preload'
        }
      ]
    }
  }),
  integrations: [tailwind()],
});
