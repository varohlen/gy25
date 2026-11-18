import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";

const root = fileURLToPath(new URL("../..", import.meta.url));
const tsx = path.join(root, "node_modules/tsx/dist/loader.mjs");
const axiosUrl = pathToFileURL(path.join(root, "node_modules/axios/index.js")).href;

type ListResponse = unknown;
type MockApi = { gy11: ListResponse; gy25: ListResponse; subjects: Record<string, unknown> };

const subject = (code: string, date = "2026-09-01") => ({
  code,
  name: `Ämne ${code}`,
  modifiedDate: date,
  purpose: "Ett syfte för undervisningen i ämnet.",
  courses: [{ code: `${code}1000X`, name: "Nivå 1", centralContent: { text: "Ett centralt innehåll för undervisningen." } }],
});

const list = (subjects: Array<{ code: string; modifiedDate?: string }>, extra: Record<string, unknown> = {}) => ({
  apiVersion: "test",
  apiReleased: "2026-10-01",
  apiStatus: "active",
  totalElements: subjects.length,
  subjects: subjects.map(({ code, modifiedDate }) => ({ code, modifiedDate })),
  ...extra,
});

// Kör synken i en isolerad katalog med ett mockat API. Lokala ämnen skrivs före körningen.
function setup(local: { gy11: string[]; gy25: string[] }) {
  const cwd = mkdtempSync(path.join(os.tmpdir(), "gy25-fetch-validation-"));
  const writeJson = (relative: string, value: unknown) => {
    const filePath = path.join(cwd, relative);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, typeof value === "string" ? value : JSON.stringify(value));
  };
  for (const version of ["gy11", "gy25"] as const) {
    mkdirSync(path.join(cwd, `src/content/${version}-subjects`), { recursive: true });
    for (const code of local[version]) writeJson(`src/content/${version}-subjects/${code}.json`, subject(code));
  }
  const previousMetadata = { apiVersion: "old", apiReleased: "2026-01-01", apiStatus: "active" };
  writeJson("src/content/metadata/api-metadata.json", previousMetadata);
  const mockPath = path.join(cwd, "mock-api.mjs");
  writeFileSync(mockPath, `
    import axios from ${JSON.stringify(axiosUrl)};
    import {readFileSync} from 'node:fs';
    const api=JSON.parse(readFileSync('mock-api.json','utf8'));
    axios.defaults.adapter=async config=>{
      const url=new URL(config.url);
      let data;
      if(url.pathname==='/syllabus/v1/subjects') {
        data=url.searchParams.get('typeOfSyllabus')==='GRADE_SUBJECT_SYLLABUS'?api.gy25:api.gy11;
      } else {
        const found=api.subjects[url.pathname.split('/').pop()];
        if(!found) throw new Error('Unexpected mock request: '+url);
        data={subject:found};
      }
      const html=typeof data==='string';
      return {data,status:200,statusText:'OK',headers:{'content-type':html?'text/html':'application/json'},config};
    };
  `);

  const sync = (api: MockApi, args: string[] = []) => {
    writeJson("mock-api.json", api);
    return spawnSync(process.execPath, ["--import", tsx, "--import", mockPath, path.join(root, "scripts/fetch-skolverket-data.ts"), ...args], {
      cwd,
      encoding: "utf8",
    });
  };
  const files = (version: "gy11" | "gy25") => readdirSync(path.join(cwd, `src/content/${version}-subjects`)).sort();
  const metadata = () => JSON.parse(readFileSync(path.join(cwd, "src/content/metadata/api-metadata.json"), "utf8"));
  const cleanup = () => rmSync(cwd, { recursive: true, force: true });
  return { cwd, sync, files, metadata, previousMetadata, cleanup };
}

const GY11 = ["GYAA", "GYAB"];
const GY25 = ["AAAA", "BBBB", "CCCC", "DDDD", "EEEE", "FFFF", "GGGG"];
const detailMap = (codes: string[]) => Object.fromEntries(codes.map((code) => [code, subject(code)]));
const validApi = (): MockApi => ({
  gy11: list(GY11.map((code) => subject(code))),
  gy25: list(GY25.map((code) => subject(code))),
  subjects: detailMap([...GY11, ...GY25]),
});

