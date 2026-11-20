import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const tsx = path.join(root, "node_modules/tsx/dist/loader.mjs");
const axiosUrl = pathToFileURL(path.join(root, "node_modules/axios/index.js")).href;

type Subject = ReturnType<typeof subject>;
type MockApi = { gy11: Subject[]; gy25: Subject[]; failDetails?: string[] };

const subject = (code: string, date: string, purpose: string) => ({
  code,
  name: `Ämne ${code}`,
  modifiedDate: date,
  purpose,
  courses: [{ code: `${code}1000X`, name: "Nivå 1", centralContent: { text: "Ett centralt innehåll för undervisningen." } }],
});

// Isolerad git-katalog med ett mockat API. Detaljanrop för koder i failDetails ger fel.
function setup(baseline: MockApi) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "gy25-change-archive-"));
  const run = (command: string, args: string[]) => execFileSync(command, args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const writeJson = (relative: string, value: unknown) => {
    const filePath = path.join(cwd, relative);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, JSON.stringify(value));
  };
  const read = (relative: string) => JSON.parse(readFileSync(path.join(cwd, relative), "utf8"));
  const mockPath = path.join(cwd, "mock-api.mjs");
  writeFileSync(mockPath, `
    import axios from ${JSON.stringify(axiosUrl)};
    import {readFileSync} from 'node:fs';
    const api=JSON.parse(readFileSync('mock-api.json','utf8'));
    axios.defaults.adapter=async config=>{
      const url=new URL(config.url);
      let data;
      if(url.pathname==='/syllabus/v1/subjects') {
        const list=url.searchParams.get('typeOfSyllabus')==='GRADE_SUBJECT_SYLLABUS'?api.gy25:api.gy11;
        data={apiVersion:'test',apiReleased:'2026-10-01',apiStatus:'active',totalElements:list.length,subjects:list};
      } else {
        const code=url.pathname.split('/').pop();
        if((api.failDetails??[]).includes(code)) throw new Error('Simulated detail failure for '+code);
        const found=[...api.gy11,...api.gy25].find(s=>s.code===code);
        if(!found) throw new Error('Unexpected mock request: '+url);
        data={subject:found};
      }
      return {data,status:200,statusText:'OK',headers:{'content-type':'application/json'},config};
    };
  `);

  for (const version of ["gy11", "gy25"] as const) {
    for (const item of baseline[version]) writeJson(`src/content/${version}-subjects/${item.code}.json`, item);
  }
  run("git", ["init", "--quiet"]);
  run("git", ["add", "."]);
  run("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--quiet", "-m", "Baseline"]);

  const sync = (api: MockApi) => {
    writeJson("mock-api.json", api);
    return spawnSync(process.execPath, ["--import", tsx, "--import", mockPath, path.join(root, "scripts/fetch-skolverket-data.ts")], { cwd, encoding: "utf8" });
  };
  const analyze = () => run(process.execPath, ["--import", tsx, path.join(root, "scripts/analyze-curriculum-changes.ts"), "report"]);
  const archives = () => {
    const dir = path.join(cwd, "scripts/state/change-reports");
    return existsSync(dir) ? readdirSync(dir) : [];
  };
  const history = () => read("scripts/state/content-changelog-history.json").entries;
  const cleanup = () => rmSync(cwd, { recursive: true, force: true });
  return { cwd, sync, analyze, archives, history, read, cleanup };
}

const gy11Old = subject("GYAA", "2026-09-01", "Ett tidigare syfte för GY11-ämnet.");
const gy11New = subject("GYAA", "2026-10-01", "Ett nytt syfte för GY11-ämnet.");
const gy25Old = subject("AAAA", "2026-09-01", "Ett tidigare syfte för GY25-ämnet.");
const gy25New = subject("AAAA", "2026-10-01", "Ett nytt syfte för GY25-ämnet.");

test("en synk utan ändringar före analysen hindrar inte arkivering av föregående synk", () => {
  const env = setup({ gy11: [gy11Old], gy25: [gy25Old] });
  try {
    const api = { gy11: [gy11Old], gy25: [gy25New] };
    assert.equal(env.sync(api).status, 0);
    assert.equal(env.sync(api).status, 0, "andra synken ska lyckas utan ändringar");
    assert.equal(env.read("scripts/state/fetch-report-latest.json").hadChanges, false);
    assert.equal(env.history().length, 1);

    env.analyze();
    assert.equal(env.archives().length, 1, "rapporten ska arkiveras mot history.entries[0]");
    const archive = env.read(`scripts/state/change-reports/${env.archives()[0]}`);
    assert.equal(archive.entry.id, env.history()[0].id);
    assert.deepEqual(archive.report.gy25.entries.map((entry: { code: string }) => entry.code), ["AAAA"]);
  } finally {
    env.cleanup();
  }
});

test("en analys utan ändringar arkiveras inte", () => {
  const env = setup({ gy11: [gy11Old], gy25: [gy25Old] });
  try {
    assert.equal(env.sync({ gy11: [gy11Old], gy25: [gy25Old] }).status, 0);
    env.analyze();
    assert.equal(env.archives().length, 0);
  } finally {
    env.cleanup();
  }
});

test("ett fel i GY25 skriver inga GY11-filer, och nästa synk får fullständiga kodlistor", () => {
  const env = setup({ gy11: [gy11Old], gy25: [gy25Old] });
  try {
    const failed = env.sync({ gy11: [gy11New], gy25: [gy25New], failDetails: ["AAAA"] });
    assert.notEqual(failed.status, 0, "synken ska avslutas med fel");
    assert.deepEqual(env.read("src/content/gy11-subjects/GYAA.json"), gy11Old, "GY11 får inte skrivas när GY25 faller");
    assert.equal(execFileSync("git", ["status", "--porcelain", "--", "src/content/gy11-subjects", "src/content/gy25-subjects"], { cwd: env.cwd, encoding: "utf8" }), "");

    assert.equal(env.sync({ gy11: [gy11New], gy25: [gy25New] }).status, 0);
    const [entry] = env.history();
    assert.deepEqual(entry.versions.gy11.changedCodes, ["GYAA"]);
    assert.deepEqual(entry.versions.gy25.changedCodes, ["AAAA"]);

    env.analyze();
    assert.equal(env.archives().length, 1, "kodlistorna ska stämma med analysen så att rapporten arkiveras");
  } finally {
    env.cleanup();
  }
});
