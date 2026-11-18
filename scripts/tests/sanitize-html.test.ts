import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { safeHtml, sanitizeHtml } from "../../src/utils/sanitize-html";

const root = fileURLToPath(new URL("../..", import.meta.url));

/** Varje "<" i utdata måste inleda en tillåten tagg utan attribut. */
function assertOnlySafeTags(html: string) {
  const tags = html.match(/<[^>]*>?/g) ?? [];
  for (const tag of tags) {
    assert.match(tag, /^<\/?(h[2-5]|p|em|i|strong|ul|ol|li|span|br|italic)( \/)?>$/, `osäker tagg: ${tag}`);
  }
}

test("kända kringgåenden från VIK-152 neutraliseras", () => {
  const payloads = [
    "<svg/onload=alert(1)>",
    "<a href=javascript:alert(1)>länk</a>",
    "<scr<script></script>ipt>alert(1)</script>",
    "<img src=x onerror=alert(1)>",
    "<p onclick=\"alert(1)\">text</p>",
    "<p title='a>b' onmouseover=alert(1)>text</p>",
    "<iframe srcdoc=\"<script>alert(1)</script>\"></iframe>",
    "<!--><script>alert(1)</script>-->",
    "<SCRIPT>alert(1)</SCRIPT>",
    "<style>@import 'x'</style><p>ok</p>",
    "<<script>script>alert(1)<</script>/script>",
    "<p style=\"background:url(javascript:alert(1))\">x</p>",
    "<math><mtext><script>alert(1)</script></mtext></math>",
    "<script>alert(1)",
  ];
  for (const payload of payloads) {
    const out = sanitizeHtml(payload);
    assertOnlySafeTags(out);
    assert.doesNotMatch(out, /<script|<svg|<img|<a\b|<iframe|<math/i, `${payload} -> ${out}`);
  }
});

test("script- och style-innehåll tas bort helt", () => {
  assert.equal(sanitizeHtml("<p>a</p><script>alert(1)</script><p>b</p>"), "<p>a</p><p>b</p>");
  assert.equal(sanitizeHtml("<style>p{color:red}</style><p>b</p>"), "<p>b</p>");
  assert.equal(sanitizeHtml("<scr<script></script>ipt>alert(1)</script>"), "&lt;script>alert(1)");
});

test("alla attribut tas bort från tillåtna taggar", () => {
  assert.equal(sanitizeHtml('<ul style="list-style-type: disc;"><li data-x="1">a</li></ul>'), "<ul><li>a</li></ul>");
  assert.equal(sanitizeHtml('<span style="font-size: 10.0pt;">x</span>'), "<span>x</span>");
});

test("otillåtna taggar tas bort men texten behålls", () => {
  assert.equal(sanitizeHtml('<a href="javascript:alert(1)">länk</a>'), "länk");
  assert.equal(sanitizeHtml("<div><b>fet</b></div>"), "fet");
});

test("tillåten markup och entiteter lämnas orörda", () => {
  const html = "<h3>Syfte</h3><p>Text med <strong>fet</strong>, <em>kursiv</em>, <i>i</i> och <italic>it</italic>.</p>"
    + "<ol><li>ett</li></ol><h4>Rubrik</h4><h5>Under</h5><h2>Två</h2><br><br />&auml;&nbsp;&ndash;";
  assert.equal(sanitizeHtml(html), html);
});

test("fristående < escapas", () => {
  assert.equal(sanitizeHtml("a < b och 3<4"), "a &lt; b och 3&lt;4");
  assert.equal(sanitizeHtml("<p"), "&lt;p");
});

test("safeHtml tål saknade värden", () => {
  assert.equal(safeHtml(undefined), "");
  assert.equal(safeHtml(null), "");
  assert.equal(safeHtml("<p>x</p>"), "<p>x</p>");
});

test("sparad API-data ändras bara där den har attribut", () => {
  let checked = 0;
  for (const version of ["gy25-subjects", "gy11-subjects"]) {
    const dir = path.join(root, "src/content", version);
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".json"))) {
      const walk = (value: unknown) => {
        if (typeof value === "string") {
          if (!value.includes("<")) return;
          checked++;
          const out = sanitizeHtml(value);
          assertOnlySafeTags(out);
          // Ta bort attribut i originalet; då ska resultatet vara identiskt.
          const expected = value.replace(/<(\/?[a-z0-9]+)\s+[^<>]*?(\s*\/)?>/gi, (_, name, selfClose) =>
            name.toLowerCase() === "br" && selfClose ? "<br />" : `<${name}>`);
          assert.equal(out, expected, `${version}/${file}`);
        } else if (Array.isArray(value)) {
          value.forEach(walk);
        } else if (value && typeof value === "object") {
          Object.values(value).forEach(walk);
        }
      };
      walk(JSON.parse(readFileSync(path.join(dir, file), "utf8")));
    }
  }
  assert.ok(checked > 1000, `för få html-fält kontrollerade (${checked})`);
});
