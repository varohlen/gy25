import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  getChangeReportId,
  type ArchivedChangeReport,
  type ChangeImpactReport,
  type FetchHistoryEntry,
} from "../../src/utils/changelog";

function readJson<T>(filePath: string): T | null {
  if (!existsSync(filePath)) return null;
  return JSON.parse(readFileSync(filePath, "utf8")) as T;
}

// Only associate a report with the latest recorded sync when it covers exactly the same subjects.
// The latest fetch report is deliberately not consulted: a later sync without changes overwrites
// it, and the unarchived history entry must still be archivable afterwards. An existing archive
// is never replaced, so an unrelated analysis cannot overwrite it.
export function archiveChangeImpactReport(report: ChangeImpactReport): string | null {
  const stateDir = path.join(process.cwd(), "scripts/state");
  const history = readJson<{ entries: FetchHistoryEntry[] }>(path.join(stateDir, "content-changelog-history.json"));
  const entry = history?.entries[0];
  if (!entry) return null;

  let expectedTotal = 0;
  for (const version of ["gy11", "gy25"] as const) {
    const stats = entry.versions[version];
    const expected = [...stats.addedCodes, ...stats.changedCodes, ...stats.removedCodes].sort();
    const actual = report[version].entries.map((subject) => subject.code).sort();
    if (JSON.stringify(expected) !== JSON.stringify(actual)) return null;
    expectedTotal += expected.length;
  }
  // An entry without codes cannot be told apart from an empty analysis.
  if (expectedTotal === 0) return null;

  const dir = path.join(stateDir, "change-reports");
  const filePath = path.join(dir, `${getChangeReportId(entry)}.json`);
  if (existsSync(filePath)) return filePath;
  mkdirSync(dir, { recursive: true });
  const archive: ArchivedChangeReport = { schemaVersion: 1, entry, report };
  writeFileSync(filePath, JSON.stringify(archive, null, 2) + "\n", { flag: "wx" });
  return filePath;
}

export function archivePreviousChangeImpactReport(): void {
  const report = readJson<ChangeImpactReport>(path.join(process.cwd(), "scripts/state/change-impact-report.json"));
  if (report) archiveChangeImpactReport(report);
}
