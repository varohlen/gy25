import axios from 'axios';
import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { FetchHistoryEntry, VersionKey } from '../src/utils/changelog';

const ROOT_DIR = process.cwd();
const CONTENT_DIR = path.join(ROOT_DIR, 'src', 'content');
const METADATA_DIR = path.join(CONTENT_DIR, 'metadata');
const REPORTS_DIR = path.join(ROOT_DIR, 'scripts', 'state');
const FETCH_STATE_PATH = path.join(REPORTS_DIR, 'fetch-state.json');
const FETCH_REPORT_PATH = path.join(REPORTS_DIR, 'fetch-report-latest.json');
const CHANGELOG_HISTORY_PATH = path.join(REPORTS_DIR, 'content-changelog-history.json');
const API_METADATA_PATH = path.join(METADATA_DIR, 'api-metadata.json');

const GY25_DATE_OVERRIDE = process.env.SKOLVERKET_GY25_DATE?.trim();
const REQUEST_DELAY_MS = 60;
const FETCH_MAX_ATTEMPTS = 4;
const FETCH_BASE_DELAY_MS = 500;

const API_BASE = 'https://api.skolverket.se/syllabus/v1';

const ENDPOINTS: Record<VersionKey, { subjectsList: string; subject: (code: string) => string }> = {
  gy11: {
    subjectsList: `${API_BASE}/subjects?schooltype=GY&timespan=LATEST&typeOfSyllabus=SUBJECT_SYLLABUS`,
    subject: (code: string) => `${API_BASE}/subjects/${code}`,
  },
  gy25: {
    subjectsList: GY25_DATE_OVERRIDE
      ? `${API_BASE}/subjects?schooltype=GY&date=${encodeURIComponent(GY25_DATE_OVERRIDE)}&typeOfSyllabus=GRADE_SUBJECT_SYLLABUS`
      : `${API_BASE}/subjects?schooltype=GY&timespan=LATEST&typeOfSyllabus=GRADE_SUBJECT_SYLLABUS`,
    subject: (code: string) => {
      const base = `${API_BASE}/subjects/${code}`;
      return GY25_DATE_OVERRIDE ? `${base}?date=${encodeURIComponent(GY25_DATE_OVERRIDE)}` : base;
    },
  },
};

interface APIMetadata {
  apiVersion: string;
  apiReleased: string;
  apiStatus: string;
}

interface SubjectSummary {
  code: string;
  name?: string;
  modifiedDate?: string;
}

interface SubjectsListResponse extends APIMetadata {
  subjects: SubjectSummary[];
}

interface LocalSubjectEntry {
  code: string;
  modifiedDate: string;
  filePath: string;
}

interface VersionState {
  subjectCount: number;
  listHash: string;
  updatedAt: string;
  dateOverride: string | null;
}

interface FetchState {
  apiVersion: string;
  apiReleased: string;
  apiStatus: string;
  updatedAt: string;
  versions: Record<VersionKey, VersionState>;
}

interface VersionReport {
  version: VersionKey;
  status: 'ok' | 'error';
  subjectCount: number;
  toFetchCount: number;
  fetchedCount: number;
  removedCount: number;
  unchangedCount: number;
  addedSample: string[];
  removedSample: string[];
  changedSample: string[];
  addedCodes?: string[];
  removedCodes?: string[];
  changedCodes?: string[];
  error?: string;
}

interface FetchReport {
  generatedAt: string;
  apiMetadata: APIMetadata;
  gy25DateOverride: string | null;
  versions: Record<VersionKey, VersionReport>;
  hadChanges: boolean;
}

interface HistoryVersionEntry {
  subjectCount: number;
  fetchedCount: number;
  removedCount: number;
  unchangedCount: number;
  addedCodes: string[];
  removedCodes: string[];
  changedCodes: string[];
}

interface FetchHistoryFile {
  schemaVersion: 1;
  entries: FetchHistoryEntry[];
}

async function ensureDirectoryExists(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return Object.keys(obj)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = stableValue(obj[key]);
        return acc;
      }, {});
  }
  return value;
}

