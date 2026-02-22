import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

type Version = "gy11" | "gy25";
type Level = "high" | "medium" | "low";

const CONTENT_DIR: Record<Version, string> = {
  gy11: "src/content/gy11-subjects",
  gy25: "src/content/gy25-subjects",
};

const STATE_DIR = "scripts/state";

type SubjectEntry = {
  code: string;
  filePath: string;
  level: Level;
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
  buckets: Record<Level, string[]>;
  entries: SubjectEntry[];
};

type FullReport = {
  generatedAt: string;
  baseline: string;
  gy11: VersionReport;
  gy25: VersionReport;
};

function runGitText(args: string[]): string {
  const res = spawnSync("git", args, { encoding: "utf8" });
  if (res.status !== 0) {
    const errorText = res.error?.message || res.stderr || "unknown git error";
    console.warn(`git ${args.join(" ")} failed: ${String(errorText).trim()}`);
    return "";
  }
  return (res.stdout || "").trim();
}

function runGitBuffer(args: string[]): Buffer {
  const res = spawnSync("git", args, { encoding: null });
  if (res.status !== 0) {
    const errorText =
      res.error?.message ||
      (Buffer.isBuffer(res.stderr) ? res.stderr.toString("utf8") : String(res.stderr || "")) ||
      "unknown git error";
    console.warn(`git ${args.join(" ")} failed: ${errorText.trim()}`);
    return Buffer.alloc(0);
  }
  return (res.stdout as Buffer) || Buffer.alloc(0);
}

function listChangedFiles(dir: string): string[] {
  const buf = runGitBuffer(["diff", "HEAD", "--name-only", "-z", "--", dir]);
  if (!buf.length) return [];
  return buf
    .toString("utf8")
    .split("\u0000")
    .map((p) => p.trim())
    .filter((p) => p.length > 0 && p.endsWith(".json"));
}