function assertUntouched(env: ReturnType<typeof setup>) {
  assert.deepEqual(env.files("gy11"), GY11.map((code) => `${code}.json`));
  assert.deepEqual(env.files("gy25"), GY25.map((code) => `${code}.json`));
}

const invalidGy25Lists: Array<[string, ListResponse, RegExp]> = [
  ["tom ämneslista (totalElements 0)", list([]), /contains no subjects/],
  ["svar utan subjects", { apiVersion: "test", apiReleased: "2026-10-01", apiStatus: "active", totalElements: 7 }, /missing the subjects array/],
  ["HTML-sida i stället för JSON", "<!doctype html><html><body>Underhåll</body></html>", /non-JSON response/],
  ["svar utan apiVersion", list(GY25.map((code) => subject(code)), { apiVersion: undefined }), /missing apiVersion/],
  ["totalElements som inte stämmer", list(GY25.map((code) => subject(code)), { totalElements: 500 }), /totalElements=500 but 7 subjects/],
];

for (const [name, gy25, message] of invalidGy25Lists) {
  test(`ogiltigt GY25-svar raderar inga ämnen: ${name}`, () => {
    const env = setup({ gy11: GY11, gy25: GY25 });
    try {
      const result = env.sync({ ...validApi(), gy25 });
      assert.notEqual(result.status, 0, "synken ska avslutas med fel");
      assert.match(result.stderr, message);
      assertUntouched(env);
      assert.equal(existsSync(path.join(env.cwd, "scripts/state/fetch-state.json")), false, "fetch-state får inte skrivas vid fel");
      assert.equal(existsSync(path.join(env.cwd, "scripts/state/content-changelog-history.json")), false);
    } finally {
      env.cleanup();
    }
  });
}

test("ogiltigt GY11-svar stoppar synken innan metadata eller ämnen skrivs", () => {
  for (const gy11 of ["<html>Fel</html>", list([]), list(GY11.map((code) => subject(code)), { apiReleased: undefined })]) {
    const env = setup({ gy11: GY11, gy25: GY25 });
    try {
      const result = env.sync({ ...validApi(), gy11 });
      assert.notEqual(result.status, 0);
      assertUntouched(env);
      assert.deepEqual(env.metadata(), env.previousMetadata, "api-metadata.json får inte skrivas om");
      assert.equal(existsSync(path.join(env.cwd, "scripts/state/fetch-report-latest.json")), false);
    } finally {
      env.cleanup();
    }
  }
});

test("borttagningar över taket kräver --allow-removals", () => {
  const env = setup({ gy11: GY11, gy25: GY25 });
  try {
    // Sex av sju lokala GY25-ämnen saknas i svaret. Taket är max(5, 2 %) = 5.
    const api: MockApi = { ...validApi(), gy25: list([subject("AAAA")]) };
    const blocked = env.sync(api);
    assert.notEqual(blocked.status, 0);
    assert.match(blocked.stderr, /refusing to remove 6 of 7 local subjects \(limit 5\)/);
    assert.match(blocked.stderr, /--allow-removals/);
    assertUntouched(env);

    const allowed = env.sync(api, ["--allow-removals"]);
    assert.equal(allowed.status, 0, allowed.stderr);
    assert.deepEqual(env.files("gy25"), ["AAAA.json"]);
    assert.deepEqual(env.files("gy11"), GY11.map((code) => `${code}.json`));
  } finally {
    env.cleanup();
  }
});

test("borttagningar inom taket och giltig metadata skrivs som vanligt", () => {
  const env = setup({ gy11: GY11, gy25: GY25 });
  try {
    const kept = GY25.filter((code) => code !== "GGGG");
    const result = env.sync({ ...validApi(), gy25: list(kept.map((code) => subject(code))) });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(env.files("gy25"), kept.map((code) => `${code}.json`));
    assert.deepEqual(env.metadata(), { apiVersion: "test", apiReleased: "2026-10-01", apiStatus: "active" });
  } finally {
    env.cleanup();
  }
});
