import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export type ImpactLevel = "high" | "medium" | "low";
export type VersionKey = "gy11" | "gy25";

export type SubjectChangeEntry = {
  code: string;
  name?: string;
  modifiedDate?: string;
  versionInfo?: string;
  filePath: string;
  level: ImpactLevel;
  summary: {
    addedCourses: string[];
    removedCourses: string[];
    purposeChanged: boolean;
    subjectCentralChanged: boolean;
    knowledgeChanged: boolean;
    gradeCriteriaChanged?: boolean;
    courseCentralChangedCodes: string[];
    courseMetaChangedCodes: string[];
    metadataChanged: string[];
    // Optional: missing in reports created before these fields were introduced.
    nameChanged?: boolean;
    descriptionChanged?: boolean;
    contentRemoved?: boolean;
    courseKnowledgeChangedCodes?: string[];
  };
  details?: {
    purpose: string[];
    centralContent: string[];
    gradeCriteria: string[];
    courses: string[];
  };
};

type VersionReport = {
  totalChanged: number;
  buckets: Record<ImpactLevel, string[]>;
  entries: SubjectChangeEntry[];
};

export type ChangeImpactReport = {
  generatedAt: string;
  baseline: string;
  gy11: VersionReport;
  gy25: VersionReport;
};

type FetchReport = {
  generatedAt: string;
  apiMetadata?: {
    apiVersion?: string;
    apiReleased?: string;
    apiStatus?: string;
  };
  versions?: Record<
    string,
    {
      subjectCount?: number;
      fetchedCount?: number;
      removedCount?: number;
      unchangedCount?: number;
      addedSample?: string[];
      changedSample?: string[];
    }
  >;
  hadChanges?: boolean;
};

export type FetchHistoryEntry = {
  id: string;
  recordedAt: string;
  fromUpdatedAt: string | null;
  toUpdatedAt: string;
  baselineLabel: string;
  edgeCase: {
    initialResync: boolean;
    longGapDays: number | null;
  };
  apiMetadata: {
    apiVersion: string;
    apiReleased: string;
    apiStatus: string;
  };
  versions: Record<
    VersionKey,
    {
      subjectCount: number;
      fetchedCount: number;
      removedCount: number;
      unchangedCount: number;
      addedCodes: string[];
      removedCodes: string[];
      changedCodes: string[];
    }
  >;
};

type FetchHistoryFile = {
  schemaVersion: 1;
  entries: FetchHistoryEntry[];
};

export type ArchivedChangeReport = {
  schemaVersion: 1;
  entry: FetchHistoryEntry;
  report: ChangeImpactReport;
};

export function getChangeReportId(entry: FetchHistoryEntry): string {
  return entry.id.replace(/[^a-zA-Z0-9_-]/g, "-");
}

export function loadArchivedChangeReport(entry: FetchHistoryEntry): ArchivedChangeReport | null {
  const filePath = path.join(process.cwd(), "scripts/state/change-reports", `${getChangeReportId(entry)}.json`);
  const archive = parseJsonFile<ArchivedChangeReport>(filePath);
  return archive?.schemaVersion === 1 && archive.entry.id === entry.id ? archive : null;
}

let archivedReportsCache: ArchivedChangeReport[] | undefined;

export function loadArchivedChangeReports(): ArchivedChangeReport[] {
  if (archivedReportsCache !== undefined) return archivedReportsCache;
  const dir = path.join(process.cwd(), "scripts/state/change-reports");
  if (!existsSync(dir)) return (archivedReportsCache = []);
  return (archivedReportsCache = readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => parseJsonFile<ArchivedChangeReport>(path.join(dir, file)))
    .filter((archive): archive is ArchivedChangeReport => archive?.schemaVersion === 1)
    .sort((a, b) => b.entry.recordedAt.localeCompare(a.entry.recordedAt)));
}

/** Länk till ämnets post i den senaste arkiverade rapport där ämnet finns med. */
export function getLatestSubjectReportHref(version: VersionKey, subjectCode: string): string | null {
  const code = subjectCode.toUpperCase();
  const archive = loadArchivedChangeReports().find((candidate) =>
    candidate.report[version].entries.some((entry) => entry.code.toUpperCase() === code),
  );
  return archive ? `/andringar/innehall/${getChangeReportId(archive.entry)}/#${code.toLowerCase()}` : null;
}

/** Sorterar ändrade ämnen efter Skolverkets ändringsdatum, nyast först, sedan namn. */
export function compareByModifiedDateDesc(
  a: { modifiedDate?: string; name?: string; code: string },
  b: { modifiedDate?: string; name?: string; code: string },
): number {
  const byDate = (b.modifiedDate ?? "").localeCompare(a.modifiedDate ?? "");
  if (byDate !== 0) return byDate;
  return (a.name ?? a.code).localeCompare(b.name ?? b.code, "sv-SE");
}

