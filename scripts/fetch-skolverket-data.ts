import axios from 'axios';
import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';

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

const API_BASE = 'https://api.skolverket.se/syllabus/v1';

type VersionKey = 'gy11' | 'gy25';

const ENDPOINTS: Record<VersionKey, { subjectsList: string; subject: (code: string) => string }> = {
  gy11: {
    subjectsList: `${API_BASE}/subjects?schooltype=GY&timespan=LATEST&typeOfSyllabus=SUBJECT_SYLLABUS`,
    subject: (code: string) => `${API_BASE}/subjects/${code}`,
  },
  gy25: {
    subjectsList: `${API_BASE}/subjects?schooltype=GY&timespan=LATEST&typeOfSyllabus=GRADE_SUBJECT_SYLLABUS`,
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

interface FetchHistoryEntry {
  id: string;
  recordedAt: string;
  fromUpdatedAt: string | null;
  toUpdatedAt: string;
  baselineLabel: string;
  edgeCase: {
    initialResync: boolean;
    longGapDays: number | null;
  };
  apiMetadata: APIMetadata;
  versions: Record<VersionKey, HistoryVersionEntry>;
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

async function fetchData<T>(url: string): Promise<T> {
  const response = await axios.get<T>(url, {
    headers: {
      Accept: 'application/json',
    },
    timeout: 25000,
  });
  return response.data;
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
  } catch {
    return result;
  }

  return result;
}

async function saveSubject(version: VersionKey, subject: Record<string, unknown>, now: string): Promise<void> {
  const code = String(subject.code || '').trim();
  if (!code) {
    throw new Error(`Cannot save ${version} subject without code`);
  }

  const filePath = path.join(CONTENT_DIR, `${version}-subjects`, `${code}.json`);
  const content = {
    ...subject,
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
): Promise<{
  report: VersionReport;
  state: VersionState;
  hadChanges: boolean;
  changedCodes: string[];
  addedCodes: string[];
  removedCodes: string[];
}> {
  const report = createVersionReport(version);

  const listResponse = await fetchData<SubjectsListResponse>(ENDPOINTS[version].subjectsList);
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

  for (let index = 0; index < toFetch.length; index += 1) {
    const subject = toFetch[index];
    const detail = await fetchSubjectDetails(subject.code, version);
    await saveSubject(version, detail, now);
    report.fetchedCount += 1;

    if (index < toFetch.length - 1) {
      await sleep(REQUEST_DELAY_MS);
    }
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
  } catch {
    return null;
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
  } catch {
    return { schemaVersion: 1, entries: [] };
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
    id: now,
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

    const versionStates = {} as Record<VersionKey, VersionState>;
    let hadChanges = false;
    let hadErrors = false;

    for (const version of ['gy11', 'gy25'] as VersionKey[]) {
      console.log(`\nProcessing ${version.toUpperCase()}...`);
      try {
        const result = await processVersion(version, now);
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
      const state: FetchState = {
        apiVersion: currentMetadata.apiVersion,
        apiReleased: currentMetadata.apiReleased,
        apiStatus: currentMetadata.apiStatus,
        updatedAt: now,
        versions: versionStates,
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