function loadOldJson(filePath: string): any | null {
  const txt = runGitText(["show", `HEAD:${filePath}`]);
  if (!txt) return null;
  try {
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

function loadNewJson(filePath: string): any | null {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function normalizeText(value: unknown): string {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeKnowledgeRequirement(value: unknown): string {
  if (!value || typeof value !== "object") {
    return normalizeText(value);
  }

  const req = value as Record<string, unknown>;
  const step =
    normalizeText(req.gradeStep) ||
    normalizeText(req.grade) ||
    normalizeText(req.step);
  const text = normalizeText(req.text);
  return `${step}|${text}`;
}

function stripHtml(html: unknown): string {
  return String(html ?? "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|ul|ol)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function extractTextUnits(value: unknown): string[] {
  const text = stripHtml(value);
  if (!text) return [];
  return text
    .split(/[\n•]+|(?<=[.!?])\s+/)
    .map((line) => normalizeText(line))
    .filter((line) => line.length >= 24);
}

function clip(text: string, maxLen = 220): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen).trim()}...`;
}

function textHighlights(before: unknown, after: unknown, maxItems = 4): string[] {
  const beforeUnits = extractTextUnits(before);
  const afterUnits = extractTextUnits(after);
  const beforeSet = new Set(beforeUnits);
  const afterSet = new Set(afterUnits);
  const added = afterUnits.filter((line) => !beforeSet.has(line));
  const removed = beforeUnits.filter((line) => !afterSet.has(line));
  if (
    added.length === 1 &&
    removed.length === 1 &&
    Math.min(added[0].length, removed[0].length) > 80 &&
    (added[0].includes(removed[0].slice(0, 80)) ||
      removed[0].includes(added[0].slice(0, 80)))
  ) {
    return ["En formulering har justerats."];
  }
  const lines: string[] = [];
  for (const line of added.slice(0, maxItems)) lines.push(`Tillagt: ${clip(line)}`);
  for (const line of removed.slice(0, maxItems - lines.length)) lines.push(`Borttaget: ${clip(line)}`);
  if (lines.length === 0 && stableJson(before) !== stableJson(after)) {
    lines.push("Formuleringar har reviderats.");
  }
  return lines.slice(0, maxItems);
}

function formatCourseLabel(course: any): string {
  const label = normalizeText(course?.name || "");
  const code = normalizeText(course?.code || "");
  if (label && code) return `${label} (${code})`;
  return label || code || "Okänd nivå";
}

function buildGradeCriteriaHighlights(oldDoc: any, newDoc: any): string[] {
  const oldCriteria = Array.isArray(oldDoc?.knowledgeRequirements)
    ? oldDoc.knowledgeRequirements
    : [];
  const newCriteria = Array.isArray(newDoc?.knowledgeRequirements)
    ? newDoc.knowledgeRequirements
    : [];
  const oldByStep = new Map(oldCriteria.map((item: any) => [item?.gradeStep, item]));
  const newByStep = new Map(newCriteria.map((item: any) => [item?.gradeStep, item]));
  const steps = [...new Set([...oldByStep.keys(), ...newByStep.keys()])].filter(Boolean).sort();
  const lines: string[] = [];

  for (const step of steps) {
    const before = oldByStep.get(step);
    const after = newByStep.get(step);
    if (!before && after) {
      lines.push(`Nytt kriterium för betyg ${step}.`);
      continue;
    }
    if (before && !after) {
      lines.push(`Betyg ${step} har tagits bort.`);
      continue;
    }
    if (stableJson(before?.text ?? "") !== stableJson(after?.text ?? "")) {
      const snippets = textHighlights(before?.text ?? "", after?.text ?? "", 1);
      lines.push(`Betyg ${step}: ${snippets[0] ?? "Formuleringar har reviderats."}`);
    }
  }
  return lines.slice(0, 5);
}

function stableJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

type DiffItem = {
  path: string;
  before: unknown;
  after: unknown;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatValue(value: unknown, maxLen = 280): string {
  const raw = typeof value === "string" ? value : JSON.stringify(value);
  if (!raw) return String(value);
  const compact = raw.replace(/\s+/g, " ").trim();
  if (compact.length <= maxLen) return compact;
  return `${compact.slice(0, maxLen)}...`;
}

function collectDiff(before: unknown, after: unknown, basePath = ""): DiffItem[] {
  if (stableJson(before) === stableJson(after)) return [];

  if (Array.isArray(before) && Array.isArray(after)) {
    const items: DiffItem[] = [];
    const maxLen = Math.max(before.length, after.length);
    for (let i = 0; i < maxLen; i += 1) {
      const path = `${basePath}[${i}]`;
      if (i >= before.length) {
        items.push({ path, before: undefined, after: after[i] });
      } else if (i >= after.length) {
        items.push({ path, before: before[i], after: undefined });
      } else {
        items.push(...collectDiff(before[i], after[i], path));
      }
    }
    return items;
  }

  if (isObject(before) && isObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    const items: DiffItem[] = [];
    for (const key of [...keys].sort()) {
      const path = basePath ? `${basePath}.${key}` : key;
      items.push(...collectDiff(before[key], after[key], path));
    }
    return items;
  }

  return [{ path: basePath || "(root)", before, after }];
}

function compareSubject(filePath: string): SubjectEntry {
  const oldDoc = loadOldJson(filePath);
  const newDoc = loadNewJson(filePath);
  const code = path.basename(filePath, ".json");

  if (!oldDoc || !newDoc) {
    return {
      code,
      filePath,
      level: "high",
      summary: {
        addedCourses: [],
        removedCourses: [],
        purposeChanged: false,
        subjectCentralChanged: false,
        knowledgeChanged: false,
        gradeCriteriaChanged: false,
        courseCentralChangedCodes: [],
        courseMetaChangedCodes: [],
        metadataChanged: ["file_level_change_or_parse_error"],
      },
      details: {
        purpose: ["Filen är ny, borttagen eller kunde inte jämföras mot tidigare version."],
        centralContent: [],
        gradeCriteria: [],
        courses: [],
      },
    };
  }

  const oldCourses = Array.isArray(oldDoc.courses) ? oldDoc.courses : [];
  const newCourses = Array.isArray(newDoc.courses) ? newDoc.courses : [];
  const oldByCode = new Map(oldCourses.map((c: any) => [c.code, c]));
  const newByCode = new Map(newCourses.map((c: any) => [c.code, c]));

  const addedCourses = [...newByCode.keys()].filter((k) => !oldByCode.has(k));
  const removedCourses = [...oldByCode.keys()].filter((k) => !newByCode.has(k));

  const purposeChanged = normalizeText(oldDoc.purpose) !== normalizeText(newDoc.purpose);

  const oldKnowledge = Array.isArray(oldDoc.knowledgeRequirements)
    ? oldDoc.knowledgeRequirements.map((v: unknown) => normalizeKnowledgeRequirement(v))
    : [];
  const newKnowledge = Array.isArray(newDoc.knowledgeRequirements)
    ? newDoc.knowledgeRequirements.map((v: unknown) => normalizeKnowledgeRequirement(v))
    : [];
  const knowledgeChanged = stableJson(oldKnowledge) !== stableJson(newKnowledge);
  // Kept as alias for compatibility with UI/report fields that still read gradeCriteriaChanged.
  const gradeCriteriaChanged = knowledgeChanged;

  const oldCentral = Array.isArray(oldDoc.centralContent)
    ? oldDoc.centralContent.map((v: unknown) => normalizeText(v))
    : [];
  const newCentral = Array.isArray(newDoc.centralContent)
    ? newDoc.centralContent.map((v: unknown) => normalizeText(v))
    : [];
  const subjectCentralChanged = stableJson(oldCentral) !== stableJson(newCentral);

  const courseCentralChangedCodes: string[] = [];
  const courseMetaChangedCodes: string[] = [];

  for (const [courseCode, newCourse] of newByCode) {
    const oldCourse = oldByCode.get(courseCode);
    if (!oldCourse) continue;

    const oldCentralJson = stableJson(oldCourse.centralContent);
    const newCentralJson = stableJson(newCourse.centralContent);
    if (oldCentralJson !== newCentralJson) {
      courseCentralChangedCodes.push(courseCode);
    }

    const oldCopy = { ...oldCourse };
    const newCopy = { ...newCourse };
    delete oldCopy.centralContent;
    delete newCopy.centralContent;
    if (stableJson(oldCopy) !== stableJson(newCopy)) {
      courseMetaChangedCodes.push(courseCode);
    }
  }

  const purposeHighlights = textHighlights(oldDoc.purpose ?? "", newDoc.purpose ?? "", 3);
  const subjectCentralHighlights = textHighlights(
    oldDoc.centralContent ?? "",
    newDoc.centralContent ?? "",
    3,
  );
  const gradeCriteriaHighlights = buildGradeCriteriaHighlights(oldDoc, newDoc);
  const courseHighlights: string[] = [];
  for (const [courseCode, newCourse] of newByCode) {
    const oldCourse = oldByCode.get(courseCode);
    if (!oldCourse) {
      courseHighlights.push(`Ny nivå/kurs: ${formatCourseLabel(newCourse)}`);
      continue;
    }
    if (stableJson(oldCourse.centralContent) !== stableJson(newCourse.centralContent)) {
      const label = formatCourseLabel(newCourse);
      const delta = textHighlights(
        oldCourse.centralContent?.text ?? oldCourse.centralContent ?? "",
        newCourse.centralContent?.text ?? newCourse.centralContent ?? "",
        1,
      )[0];
      courseHighlights.push(
        delta
          ? `${label}: ${delta}`
          : `${label}: Centralt innehåll har justerats.`,
      );
    }
  }
  for (const [courseCode, oldCourse] of oldByCode) {
    if (!newByCode.has(courseCode)) {
      courseHighlights.push(`Borttagen nivå/kurs: ${formatCourseLabel(oldCourse)}`);
    }
  }

  const metadataFields = [
    "englishName",
    "reform",
    "startDate",
    "modifiedDate",
    "versionInfo",
    "skolfsAndring",
    "lastUpdated",
    "endDate",
    "canceledDate",
  ];
  const metadataChanged = metadataFields.filter(
    (field) => stableJson(oldDoc[field]) !== stableJson(newDoc[field]),
  );

  let level: Level = "low";
  if (addedCourses.length > 0 || removedCourses.length > 0 || knowledgeChanged) {
    level = "high";
  } else if (purposeChanged || subjectCentralChanged || courseCentralChangedCodes.length > 0) {
    level = "medium";
  }

  return {
    code,
    filePath,
    level,
    summary: {
      addedCourses,
      removedCourses,
      purposeChanged,
      subjectCentralChanged,
      knowledgeChanged,
      gradeCriteriaChanged,
      courseCentralChangedCodes,
      courseMetaChangedCodes,
      metadataChanged,
    },
    details: {
      purpose: purposeHighlights,
      centralContent: subjectCentralHighlights,
      gradeCriteria: gradeCriteriaHighlights,
      courses: courseHighlights.slice(0, 6),
    },
  };
}

function generateVersionReport(version: Version): VersionReport {
  const dir = CONTENT_DIR[version];
  const changedFiles = listChangedFiles(dir);
  const entries = changedFiles.map(compareSubject).sort((a, b) => a.code.localeCompare(b.code));
  const buckets: Record<Level, string[]> = {
    high: entries.filter((e) => e.level === "high").map((e) => e.code),
    medium: entries.filter((e) => e.level === "medium").map((e) => e.code),
    low: entries.filter((e) => e.level === "low").map((e) => e.code),
  };
  return {
    totalChanged: entries.length,
    buckets,
    entries,
  };
}

function writeReportFiles(report: FullReport): void {
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(
    path.join(STATE_DIR, "change-impact-report.json"),
    JSON.stringify(report, null, 2),
  );

  const lines = [
    "# Change Impact Report",
    "",
    `Generated: ${report.generatedAt}`,
    `Baseline: ${report.baseline}`,
    "",
    "## GY25",
    `- Changed subjects: ${report.gy25.totalChanged}`,
    `- High impact (${report.gy25.buckets.high.length}): ${report.gy25.buckets.high.join(", ") || "-"}`,
    `- Medium impact (${report.gy25.buckets.medium.length}): ${report.gy25.buckets.medium.join(", ") || "-"}`,
    `- Low impact (${report.gy25.buckets.low.length}): ${report.gy25.buckets.low.join(", ") || "-"}`,
    "",
    "## GY11",
    `- Changed subjects: ${report.gy11.totalChanged}`,
    `- High impact (${report.gy11.buckets.high.length}): ${report.gy11.buckets.high.join(", ") || "-"}`,
    `- Medium impact (${report.gy11.buckets.medium.length}): ${report.gy11.buckets.medium.join(", ") || "-"}`,
    `- Low impact (${report.gy11.buckets.low.length}): ${report.gy11.buckets.low.join(", ") || "-"}`,
    "",
  ];
  writeFileSync(path.join(STATE_DIR, "change-impact-report.md"), lines.join("\n"));
}

function readOrBuildReport(): FullReport {
  const reportPath = path.join(STATE_DIR, "change-impact-report.json");
  try {
    return JSON.parse(readFileSync(reportPath, "utf8")) as FullReport;
  } catch {
    const report: FullReport = {
      generatedAt: new Date().toISOString(),
      baseline: "git HEAD vs current workspace",
      gy11: generateVersionReport("gy11"),
      gy25: generateVersionReport("gy25"),
    };
    writeReportFiles(report);
    return report;
  }
}

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function writeSubjectDiff(version: Version, code: string, full = false): string {
  const filePath = `${CONTENT_DIR[version]}/${code}.json`;
  const oldDoc = loadOldJson(filePath);
  const newDoc = loadNewJson(filePath);
  const view = (value: unknown) => formatValue(value, full ? Number.MAX_SAFE_INTEGER : 280);

  if (!oldDoc && !newDoc) {
    throw new Error(`Subject not found: ${version}/${code}`);
  }

  const lines: string[] = [];
  lines.push(`# Subject Diff ${version.toUpperCase()} ${code}`);
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push(`File: ${filePath}`);
  lines.push("");

  if (!oldDoc) {
    lines.push("- New file (did not exist in HEAD).");
  } else if (!newDoc) {
    lines.push("- File removed from workspace.");
  } else {
    const trackedFields = [
      "name",
      "englishName",
      "startDate",
      "modifiedDate",
      "versionInfo",
      "skolfsGrund",
      "skolfsAndring",
      "endDate",
      "canceledDate",
    ];
    lines.push("## Metadata");
    let hasMeta = false;
    for (const field of trackedFields) {
      const before = stableJson(oldDoc[field]);
      const after = stableJson(newDoc[field]);
      if (before !== after) {
        hasMeta = true;
        lines.push(`- ${field}: ${before} -> ${after}`);
      }
    }
    if (!hasMeta) lines.push("- No metadata change.");
    lines.push("");

    lines.push("## Subject Text");
    const purposeDiff = collectDiff(oldDoc.purpose ?? null, newDoc.purpose ?? null, "purpose");
    const centralDiff = collectDiff(
      oldDoc.centralContent ?? [],
      newDoc.centralContent ?? [],
      "centralContent",
    );
    const knowledgeDiff = collectDiff(
      oldDoc.knowledgeRequirements ?? [],
      newDoc.knowledgeRequirements ?? [],
      "knowledgeRequirements",
    );
    lines.push(`- purpose changes: ${purposeDiff.length}`);
    for (const item of purposeDiff.slice(0, 8)) {
      lines.push(`- ${item.path}`);
      lines.push(`  before: ${view(item.before)}`);
      lines.push(`  after: ${view(item.after)}`);
    }
    lines.push(`- centralContent changes: ${centralDiff.length}`);
    for (const item of centralDiff.slice(0, 8)) {
      lines.push(`- ${item.path}`);
      lines.push(`  before: ${view(item.before)}`);
      lines.push(`  after: ${view(item.after)}`);
    }
    lines.push(`- knowledgeRequirements changes: ${knowledgeDiff.length}`);
    for (const item of knowledgeDiff.slice(0, 8)) {
      lines.push(`- ${item.path}`);
      lines.push(`  before: ${view(item.before)}`);
      lines.push(`  after: ${view(item.after)}`);
    }
    lines.push("");

    lines.push("## Courses");
    const oldCourses = Array.isArray(oldDoc.courses) ? oldDoc.courses : [];
    const newCourses = Array.isArray(newDoc.courses) ? newDoc.courses : [];
    const oldByCode = new Map(oldCourses.map((c: any) => [c.code, c]));
    const newByCode = new Map(newCourses.map((c: any) => [c.code, c]));

    const added = [...newByCode.keys()].filter((k) => !oldByCode.has(k));
    const removed = [...oldByCode.keys()].filter((k) => !newByCode.has(k));
    lines.push(`- added course codes (${added.length}): ${added.join(", ") || "-"}`);
    lines.push(`- removed course codes (${removed.length}): ${removed.join(", ") || "-"}`);

    const centralChangedCodes: string[] = [];
    const metaChangedCodes: string[] = [];
    const perCourseDetails: string[] = [];
    for (const [courseCode, newCourse] of newByCode) {
      const oldCourse = oldByCode.get(courseCode);
      if (!oldCourse) continue;

      if (stableJson(oldCourse.centralContent) !== stableJson(newCourse.centralContent)) {
        centralChangedCodes.push(courseCode);
      }

      const oldCopy = { ...oldCourse };
      const newCopy = { ...newCourse };
      delete oldCopy.centralContent;
      delete newCopy.centralContent;
      if (stableJson(oldCopy) !== stableJson(newCopy)) {
        metaChangedCodes.push(courseCode);
      }

      const courseDiffs = collectDiff(oldCourse, newCourse, `courses.${courseCode}`);
      if (courseDiffs.length) {
        perCourseDetails.push(`- ${courseCode}: ${courseDiffs.length} fältändringar`);
        for (const item of courseDiffs.slice(0, 10)) {
          perCourseDetails.push(`- ${item.path}`);
          perCourseDetails.push(`  before: ${view(item.before)}`);
          perCourseDetails.push(`  after: ${view(item.after)}`);
        }
      }
    }
    lines.push(
      `- course centralContent changed (${centralChangedCodes.length}): ${centralChangedCodes.join(", ") || "-"}`,
    );
    lines.push(
      `- course metadata changed (${metaChangedCodes.length}): ${metaChangedCodes.join(", ") || "-"}`,
    );
    if (perCourseDetails.length > 0) {
      lines.push("");
      lines.push("## Course Field Diffs");
      lines.push(...perCourseDetails);
    }
  }

  const outPath = path.join(STATE_DIR, `subject-diff-${version}-${code}.md`);
  mkdirSync(STATE_DIR, { recursive: true });
  writeFileSync(outPath, lines.join("\n"));
  return outPath;
}

function main(): void {
  const command = process.argv[2] || "report";

  if (command === "report") {
    const report: FullReport = {
      generatedAt: new Date().toISOString(),
      baseline: "git HEAD vs current workspace",
      gy11: generateVersionReport("gy11"),
      gy25: generateVersionReport("gy25"),
    };
    writeReportFiles(report);
    console.log("Wrote scripts/state/change-impact-report.json");
    console.log("Wrote scripts/state/change-impact-report.md");
    return;
  }

  if (command === "subject") {
    const version = (getArg("--version") || "gy25") as Version;
    const code = getArg("--code");
    const full = process.argv.includes("--full");
    if (!code || (version !== "gy11" && version !== "gy25")) {
      console.log(
        "Usage: tsx scripts/analyze-curriculum-changes.ts subject --version gy25 --code FYSK [--full]",
      );
      process.exit(1);
    }
    const out = writeSubjectDiff(version, code, full);
    console.log(`Wrote ${out}`);
    return;
  }

  if (command === "list") {
    const report = readOrBuildReport();
    const version = (getArg("--version") || "gy25") as Version;
    const level = (getArg("--level") || "medium") as Level;
    if ((version !== "gy11" && version !== "gy25") || !["high", "medium", "low"].includes(level)) {
      console.log("Usage: tsx scripts/analyze-curriculum-changes.ts list --version gy25 --level medium");
      process.exit(1);
    }
    const codes = report[version].buckets[level];
    console.log(codes.join("\n"));
    return;
  }

  console.log("Usage:");
  console.log("- tsx scripts/analyze-curriculum-changes.ts report");
  console.log("- tsx scripts/analyze-curriculum-changes.ts list --version gy25 --level medium");
  console.log("- tsx scripts/analyze-curriculum-changes.ts subject --version gy25 --code FYSK [--full]");
  process.exit(1);
}

main();
