import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type ImpactLevel = "high" | "medium" | "low";
export type VersionKey = "gy11" | "gy25";

type SubjectChangeEntry = {
  code: string;
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

type ChangeImpactReport = {
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
  const reportPath = path.join(process.cwd(), "scripts/state/change-impact-report.json");
  changeCache = parseJsonFile<ChangeImpactReport>(reportPath);
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

export function getImpactLabel(level: ImpactLevel): string {
  if (level === "high") return "Stor förändring";
  if (level === "medium") return "Mindre text- eller innehållsjustering";
  return "Främst metadata eller teknisk uppdatering";
}

export function toSvDate(isoLike?: string | null): string {
  if (!isoLike) return "okänt datum";
  const parsed = new Date(isoLike);
  if (Number.isNaN(parsed.getTime())) return isoLike;
  return new Intl.DateTimeFormat("sv-SE", {
    year: "numeric",
    month: "long",
    day: "numeric",
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
    bullets.push("Betygskriterier/kunskapskrav har ändrats.");
  }
  if (entry.summary.purposeChanged) {
    bullets.push("Ämnets syfte har reviderats.");
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
