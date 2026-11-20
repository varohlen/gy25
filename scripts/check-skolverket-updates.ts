/**
 * Läser Skolverkets ämneslistor och jämför dem med lokala ämnesfiler utan att
 * skriva något. Används av den schemalagda påminnelsen för att avgöra om
 * `pnpm fetch-data` behöver köras.
 *
 * Exitkoder:
 *   0  inga ändringar
 *   2  ändringar finns hos Skolverket (kör `pnpm fetch-data`)
 *   1  kontrollen misslyckades (nätverk, oväntat svar, lokalt läsfel)
 *
 * Flaggor:
 *   --json   skriv resultatet som JSON i stället för text
 */
import * as fs from 'fs/promises';
import * as path from 'path';

type VersionKey = 'gy11' | 'gy25';

interface SubjectSummary {
  code: string;
  name?: string;
  modifiedDate?: string;
}

interface SubjectsListResponse {
  apiVersion?: string;
  apiReleased?: string;
  subjects?: SubjectSummary[];
  totalElements?: number;
}

interface VersionCheck {
  version: VersionKey;
  liveCount: number;
  localCount: number;
  added: Array<{ code: string; name?: string }>;
  changed: Array<{ code: string; name?: string; localModifiedDate: string; liveModifiedDate: string }>;
  removed: Array<{ code: string }>;
}

const ROOT_DIR = process.cwd();
const CONTENT_DIR = path.join(ROOT_DIR, 'src', 'content');
const API_BASE = 'https://api.skolverket.se/syllabus/v1';
const GY25_DATE_OVERRIDE = process.env.SKOLVERKET_GY25_DATE?.trim();
const TIMEOUT_MS = 25_000;
const MAX_ATTEMPTS = 3;

const LIST_URLS: Record<VersionKey, string> = {
  gy11: `${API_BASE}/subjects?schooltype=GY&timespan=LATEST&typeOfSyllabus=SUBJECT_SYLLABUS`,
  gy25: GY25_DATE_OVERRIDE
    ? `${API_BASE}/subjects?schooltype=GY&date=${encodeURIComponent(GY25_DATE_OVERRIDE)}&typeOfSyllabus=GRADE_SUBJECT_SYLLABUS`
    : `${API_BASE}/subjects?schooltype=GY&timespan=LATEST&typeOfSyllabus=GRADE_SUBJECT_SYLLABUS`,
};

async function fetchList(url: string): Promise<SubjectsListResponse> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} från ${url}`);
      }
      const contentType = response.headers.get('content-type') ?? '';
      if (!contentType.includes('json')) {
        throw new Error(`Oväntad content-type "${contentType}" från ${url}`);
      }
      return (await response.json()) as SubjectsListResponse;
    } catch (error) {
      lastError = error;
      if (attempt < MAX_ATTEMPTS) {
        await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
      }
    }
  }
  throw lastError;
}

async function loadLocalModifiedDates(version: VersionKey): Promise<Map<string, string>> {
  const dir = path.join(CONTENT_DIR, `${version}-subjects`);
  const result = new Map<string, string>();
  const files = await fs.readdir(dir);
  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const parsed = JSON.parse(await fs.readFile(path.join(dir, file), 'utf8')) as {
      code?: string;
      modifiedDate?: string;
    };
    if (parsed.code) {
      result.set(parsed.code, parsed.modifiedDate ?? '');
    }
  }
  return result;
}

async function checkVersion(version: VersionKey): Promise<VersionCheck> {
  const list = await fetchList(LIST_URLS[version]);
  if (!Array.isArray(list.subjects) || list.subjects.length === 0) {
    // En tom lista betyder nästan alltid ett API-problem, inte att alla ämnen
    // har tagits bort. Rapportera som fel så att ingen synk körs på den.
    throw new Error(`${version.toUpperCase()}: API:t returnerade ingen ämneslista.`);
  }

  const local = await loadLocalModifiedDates(version);
  const liveCodes = new Set(list.subjects.map(subject => subject.code));

  const added: VersionCheck['added'] = [];
  const changed: VersionCheck['changed'] = [];
  for (const subject of list.subjects) {
    const localModified = local.get(subject.code);
    if (localModified === undefined) {
      added.push({ code: subject.code, name: subject.name });
    } else if ((subject.modifiedDate ?? '') !== localModified) {
      changed.push({
        code: subject.code,
        name: subject.name,
        localModifiedDate: localModified,
        liveModifiedDate: subject.modifiedDate ?? '',
      });
    }
  }

  const removed = [...local.keys()]
    .filter(code => !liveCodes.has(code))
    .sort()
    .map(code => ({ code }));

  const byCode = (a: { code: string }, b: { code: string }) => a.code.localeCompare(b.code);
  return {
    version,
    liveCount: list.subjects.length,
    localCount: local.size,
    added: added.sort(byCode),
    changed: changed.sort(byCode),
    removed,
  };
}

function formatText(results: VersionCheck[], hasUpdates: boolean): string {
  const lines: string[] = [];
  for (const result of results) {
    const label = result.version.toUpperCase();
    const total = result.added.length + result.changed.length + result.removed.length;
    lines.push(`${label}: ${total === 0 ? 'inga ändringar' : `${total} ändring(ar)`} (${result.liveCount} ämnen hos Skolverket, ${result.localCount} lokalt)`);
    for (const item of result.added) {
      lines.push(`  + ${item.code}${item.name ? ` ${item.name}` : ''} (nytt)`);
    }
    for (const item of result.changed) {
      lines.push(`  ~ ${item.code}${item.name ? ` ${item.name}` : ''} (modifiedDate ${item.localModifiedDate || '–'} → ${item.liveModifiedDate || '–'})`);
    }
    for (const item of result.removed) {
      lines.push(`  - ${item.code} (finns inte längre i API-listan)`);
    }
  }
  lines.push('');
  lines.push(hasUpdates
    ? 'Uppdatering finns. Kör `pnpm fetch-data` och `pnpm analyze-changes` och granska ändringarna.'
    : 'Datan är aktuell.');
  return lines.join('\n');
}

async function main() {
  const asJson = process.argv.includes('--json');
  try {
    const results = [await checkVersion('gy11'), await checkVersion('gy25')];
    const hasUpdates = results.some(r => r.added.length + r.changed.length + r.removed.length > 0);

    if (asJson) {
      console.log(JSON.stringify({ checkedAt: new Date().toISOString(), hasUpdates, versions: results }, null, 2));
    } else {
      console.log(formatText(results, hasUpdates));
    }
    process.exit(hasUpdates ? 2 : 0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (asJson) {
      console.log(JSON.stringify({ checkedAt: new Date().toISOString(), error: message }, null, 2));
    } else {
      console.error(`Kontrollen misslyckades: ${message}`);
    }
    process.exit(1);
  }
}

main();
