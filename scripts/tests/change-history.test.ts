import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const tsx = path.join(root, "node_modules/tsx/dist/loader.mjs");

test("syncs retain complete, immutable reports through no-change and subsequent updates", () => {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "gy25-change-history-"));
  const run = (command: string, args: string[]) => execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const json = (relative: string, value: unknown) => {
    const filePath = path.join(cwd, relative);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(value));
  };
  const read = (relative: string) => JSON.parse(readFileSync(path.join(cwd, relative), "utf8"));
  const subject = (code: string, name: string, date: string, purpose: string) => ({
    code, name, modifiedDate: date, purpose,
    courses: [{ code: `${code}1000X`, name: "Nivå 1", centralContent: { text: "Ett centralt innehåll för undervisningen." } }],
  });
  const mockPath = path.join(cwd, "mock-api.mjs");
  const sync = (subjects: unknown[]) => {
    json("mock-subjects.json", subjects);
    run(process.execPath, ["--import", tsx, "--import", mockPath, path.join(root, "scripts/fetch-skolverket-data.ts")]);
  };
  const analyze = () => run(process.execPath, ["--import", tsx, path.join(root, "scripts/analyze-curriculum-changes.ts"), "report"]);
  const archives = () => readdirSync(path.join(cwd, "scripts/state/change-reports"));
  const loadLatest = () => JSON.parse(run(process.execPath, ["--import", tsx, "--input-type=module", "-e",
    `import {loadChangeImpactReport} from ${JSON.stringify(pathToFileURL(path.join(root, "src/utils/changelog.ts")).href)}; console.log(JSON.stringify(loadChangeImpactReport()));`]));

  try {
    writeFileSync(mockPath, `
      import axios from ${JSON.stringify(pathToFileURL(path.join(root, "node_modules/axios/index.js")).href)};
      import {readFileSync} from 'node:fs';
      const subjects=JSON.parse(readFileSync('mock-subjects.json','utf8'));
      axios.defaults.adapter=async config=>{
        const url=new URL(config.url);
        let data;
        if(url.pathname==='/syllabus/v1/subjects') {
          data={apiVersion:'test',apiReleased:'2026-10-01',apiStatus:'active',subjects:url.searchParams.get('typeOfSyllabus')==='GRADE_SUBJECT_SYLLABUS'?subjects:[]};
        } else {
          const subject=subjects.find(s=>s.code===url.pathname.split('/').pop());
          if(!subject) throw new Error('Unexpected mock request: '+url);
          data={subject};
        }
        return {data,status:200,statusText:'OK',headers:{},config};
      };
    `);
    run("git", ["init", "--quiet"]);
    const before = subject("AAAA", "Äldre namn", "2026-09-01", "Tidigare syfte för undervisningen.");
    const removed = subject("CCCC", "Ett borttaget ämne", "2026-09-01", "Ett tidigare ämnessyfte.");
    json("src/content/gy25-subjects/AAAA.json", before);
    json("src/content/gy25-subjects/CCCC.json", removed);
    mkdirSync(path.join(cwd, "src/content/gy11-subjects"), { recursive: true });
    run("git", ["add", "."]);
    run("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--quiet", "-m", "Baseline"]);

    const changed = subject("AAAA", "Namn vid första uppdateringen", "2026-10-01", "Ett nytt syfte för undervisningen.");
    const added = subject("BBBB", "Nytt ämne", "2026-10-01", "Syftet för ett nytt ämne.");
    sync([changed, added]);
    analyze();
    assert.equal(archives().length, 1);
    const firstFile = path.join(cwd, "scripts/state/change-reports", archives()[0]);
    const firstBytes = readFileSync(firstFile, "utf8");
    const first = JSON.parse(firstBytes);
    assert.deepEqual(first.report.gy25.entries.map((entry: { code: string }) => entry.code), ["AAAA", "BBBB", "CCCC"]);
    assert.equal(first.report.gy25.entries[0].name, changed.name);
    assert.ok(first.report.gy25.entries[0].details.purpose.some((line: string) => line.includes("Ett nytt syfte")));
    assert.deepEqual(first.report.gy25.entries[1].summary.addedCourses, ["BBBB1000X"]);
    assert.equal(first.report.gy25.entries[2].name, removed.name);
    assert.deepEqual(first.report.gy25.entries[2].summary.removedCourses, ["CCCC1000X"]);

    // Protect installations where the last report has not been archived yet.
    rmSync(firstFile);
    sync([changed, added]);
    assert.equal(readFileSync(firstFile, "utf8"), firstBytes, "the previous report must be saved before fetch metadata is replaced");

    analyze();
    assert.equal(readFileSync(firstFile, "utf8"), firstBytes, "reanalysis must not overwrite an existing archive");
    run("git", ["add", "."]);
    run("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--quiet", "-m", "First update"]);

    sync([changed, added]);
    assert.equal(read("scripts/state/fetch-report-latest.json").hadChanges, false);
    assert.equal(read("scripts/state/content-changelog-history.json").entries.length, 1, "no-change syncs must not create empty history entries");
    analyze();
    assert.equal(read("scripts/state/change-impact-report.json").gy25.entries.length, 0);
    assert.equal(loadLatest().gy25.entries.length, 3, "the website must keep the last content update after an empty analysis");
    assert.equal(readFileSync(firstFile, "utf8"), firstBytes);

    const next = subject("AAAA", "Senare namn", "2026-10-02", "Undervisningen har fått ännu ett nytt syfte.");
    sync([next, added]);
    analyze();
    assert.equal(archives().length, 2);
    assert.equal(read("scripts/state/content-changelog-history.json").entries.length, 2);
    assert.equal(loadLatest().gy25.entries[0].name, next.name);
    assert.equal(readFileSync(firstFile, "utf8"), firstBytes, "later syncs must retain the original names, metadata and details");
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
