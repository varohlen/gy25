import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { getImpactLabel, summarizeSubjectChange, type SubjectChangeEntry } from "../../src/utils/changelog";

const root = fileURLToPath(new URL("../..", import.meta.url));
const tsx = path.join(root, "node_modules/tsx/dist/loader.mjs");
const analyzeScript = path.join(root, "scripts/analyze-curriculum-changes.ts");

const criteria = (prefix: string) =>
  ["E", "C", "A"].map((gradeStep) => ({ gradeStep, text: `<p>${prefix} Eleven beskriver ämnets innehåll på nivå ${gradeStep}.</p>` }));

const central = "<ul><li>Det första centrala innehållet i kursen.</li><li>Lagar och andra bestämmelser inom området.</li></ul>";

// A GY11 subject: knowledge requirements live on each course, not on the subject.
const gy11Subject = (code: string) => ({
  code,
  name: `Ämne ${code}`,
  description: "<p>Ämnet handlar om hur människor arbetar tillsammans i olika sammanhang.</p>",
  purpose: "<p>Undervisningen ska ge eleverna förutsättningar att utveckla kunskaper.</p>",
  skolfsGrund: "2010:56",
  modifiedDate: "2026-09-01",
  courses: [
    { code: `${code}01`, name: "Kurs 1", centralContent: { text: central }, knowledgeRequirements: criteria("Grund.") },
    { code: `${code}02`, name: "Kurs 2", centralContent: { text: central }, knowledgeRequirements: criteria("Grund.") },
  ],
});

type Doc = ReturnType<typeof gy11Subject>;

function analyze(changes: Array<{ code: string; before: Doc; after: Doc }>) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "gy25-change-analysis-"));
  const write = (code: string, doc: Doc) => {
    const filePath = path.join(cwd, `src/content/gy11-subjects/${code}.json`);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(doc, null, 2));
  };
  const git = (args: string[]) => execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
  try {
    mkdirSync(path.join(cwd, "src/content/gy25-subjects"), { recursive: true });
    for (const change of changes) write(change.code, change.before);
    git(["init", "--quiet"]);
    git(["add", "."]);
    git(["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--quiet", "-m", "Baseline"]);
    for (const change of changes) write(change.code, change.after);
    execFileSync(process.execPath, ["--import", tsx, analyzeScript, "report"], { cwd, stdio: ["ignore", "pipe", "pipe"] });
    const report = JSON.parse(readFileSync(path.join(cwd, "scripts/state/change-impact-report.json"), "utf8"));
    return new Map<string, SubjectChangeEntry>(report.gy11.entries.map((entry: SubjectChangeEntry) => [entry.code, entry]));
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

const variant = (code: string, edit: (doc: Doc) => void) => {
  const before = gy11Subject(code);
  const after = structuredClone(before);
  edit(after);
  return { code, before, after };
};

test("analysen klassar GY11-ämnen efter faktiska innehållsändringar", () => {
  const entries = analyze([
    variant("KRAV", (doc) => {
      doc.courses[1].knowledgeRequirements[0].text = "<p>Ny lydelse. Eleven redogör översiktligt för ämnets innehåll.</p>";
    }),
    variant("BESK", (doc) => {
      doc.description = "<p>Ämnet handlar om hur organisationer leds och utvecklas över tid.</p>";
    }),
    variant("NAMN", (doc) => {
      doc.name = "Ett nytt ämnesnamn";
    }),
    variant("SKOL", (doc) => {
      doc.skolfsGrund = "2025:1";
    }),
    variant("BORT", (doc) => {
      doc.courses[0].centralContent.text = "<ul><li>Det första centrala innehållet i kursen.</li></ul>";
    }),
    variant("OMFO", (doc) => {
      doc.courses[0].centralContent.text = "<ul><li>Det första centrala innehållet i kursen.</li><li>Regler och föreskrifter som gäller inom området.</li></ul>";
    }),
  ]);

  const krav = entries.get("KRAV")!;
  assert.equal(krav.level, "high", "ändrade kunskapskrav på kursnivå ska ge high");
  assert.equal(krav.summary.knowledgeChanged, true);
  assert.deepEqual(krav.summary.courseKnowledgeChangedCodes, ["KRAV02"]);
  assert.deepEqual(krav.summary.courseMetaChangedCodes, [], "kunskapskrav ska inte räknas som kursmetadata");
  assert.equal(krav.details?.gradeCriteria.length, 1);
  assert.match(krav.details!.gradeCriteria[0], /^Kurs 2 \(KRAV02\): Betyg E: /);
  assert.ok(summarizeSubjectChange(krav).includes("Kunskapskrav ändrade i kurser: KRAV02"));

  const besk = entries.get("BESK")!;
  assert.equal(besk.level, "medium", "en ändrad beskrivning ska ge minst medium");
  assert.equal(besk.summary.descriptionChanged, true);
  assert.ok(besk.details!.purpose.some((line) => line.startsWith("Beskrivning: ")));

  const namn = entries.get("NAMN")!;
  assert.equal(namn.level, "medium");
  assert.equal(namn.summary.nameChanged, true);
  assert.equal(namn.name, "Ett nytt ämnesnamn");

  const skol = entries.get("SKOL")!;
  assert.equal(skol.level, "low");
  assert.deepEqual(skol.summary.metadataChanged, ["skolfsGrund"]);

  const bort = entries.get("BORT")!;
  assert.equal(bort.level, "medium");
  assert.equal(bort.summary.contentRemoved, true);
  assert.equal(getImpactLabel(bort.level, bort.summary.contentRemoved), "Innehåll har tagits bort");

  const omfo = entries.get("OMFO")!;
  assert.equal(omfo.level, "medium");
  assert.equal(omfo.summary.contentRemoved, false, "en omformulering är inte en borttagning");
  assert.equal(getImpactLabel(omfo.level, omfo.summary.contentRemoved), "Mindre text- eller innehållsjustering");

  for (const entry of entries.values()) {
    assert.equal(entry.summary.subjectCentralChanged, false);
  }
});

test("äldre rapporter utan de nya fälten får samma märkning som förut", () => {
  assert.equal(getImpactLabel("medium"), "Mindre text- eller innehållsjustering");
  assert.equal(getImpactLabel("high", true), "Stor förändring");
});

test("ett ämne större än 1 MiB jämförs mot HEAD i stället för att räknas som nytt", () => {
  const entries = analyze([
    variant("STOR", (doc) => {
      doc.modifiedDate = "2026-10-01";
    }),
  ].map((change) => {
    const padding = "<p>Utfyllnad för att göra filen stor.</p>".repeat(40_000);
    change.before.purpose += padding;
    change.after.purpose += padding;
    return change;
  }));
  const stor = entries.get("STOR")!;
  assert.equal(stor.level, "low");
  assert.deepEqual(stor.summary.addedCourses, []);
  assert.deepEqual(stor.summary.metadataChanged, ["modifiedDate"]);
});

test("ett git-fel avbryter analysen i stället för att ge en tom rapport", () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "gy25-change-analysis-nogit-"));
  try {
    mkdirSync(path.join(cwd, "src/content/gy11-subjects"), { recursive: true });
    const result = spawnSync(process.execPath, ["--import", tsx, analyzeScript, "report"], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, GIT_CEILING_DIRECTORIES: path.dirname(cwd) },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /git .* failed/);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