let changeCache: ChangeImpactReport | null | undefined;
let fetchCache: FetchReport | null | undefined;
let historyCache: FetchHistoryFile | null | undefined;

function parseJsonFile<T>(absolutePath: string): T | null {
  if (!existsSync(absolutePath)) return null;
  try {
    return JSON.parse(readFileSync(absolutePath, "utf8")) as T;
  } catch {
    return null;
  }
}

export function loadChangeImpactReport(): ChangeImpactReport | null {
  if (changeCache !== undefined) return changeCache;
  const latestEntry = loadFetchHistory()?.entries[0];
  const archive = latestEntry ? loadArchivedChangeReport(latestEntry) : null;
  const reportPath = path.join(process.cwd(), "scripts/state/change-impact-report.json");
  changeCache = archive?.report ?? parseJsonFile<ChangeImpactReport>(reportPath);
  return changeCache;
}

export function loadFetchReport(): FetchReport | null {
  if (fetchCache !== undefined) return fetchCache;
  const reportPath = path.join(process.cwd(), "scripts/state/fetch-report-latest.json");
  fetchCache = parseJsonFile<FetchReport>(reportPath);
  return fetchCache;
}

export function loadFetchHistory(): FetchHistoryFile | null {
  if (historyCache !== undefined) return historyCache;
  const reportPath = path.join(process.cwd(), "scripts/state/content-changelog-history.json");
  historyCache = parseJsonFile<FetchHistoryFile>(reportPath);
  return historyCache;
}

export function getSubjectChange(version: VersionKey, subjectCode: string): SubjectChangeEntry | null {
  const report = loadChangeImpactReport();
  if (!report) return null;
  const normalizedCode = subjectCode.toUpperCase();
  return report[version].entries.find((entry) => entry.code.toUpperCase() === normalizedCode) ?? null;
}

export function getImpactLabel(level: ImpactLevel, contentRemoved = false): string {
  if (level === "high") return "Stor förändring";
  if (contentRemoved) return "Innehåll har tagits bort";
  if (level === "medium") return "Mindre text- eller innehållsjustering";
  return "Främst metadata eller teknisk uppdatering";
}

export function toSvDate(isoLike?: string | null): string {
  if (!isoLike) return "okänt datum";
  const parsed = new Date(isoLike);
  if (Number.isNaN(parsed.getTime())) return isoLike;
  // Datum utan klockslag (t.ex. Skolverkets modifiedDate) tolkas som UTC-midnatt
  // och ska visas som samma dag. Tidsstämplar visas i svensk tid.
  const isDateOnly = /^\d{4}-\d{2}-\d{2}$/.test(isoLike.trim());
  return new Intl.DateTimeFormat("sv-SE", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: isDateOnly ? "UTC" : "Europe/Stockholm",
  }).format(parsed);
}

export function summarizeSubjectChange(entry: SubjectChangeEntry): string[] {
  const bullets: string[] = [];
  if (entry.summary.addedCourses.length > 0) {
    bullets.push(`Nya nivåer/kurser: ${entry.summary.addedCourses.join(", ")}`);
  }
  if (entry.summary.removedCourses.length > 0) {
    bullets.push(`Borttagna nivåer/kurser: ${entry.summary.removedCourses.join(", ")}`);
  }
  if (entry.summary.knowledgeChanged) {
    const courses = entry.summary.courseKnowledgeChangedCodes ?? [];
    bullets.push(
      courses.length > 0
        ? `Kunskapskrav ändrade i kurser: ${courses.join(", ")}`
        : "Betygskriterier/kunskapskrav har ändrats.",
    );
  }
  if (entry.summary.nameChanged) {
    bullets.push("Ämnets namn har ändrats.");
  }
  if (entry.summary.purposeChanged) {
    bullets.push("Ämnets syfte har reviderats.");
  }
  if (entry.summary.descriptionChanged) {
    bullets.push("Ämnets beskrivning har reviderats.");
  }
  if (entry.summary.subjectCentralChanged) {
    bullets.push("Centralt innehåll på ämnesnivå har ändrats.");
  }
  if (entry.summary.courseCentralChangedCodes.length > 0) {
    bullets.push(`Centralt innehåll ändrat i nivåer: ${entry.summary.courseCentralChangedCodes.join(", ")}`);
  }
  if (entry.summary.courseMetaChangedCodes.length > 0) {
    bullets.push(`Metadata ändrad i nivåer: ${entry.summary.courseMetaChangedCodes.join(", ")}`);
  }
  if (bullets.length === 0 && entry.summary.metadataChanged.length > 0) {
    bullets.push("Ändringar gäller främst metadata (datum, version eller tekniska fält).");
  }
  return bullets.slice(0, 4);
}
