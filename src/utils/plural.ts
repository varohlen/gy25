const FORMS = {
  kurs: ['kurs', 'kurser'],
  nivå: ['nivå', 'nivåer'],
  ämne: ['ämne', 'ämnen'],
} as const;

export type PluralWord = keyof typeof FORMS;

/** Böjer ett ord efter antal, t.ex. "1 kurs", "2 kurser". */
export function pluralize(count: number, word: PluralWord): string {
  const [singular, plural] = FORMS[word];
  return `${count} ${count === 1 ? singular : plural}`;
}