function hashJson(value: unknown): string {
  const stable = JSON.stringify(stableValue(value));
  return createHash('sha256').update(stable).digest('hex');
}

async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  const tmpPath = `${filePath}.tmp`;
  await ensureDirectoryExists(path.dirname(filePath));
  await fs.writeFile(tmpPath, JSON.stringify(data, null, 2) + '\n', 'utf8');
  await fs.rename(tmpPath, filePath);
}

function jitter(ms: number): number {
  return Math.floor(Math.random() * Math.max(1, ms * 0.2));
}

function isRetryableError(error: unknown): boolean {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    if (!status) return true;
    if (status >= 500) return true;
    if (status === 408 || status === 429) return true;
    return false;
  }
  return false;
}

async function fetchData<T>(url: string): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= FETCH_MAX_ATTEMPTS; attempt += 1) {
    try {
      const response = await axios.get<T>(url, {
        headers: {
          Accept: 'application/json',
        },
        timeout: 25000,
      });
      return response.data;
    } catch (error) {
      lastError = error;
      const retryable = isRetryableError(error);
      if (!retryable || attempt >= FETCH_MAX_ATTEMPTS) {
        break;
      }

      const waitMs = FETCH_BASE_DELAY_MS * 2 ** (attempt - 1) + jitter(FETCH_BASE_DELAY_MS);
      console.warn(`Request failed (attempt ${attempt}/${FETCH_MAX_ATTEMPTS}) for ${url}. Retrying in ${waitMs}ms...`);
      await sleep(waitMs);
    }
  }

  throw lastError;
}

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function loadLocalSubjects(version: VersionKey): Promise<Map<string, LocalSubjectEntry>> {
  const dir = path.join(CONTENT_DIR, `${version}-subjects`);
  const result = new Map<string, LocalSubjectEntry>();

  try {
    const files = await fs.readdir(dir);
    for (const file of files) {
      if (!file.endsWith('.json')) {
        continue;
      }

      const filePath = path.join(dir, file);
      try {
        const raw = await fs.readFile(filePath, 'utf8');
        const parsed = JSON.parse(raw) as { code?: string; modifiedDate?: string };
        if (!parsed.code) {
          continue;
        }

        result.set(parsed.code, {
          code: parsed.code,
          modifiedDate: parsed.modifiedDate ?? '',
          filePath,
        });
      } catch (error) {
        console.warn(`Skipping unreadable local file ${filePath}:`, error);
      }
    }
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      return result;
    }
    throw new Error(`Failed to read local subjects for ${version} in ${dir}: ${err.message}`);
  }

  return result;
}

function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(iframe|object|embed|link|meta|base)[^>]*>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '')
    .replace(/\son\w+=\S+/gi, '')
    .replace(/\s(href|src)=["']\s*javascript:[^"']*["']/gi, ' $1="#"');
}

function sanitizeSubjectHtml(subject: Record<string, unknown>): Record<string, unknown> {
  const copy = JSON.parse(JSON.stringify(subject)) as Record<string, unknown>;

  const sanitizeField = (obj: Record<string, unknown>, key: string) => {
    if (typeof obj[key] === 'string') {
      obj[key] = sanitizeHtml(obj[key] as string);
    }
  };

  sanitizeField(copy, 'description');
  sanitizeField(copy, 'purpose');

  const topCentral = copy.centralContent as Record<string, unknown> | undefined;
  if (topCentral && typeof topCentral.text === 'string') {
    topCentral.text = sanitizeHtml(topCentral.text);
  }

  if (Array.isArray(copy.knowledgeRequirements)) {
    for (const req of copy.knowledgeRequirements as Array<Record<string, unknown>>) {
      sanitizeField(req, 'text');
    }
  }

  if (Array.isArray(copy.courses)) {
    for (const course of copy.courses as Array<Record<string, unknown>>) {
      sanitizeField(course, 'description');
      const courseCentral = course.centralContent as Record<string, unknown> | undefined;
      if (courseCentral && typeof courseCentral.text === 'string') {
        courseCentral.text = sanitizeHtml(courseCentral.text);
      }
      if (Array.isArray(course.knowledgeRequirements)) {
        for (const req of course.knowledgeRequirements as Array<Record<string, unknown>>) {
          sanitizeField(req, 'text');
        }
      }
    }
  }

  return copy;
}

