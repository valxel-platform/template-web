// Turns Lighthouse CI's runs into the metrics perf/compare.py judges: the median Largest Contentful
// Paint, Total Blocking Time and Cumulative Layout Shift over the runs, and the JavaScript the first
// page load needs (compressed KB): from the built files when given (pull requests: the static
// server doesn't compress), else from what the browser transferred (staging: nginx compresses).
//
// usage: node perf/summarize.mjs <lhci results dir> <out.json> [dist dir]
import { gzipSync } from "node:zlib";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [dir, out, dist] = process.argv.slice(2);
const runs = readdirSync(dir)
  .filter((f) => f.startsWith("lhr-") && f.endsWith(".json"))
  .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
if (runs.length === 0) throw new Error(`no Lighthouse results in ${dir}`);

const median = (values) => {
  const v = values.filter((x) => typeof x === "number").sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : undefined;
};
const audit = (name) => median(runs.map((r) => r.audits?.[name]?.numericValue));

function jsFromDist(root) {
  // The scripts index.html loads first, compressed as nginx serves them.
  const html = readFileSync(join(root, "index.html"), "utf8");
  const scripts = [...html.matchAll(/<script[^>]+src="\/?([^"]+\.js)"/g)].map((m) => m[1]);
  const preloads = [...html.matchAll(/<link[^>]+rel="modulepreload"[^>]+href="\/?([^"]+\.js)"/g)].map(
    (m) => m[1],
  );
  const bytes = [...new Set([...scripts, ...preloads])].reduce(
    (sum, f) => sum + gzipSync(readFileSync(join(root, f)), { level: 9 }).length,
    0,
  );
  return bytes / 1024;
}

function jsTransferred() {
  return median(
    runs.map((r) => {
      const items = r.audits?.["resource-summary"]?.details?.items ?? [];
      const js = items.find((i) => i.resourceType === "script");
      return js ? js.transferSize / 1024 : undefined;
    }),
  );
}

const metrics = {
  lcp_ms: audit("largest-contentful-paint"),
  tbt_ms: audit("total-blocking-time"),
  cls: audit("cumulative-layout-shift"),
  js_kb: dist ? jsFromDist(dist) : jsTransferred(),
};
writeFileSync(
  out,
  JSON.stringify(Object.fromEntries(Object.entries(metrics).filter(([, v]) => v !== undefined)), null, 2),
);
console.log(out, metrics);
