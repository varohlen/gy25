/**
 * Delar upp betygskriterier per betygssteg (E, C, A) för tabellvyn.
 * Används av betygskomponenten och av jämförelsesidan.
 */
export type GradeStep = 'E' | 'C' | 'A';
export type GradeMap = Record<GradeStep, { paragraphs: string[] }>;

export const GRADE_STEPS: GradeStep[] = ['E', 'C', 'A'];

/** Styckena i en kriterietext, utan p-taggar. Beskrivningarna av D och B hoppas över. */
export function extractParagraphs(html: string): string[] {
  const matches = html.match(/<p>(.*?)<\/p>/g) ?? [];
  return matches
    .filter((p) => !p.includes('bedöms sammantaget vara mellan'))
    .map((p) => p.replace(/<p[^>]*>|<\/p>/g, ''));
}

/** Kriterierna per betygssteg och det största antalet stycken i något steg. */
export function buildGradeMap(requirements: { text: string; gradeStep?: string }[] = []) {
  const gradeMap: GradeMap = { E: { paragraphs: [] }, C: { paragraphs: [] }, A: { paragraphs: [] } };
  for (const req of requirements) {
    const step = req.gradeStep as GradeStep;
    if (step in gradeMap) gradeMap[step].paragraphs = extractParagraphs(req.text);
  }
  const maxCriteria = Math.max(...GRADE_STEPS.map((step) => gradeMap[step].paragraphs.length));
  return { gradeMap, maxCriteria };
}