async function saveSubject(version: VersionKey, subject: Record<string, unknown>, now: string): Promise<void> {
  const code = String(subject.code || '').trim();
  if (!code) {
    throw new Error(`Cannot save ${version} subject without code`);
  }

  const filePath = path.join(CONTENT_DIR, `${version}-subjects`, `${code}.json`);
  const sanitized = sanitizeSubjectHtml(subject);
  const content = {
    ...sanitized,
    version,
    lastUpdated: now,
  };

  await writeJsonAtomic(filePath, content);
}

async function removeSubjectFile(filePath: string): Promise<void> {
  await fs.unlink(filePath);
}

async function fetchSubjectDetails(code: string, version: VersionKey): Promise<Record<string, unknown>> {
  const url = ENDPOINTS[version].subject(code);
  const response = await fetchData<{ subject?: Record<string, unknown> }>(url);

  if (!response.subject) {
    throw new Error(`No subject field in response for ${version}/${code}`);
  }

  return response.subject;
}

function buildListHash(subjects: SubjectSummary[]): string {
  const minimal = subjects
    .map(s => ({ code: s.code, modifiedDate: s.modifiedDate ?? '' }))
    .sort((a, b) => a.code.localeCompare(b.code));
  return hashJson(minimal);
}

function createVersionReport(version: VersionKey): VersionReport {
  return {
    version,
    status: 'ok',
    subjectCount: 0,
    toFetchCount: 0,
    fetchedCount: 0,
    removedCount: 0,
    unchangedCount: 0,
    addedSample: [],
    removedSample: [],
    changedSample: [],
  };
}

async function processVersion(
  version: VersionKey,
  now: string,
  listResponseOverride?: SubjectsListResponse,
): Promise<{
  report: VersionReport;
  state: VersionState;
  hadChanges: boolean;
  changedCodes: string[];
  addedCodes: string[];
  removedCodes: string[];
}> {
  const report = createVersionReport(version);

  const listResponse = listResponseOverride ?? await fetchData<SubjectsListResponse>(ENDPOINTS[version].subjectsList);
  const liveSubjects = Array.isArray(listResponse.subjects) ? listResponse.subjects : [];

  report.subjectCount = liveSubjects.length;

  const localSubjects = await loadLocalSubjects(version);
  const liveCodes = new Set(liveSubjects.map(subject => subject.code));

  const toFetch: SubjectSummary[] = [];
  const changedCodes: string[] = [];
  const addedCodes: string[] = [];

  for (const subject of liveSubjects) {
    const local = localSubjects.get(subject.code);
    if (!local) {
      toFetch.push(subject);
      addedCodes.push(subject.code);
      continue;
    }

    const liveModifiedDate = subject.modifiedDate ?? '';
    if (liveModifiedDate !== local.modifiedDate) {
      toFetch.push(subject);
      changedCodes.push(subject.code);
    }
  }

  const toRemove = [...localSubjects.entries()]
    .filter(([code]) => !liveCodes.has(code))
    .map(([, local]) => local);

  report.toFetchCount = toFetch.length;
  report.removedCount = toRemove.length;
  report.unchangedCount = liveSubjects.length - toFetch.length;
  report.addedSample = addedCodes.slice(0, 10);
  report.changedSample = changedCodes.slice(0, 10);
  report.removedSample = toRemove.map(entry => entry.code).slice(0, 10);
  report.addedCodes = [...addedCodes].sort();
  report.changedCodes = [...changedCodes].sort();
  report.removedCodes = toRemove.map(entry => entry.code).sort();

  const fetchedSubjects: Array<{ code: string; detail: Record<string, unknown> }> = [];

  for (let index = 0; index < toFetch.length; index += 1) {
    const subject = toFetch[index];
    const detail = await fetchSubjectDetails(subject.code, version);
    fetchedSubjects.push({ code: subject.code, detail });

    if (index < toFetch.length - 1) {
      await sleep(REQUEST_DELAY_MS);
    }
  }

  for (const entry of fetchedSubjects) {
    await saveSubject(version, entry.detail, now);
    report.fetchedCount += 1;
  }

  for (const removed of toRemove) {
    await removeSubjectFile(removed.filePath);
  }

  const state: VersionState = {
    subjectCount: liveSubjects.length,
    listHash: buildListHash(liveSubjects),
    updatedAt: now,
    dateOverride: version === 'gy25' ? GY25_DATE_OVERRIDE || null : null,
  };

  const hadChanges = toFetch.length > 0 || toRemove.length > 0;

  return {
    report,
    state,
    hadChanges,
    changedCodes: [...changedCodes].sort(),
    addedCodes: [...addedCodes].sort(),
    removedCodes: toRemove.map(entry => entry.code).sort(),
  };
}

