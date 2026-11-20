import { defineMiddleware } from 'astro:middleware';

/**
 * Säkerhetsheaders för sidor som renderas av _worker.js (/compare/*).
 * Cloudflare Pages applicerar inte public/_headers på svar från workern,
 * så samma värden sätts här. Håll listan i synk med public/_headers.
 */
const SECURITY_HEADERS: Record<string, string> = {
  'Strict-Transport-Security': 'max-age=31536000',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "frame-ancestors 'none'",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

export const onRequest = defineMiddleware(async (context, next) => {
  const response = await next();
  if (context.isPrerendered) {
    return response;
  }
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(name, value);
  }
  return response;
});
