// Runs in GitHub Actions every few minutes: checks every service in docs/services.json, folds the
// result into 90 days of per-day counts, and writes status.json + history.json for the page.
// Usage: node scripts/check.mjs <previous-results-dir> <output-dir>
import { mkdir, readFile, writeFile } from "node:fs/promises";

const [prevDir = "prev", outDir = "out"] = process.argv.slice(2);
const HISTORY_DAYS = 90;
const TIMEOUT_MS = 15000;

const readJson = async (path, fallback) => {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
};

const { services } = JSON.parse(await readFile("docs/services.json", "utf8"));
const { maintenance } = JSON.parse(await readFile("docs/maintenance.json", "utf8"));
const previous = await readJson(`${prevDir}/status.json`, { services: {} });
const history = await readJson(`${prevDir}/history.json`, {});

const now = new Date();
const today = now.toISOString().slice(0, 10);

async function probe(url) {
  const started = performance.now();
  try {
    const res = await fetch(url, {
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { "user-agent": "n3rdlabs-status (+https://status.n3rdlabs.dev)" },
    });
    await res.arrayBuffer();
    return { ok: res.ok, code: res.status, ms: Math.round(performance.now() - started) };
  } catch (err) {
    return { ok: false, code: err.name === "TimeoutError" ? "timeout" : "unreachable", ms: Math.round(performance.now() - started) };
  }
}

// One retry after a pause, so a single dropped request isn't reported as an outage.
async function probeWithRetry(url) {
  const first = await probe(url);
  if (first.ok) return first;
  await new Promise((resolve) => setTimeout(resolve, 5000));
  return probe(url);
}

const inMaintenance = (id) =>
  maintenance.some((m) => m.services.includes(id) && new Date(m.start) <= now && now < new Date(m.end));

const results = {};
await Promise.all(
  services.map(async (svc) => {
    const checks = await Promise.all(svc.checks.map((c) => probeWithRetry(c.url)));
    const passing = checks.filter((c) => c.ok).length;
    let state = passing === checks.length ? "up" : passing === 0 ? "down" : "degraded";
    // Downtime inside an announced window is the plan working, not an outage.
    if (state !== "up" && inMaintenance(svc.id)) state = "maintenance";

    const before = previous.services?.[svc.id];
    results[svc.id] = {
      state,
      ms: checks[0].ms,
      checks: svc.checks.map((c, i) => ({ label: c.label, ok: checks[i].ok, code: checks[i].code })),
      since: before?.state === state ? before.since : now.toISOString(),
    };

    const days = (history[svc.id] ??= {});
    const counts = (days[today] ??= { up: 0, degraded: 0, down: 0, maintenance: 0 });
    counts[state] += 1;
    for (const day of Object.keys(days).sort().slice(0, -HISTORY_DAYS)) delete days[day];
  }),
);

for (const id of Object.keys(history)) {
  if (!services.some((svc) => svc.id === id)) delete history[id];
}

await mkdir(outDir, { recursive: true });
await writeFile(`${outDir}/status.json`, JSON.stringify({ checkedAt: now.toISOString(), services: results }, null, 1) + "\n");
await writeFile(`${outDir}/history.json`, JSON.stringify(history) + "\n");

for (const svc of services) {
  const r = results[svc.id];
  console.log(`${r.state.padEnd(11)} ${String(r.ms).padStart(5)}ms  ${svc.name}  ${r.checks.map((c) => `${c.label}:${c.code}`).join(" ")}`);
}