async function loadLastAPIMetadata(): Promise<APIMetadata | null> {
  try {
    const data = await fs.readFile(API_METADATA_PATH, 'utf-8');
    const parsed = JSON.parse(data) as APIMetadata;
    if (!parsed.apiVersion || !parsed.apiReleased || !parsed.apiStatus) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function saveAPIMetadata(metadata: APIMetadata): Promise<void> {
  await writeJsonAtomic(API_METADATA_PATH, metadata);
}

async function saveFetchState(state: FetchState): Promise<void> {
  await writeJsonAtomic(FETCH_STATE_PATH, state);
}

async function saveFetchReport(report: FetchReport): Promise<void> {
  await writeJsonAtomic(FETCH_REPORT_PATH, report);
}

async function loadFetchState(): Promise<FetchState | null> {
  try {
    const raw = await fs.readFile(FETCH_STATE_PATH, 'utf8');
    return JSON.parse(raw) as FetchState;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      return null;
    }
    throw new Error(`Failed to read fetch state at ${FETCH_STATE_PATH}: ${err.message}`);
  }
}

async function loadHistory(): Promise<FetchHistoryFile> {
  try {
    const raw = await fs.readFile(CHANGELOG_HISTORY_PATH, 'utf8');
    const parsed = JSON.parse(raw) as FetchHistoryFile;
    if (!Array.isArray(parsed.entries)) {
      return { schemaVersion: 1, entries: [] };
    }
    return parsed;
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err.code === 'ENOENT') {
      return { schemaVersion: 1, entries: [] };
    }
    throw new Error(`Failed to read content changelog history at ${CHANGELOG_HISTORY_PATH}: ${err.message}`);
  }
}

function createHistoryEntry(params: {
  now: string;
  previousState: FetchState | null;
  apiMetadata: APIMetadata;
  versionReports: Record<VersionKey, VersionReport>;
}): FetchHistoryEntry {
  const { now, previousState, apiMetadata, versionReports } = params;
  const fromUpdatedAt = previousState?.updatedAt ?? null;
  const initialResync = !fromUpdatedAt;

  let longGapDays: number | null = null;
  if (fromUpdatedAt) {
    const fromMs = new Date(fromUpdatedAt).getTime();
    const toMs = new Date(now).getTime();
    if (Number.isFinite(fromMs) && Number.isFinite(toMs) && toMs > fromMs) {
      const days = Math.floor((toMs - fromMs) / (1000 * 60 * 60 * 24));
      longGapDays = days >= 90 ? days : null;
    }
  }

  const baselineLabel = fromUpdatedAt
    ? `Diff from previous sync (${fromUpdatedAt} -> ${now})`
    : `Initial resync (${now})`;

  const makeVersionEntry = (version: VersionKey): HistoryVersionEntry => {
    const report = versionReports[version];
    return {
      subjectCount: report.subjectCount,
      fetchedCount: report.fetchedCount,
      removedCount: report.removedCount,
      unchangedCount: report.unchangedCount,
      addedCodes: report.addedCodes ?? [],
      removedCodes: report.removedCodes ?? [],
      changedCodes: report.changedCodes ?? [],
    };
  };

  return {
    id: `${now}-${randomUUID()}`,
    recordedAt: now,
    fromUpdatedAt,
    toUpdatedAt: now,
    baselineLabel,
    edgeCase: {
      initialResync,
      longGapDays,
    },
    apiMetadata,
    versions: {
      gy11: makeVersionEntry('gy11'),
      gy25: makeVersionEntry('gy25'),
    },
  };
}

