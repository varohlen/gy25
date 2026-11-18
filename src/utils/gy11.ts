import { getCollection } from 'astro:content';
import { toSvDate } from './changelog';

/**
 * Latest endDate among GY11 subjects (the end of the transition period), read at build time.
 * Returns ISO date (YYYY-MM-DD) and Swedish text, e.g. "30 juni 2030", or null if missing.
 */
export async function getGy11EndDate(): Promise<{ iso: string; text: string } | null> {
  const subjects = await getCollection('gy11-subjects');
  const latest = subjects
    .map(s => s.data.endDate?.slice(0, 10))
    .filter((d): d is string => !!d)
    .sort()
    .at(-1);
  if (!latest) return null;
  // Noon UTC so the date does not shift with the build machine's time zone
  return { iso: latest, text: toSvDate(`${latest}T12:00:00Z`) };
}
