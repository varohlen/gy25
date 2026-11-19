export const SITE_NAME = 'GY25.se';
export const META_DESCRIPTION_LENGTH = 155;

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&ndash;': '–',
  '&mdash;': '—',
};

/**
 * Gör om html till löptext. Varje block (stycke, listpunkt, rubrik) avslutas
 * med punkt om det saknar skiljetecken, så att rubriker och punkter inte flyter ihop.
 */
export function htmlToText(html?: string | null): string {
  if (!html) return '';
  return html
    .split(/<\/(?:p|li|h[1-6]|div)>|<br\s*\/?>/i)
    .map((block) =>
      block
        // Inline-taggar kan sitta mitt i ord ("i<em>nnehåll</em>"), så de tas bort utan mellanslag.
        .replace(/<\/?(?:i|em|b|strong|span|a|u|sup|sub)(?:\s[^>]*)?>/gi, '')
        .replace(/<[^>]*>/g, ' ')
        .replace(/&[a-z#0-9]+;/gi, (entity) => ENTITIES[entity] ?? ' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
    .map((block) => (/[.!?:;]$/.test(block) ? block : `${block}.`))
    .join(' ');
}

/** Klipper texten vid ordgräns så att den blir högst `max` tecken, inklusive "…". */
export function truncateAtWord(text: string, max = META_DESCRIPTION_LENGTH): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  const base = lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut;
  return `${base.replace(/[\s,.;:–-]+$/u, '')}…`;
}

/** Bygger en metabeskrivning av en inledning och html-text. */
export function buildDescription(lead: string, html?: string | null): string {
  return truncateAtWord([lead, htmlToText(html)].filter(Boolean).join(' '));
}

const CENTRAL_CONTENT_INTRO = /Undervisningen\b[^.:]*?ska behandla följande(?: [^\s:.]+){0,2}:?\s*/giu;

/**
 * Beskrivning för en nivå- eller kurssida: inledning plus centralt innehåll,
 * utan Skolverkets inledande mening "Undervisningen … ska behandla följande
 * centrala innehåll:" (som ibland upprepas eller är allt som finns).
 */
export function buildCourseDescription(lead: string, centralContentHtml?: string | null): string {
  const content = htmlToText(centralContentHtml).replace(CENTRAL_CONTENT_INTRO, '').trim();
  return truncateAtWord(content ? `${lead}. Centralt innehåll: ${content}` : `${lead}.`);
}

/** "Fysik" + "Nivå 1a1" → "Fysik nivå 1a1". GY11-kursnamn innehåller redan ämnet. */
export function levelTitle(subjectName: string, courseName: string): string {
  return /^nivå(?:\s|$)/i.test(courseName)
    ? `${subjectName} ${courseName.charAt(0).toLowerCase()}${courseName.slice(1)}`
    : courseName;
}