async function appendHistoryEntry(entry: FetchHistoryEntry): Promise<void> {
  const history = await loadHistory();
  const nextEntries = [entry, ...history.entries.filter(existing => existing.id !== entry.id)].slice(0, 200);
  await writeJsonAtomic(CHANGELOG_HISTORY_PATH, {
    schemaVersion: 1,
    entries: nextEntries,
  });
}

async function main() {
  const now = new Date().toISOString();
  const previousState = await loadFetchState();

  try {
    console.log('Fetching API metadata...');
    const gy11List = await fetchData<SubjectsListResponse>(ENDPOINTS.gy11.subjectsList);
    const currentMetadata: APIMetadata = {
      apiVersion: gy11List.apiVersion,
      apiReleased: gy11List.apiReleased,
      apiStatus: gy11List.apiStatus,
    };

    const previousMetadata = await loadLastAPIMetadata();
    if (previousMetadata) {
      console.log(
        `Previous API ${previousMetadata.apiVersion} (${previousMetadata.apiReleased}) -> Current API ${currentMetadata.apiVersion} (${currentMetadata.apiReleased})`,
      );
    } else {
      console.log(`Current API ${currentMetadata.apiVersion} (${currentMetadata.apiReleased})`);
    }

    const versionReports: Record<VersionKey, VersionReport> = {
      gy11: createVersionReport('gy11'),
      gy25: createVersionReport('gy25'),
    };

    const versionStates: Partial<Record<VersionKey, VersionState>> = {};
    let hadChanges = false;
    let hadErrors = false;

    for (const version of ['gy11', 'gy25'] as VersionKey[]) {
      console.log(`\nProcessing ${version.toUpperCase()}...`);
      try {
        const result = await processVersion(version, now, version === 'gy11' ? gy11List : undefined);
        versionReports[version] = result.report;
        versionStates[version] = result.state;
        hadChanges = hadChanges || result.hadChanges;

        console.log(
          `${version.toUpperCase()}: ${result.report.fetchedCount} fetched, ${result.report.removedCount} removed, ${result.report.unchangedCount} unchanged`,
        );
      } catch (error) {
        hadErrors = true;
        versionReports[version] = {
          ...createVersionReport(version),
          status: 'error',
          error: error instanceof Error ? error.message : String(error),
        };
        console.error(`${version.toUpperCase()} failed:`, error);
      }
    }

    const report: FetchReport = {
      generatedAt: now,
      apiMetadata: currentMetadata,
      gy25DateOverride: GY25_DATE_OVERRIDE || null,
      versions: versionReports,
      hadChanges,
    };

    await saveAPIMetadata(currentMetadata);
    await saveFetchReport(report);

    if (!hadErrors) {
      if (!versionStates.gy11 || !versionStates.gy25) {
        throw new Error('Missing version state after successful processing run.');
      }

      const fullVersionStates: Record<VersionKey, VersionState> = {
        gy11: versionStates.gy11,
        gy25: versionStates.gy25,
      };

      const state: FetchState = {
        apiVersion: currentMetadata.apiVersion,
        apiReleased: currentMetadata.apiReleased,
        apiStatus: currentMetadata.apiStatus,
        updatedAt: now,
        versions: fullVersionStates,
      };
      await saveFetchState(state);

      const historyEntry = createHistoryEntry({
        now,
        previousState,
        apiMetadata: currentMetadata,
        versionReports,
      });
      await appendHistoryEntry(historyEntry);
    }

    if (hadErrors) {
      console.error('\nCompleted with errors. See scripts/state/fetch-report-latest.json for details.');
      process.exit(1);
    }

    if (hadChanges) {
      console.log('\nCompleted with content changes.');
    } else {
      console.log('\nNo content changes detected.');
    }

    console.log('Report:', FETCH_REPORT_PATH);
    console.log('History:', CHANGELOG_HISTORY_PATH);
  } catch (error) {
    console.error('Fatal error in fetch pipeline:', error);
    process.exit(1);
  }
}

main();
