// Validity dates for syllabuses (startDate, endDate, canceledDate from Skolverket's API).
// Badges are computed relative to the build date, so they update on the next build.

export interface ValidityDates {
  startDate?: string;
  endDate?: string;
  canceledDate?: string;
}

export interface ValidityBadge {
  label: string;
  tone: 'ending' | 'upcoming' | 'neutral';
}

const BUILD_DAY = new Date().toISOString().slice(0, 10);

const day = (iso?: string) => (iso ? iso.slice(0, 10) : undefined);

/** "2028-06-30" -> "30 juni 2028" */
export function formatSvDay(iso?: string): string {
  const d = day(iso);
  if (!d) return '';
  const parsed = new Date(`${d}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return d;
  return new Intl.DateTimeFormat('sv-SE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}

/** "Gäller från 1 juli 2025 till 30 juni 2028" */
export function validityText({ startDate, endDate, canceledDate }: ValidityDates): string {
  const parts: string[] = [];
  if (startDate) parts.push(`från ${formatSvDay(startDate)}`);
  if (endDate) parts.push(`till ${formatSvDay(endDate)}`);
  let text = parts.length ? `Gäller ${parts.join(' ')}` : '';
  if (canceledDate) text += `${text ? '. ' : ''}Upphävd ${formatSvDay(canceledDate)}`;
  return text;
}

/**
 * Short badge for lists: ending or upcoming relative to the build date.
 * With `always`, a start date badge is shown even if it has passed (to tell same-named subjects apart).
 */
export function validityBadge(
  { startDate, endDate }: ValidityDates,
  { always = false, today = BUILD_DAY }: { always?: boolean; today?: string } = {}
): ValidityBadge | null {
  const start = day(startDate);
  const end = day(endDate);
  if (end && end >= today) return { label: `Upphör ${formatSvDay(end)}`, tone: 'ending' };
  if (start && start > today) return { label: `Gäller från ${formatSvDay(start)}`, tone: 'upcoming' };
  if (always && start) return { label: `Gäller från ${formatSvDay(start)}`, tone: 'neutral' };
  return null;
}

export const badgeClasses: Record<ValidityBadge['tone'], string> = {
  ending: 'bg-amber-100 text-amber-900',
  upcoming: 'bg-sky-100 text-sky-900',
  neutral: 'bg-white/75 text-gray-700',
};
