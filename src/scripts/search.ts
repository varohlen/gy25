/**
 * Gemensam klientsökning för GY25- och GY11-listorna.
 *
 * Markup som skriptet förväntar sig:
 * - #search-input: sökfältet
 * - #search-status: role="status"-region för antal träffar
 * - #no-results: meddelande när inget matchar
 * - [data-search] / [data-searchable]: sökbara element med söktext
 * - [data-search-group="X"]: elementet hör till grupp X
 * - [data-search-heading="X"]: gruppens rubrik, som visas om något element i X syns
 */

// Synonymer läggs till i söktexten när ett av nyckelorden finns i den.
const SYNONYMS: Array<[string, string[]]> = [
  ['matematik', ['matte']],
  ['engelska', ['eng']],
  ['svenska som andraspråk', ['sva', 'sas']],
  ['idrott och hälsa', ['idh', 'gympa']],
];

const PROTECTED: Record<string, string> = { å: '\u0001', ä: '\u0002', ö: '\u0003' };
const RESTORED: Record<string, string> = { '\u0001': 'å', '\u0002': 'ä', '\u0003': 'ö' };

/** Gemener och utan diakritiska tecken (é → e, ü → u), men å, ä och ö behålls. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[åäö]/g, (c) => PROTECTED[c])
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[\u0001-\u0003]/g, (c) => RESTORED[c])
    .normalize('NFC');
}

/** Delar på blanksteg och bindestreck/tankstreck. */
export function tokenize(text: string): string[] {
  return normalize(text)
    .split(/[\s\-‐–—/,.()]+/u)
    .filter(Boolean);
}

const NORMALIZED_SYNONYMS = SYNONYMS.map(
  ([phrase, extra]) => [normalize(phrase), extra.map(normalize)] as const,
);

function buildHaystack(text: string): string[] {
  const normalized = normalize(text);
  const words = tokenize(normalized);
  for (const [phrase, extra] of NORMALIZED_SYNONYMS) {
    if (normalized.includes(phrase)) words.push(...extra);
  }
  return words;
}

/**
 * Varje sökord måste matcha något ord i söktexten. Korta sökord (1–3 tecken,
 * t.ex. "1" i "fysik 1" eller "sva") matchar början av ett ord, så att de inte
 * träffar mitt i orelaterade ord. Längre sökord matchar var som helst i ett
 * ord, så att "kemi" även hittar "biokemi".
 */
export function matches(queryTokens: string[], haystack: string[]): boolean {
  return queryTokens.every((token) =>
    haystack.some((word) => (token.length < 4 ? word.startsWith(token) : word.includes(token))),
  );
}

function pluralHits(count: number): string {
  return `${count} ${count === 1 ? 'träff' : 'träffar'}`;
}

export function initSearch(): void {
  const input = document.getElementById('search-input') as HTMLInputElement | null;
  if (!input) return;

  const status = document.getElementById('search-status');
  const noResults = document.getElementById('no-results');
  const items = Array.from(
    document.querySelectorAll<HTMLElement>('[data-search], [data-searchable]'),
  ).map((element) => ({
    element,
    group: element.dataset.searchGroup,
    haystack: buildHaystack(element.dataset.search ?? element.dataset.searchable ?? ''),
  }));
  const headings = Array.from(document.querySelectorAll<HTMLElement>('[data-search-heading]'));

  if (items.length === 0) return;

  const apply = (rawQuery: string) => {
    const query = rawQuery.trim();
    const tokens = tokenize(query);
    const visibleGroups = new Set<string>();
    let visibleCount = 0;

    for (const item of items) {
      const show = tokens.length === 0 || matches(tokens, item.haystack);
      item.element.style.display = show ? '' : 'none';
      if (show) {
        visibleCount++;
        if (item.group) visibleGroups.add(item.group);
      }
    }

    for (const heading of headings) {
      heading.style.display = visibleGroups.has(heading.dataset.searchHeading ?? '') ? '' : 'none';
    }

    if (noResults) noResults.style.display = tokens.length > 0 && visibleCount === 0 ? 'block' : 'none';
    if (status) status.textContent = tokens.length > 0 ? pluralHits(visibleCount) : '';

    const url = new URL(window.location.href);
    if (query) url.searchParams.set('q', query);
    else url.searchParams.delete('q');
    if (url.href !== window.location.href) history.replaceState(history.state, '', url);
  };

  let debounce: ReturnType<typeof setTimeout> | undefined;
  input.addEventListener('input', () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => apply(input.value), 200);
  });

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      input.value = '';
      apply('');
    }
  });

  const initialQuery = new URLSearchParams(window.location.search).get('q');
  if (initialQuery) {
    input.value = initialQuery;
    apply(initialQuery);
  }
}
