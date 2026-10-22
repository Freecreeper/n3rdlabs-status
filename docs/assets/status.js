// Renders status.n3rdlabs.dev. Project list and planned updates ship with the page (services.json,
// maintenance.json); live results come from the `data` branch, which GitHub Actions rewrites every
// few minutes. A same-origin ?data=/path/ override exists for local previews only.

const REMOTE_DATA = "https://raw.githubusercontent.com/Freecreeper/n3rdlabs-status/data/";
const override = new URLSearchParams(location.search).get("data");
const DATA_BASE = override && override.startsWith("/") && !override.startsWith("//") ? override : REMOTE_DATA;
const HISTORY_DAYS = 90;
const STALE_AFTER_MS = 30 * 60 * 1000;
const PAST_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

const STATE_LABEL = { up: "Up", degraded: "Partly down", down: "Down", maintenance: "Updating", unknown: "No data" };

const $ = (id) => document.getElementById(id);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") node.className = value;
    else node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) {
    if (child !== null && child !== undefined && child !== false) node.append(child);
  }
  return node;
}

// Brand rule: the 3 in "n3rdlabs" is always amber, so names and sentences go through this.
function brand(text) {
  return String(text).split(/(n3rdlabs)/).map((part) =>
    part === "n3rdlabs" ? [document.createTextNode("n"), el("span", { class: "three" }, "3"), document.createTextNode("rdlabs")] : part,
  ).flat();
}

const dateTime = new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const timeOnly = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
const dayLabel = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

const sameDay = (a, b) => a.toDateString() === b.toDateString();
const when = (d) => (sameDay(d, new Date()) ? `today ${timeOnly.format(d)}` : `${dateTime.format(d)} ${timeOnly.format(d).split(" ").pop()}`);

function relative(ms) {
  const mins = Math.round(Math.abs(ms) / 60000);
  if (mins < 1) return "less than a minute";
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 48) return `${hours} h${mins % 60 ? ` ${mins % 60} min` : ""}`;
  return `${Math.round(hours / 24)} days`;
}

async function getJson(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return res.json();
}

const state = { services: [], maintenance: [], status: null, history: {}, error: false };

function windowPhase(m, now) {
  const start = new Date(m.start);
  const end = new Date(m.finishedAt || m.end);
  if (now >= end) return "done";
  if (now >= start) return "active";
  return "upcoming";
}

const serviceNames = (ids) => ids.map((id) => state.services.find((s) => s.id === id)?.name || id);
const listNames = (names) => (names.length < 3 ? names.join(" and ") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

function renderSummary(now) {
  const box = document.querySelector(".summary");
  const title = $("summary-title");
  const sub = $("summary-sub");
  box.className = "summary";

  if (!state.status) {
    box.classList.add(state.error ? "is-error" : "is-loading");
    title.replaceChildren(state.error ? "Couldn't load live checks" : "Checking everything");
    sub.textContent = state.error
      ? "The status data didn't load. The projects themselves may be fine; this page retries every minute."
      : "Loading the latest results.";
    return;
  }

  const results = state.status.services;
  const named = (kind) => state.services.filter((s) => results[s.id]?.state === kind).map((s) => s.name);
  const down = named("down");
  const partial = named("degraded");
  const updating = state.maintenance.filter((m) => windowPhase(m, now) === "active");

  if (down.length) {
    box.classList.add("is-down");
    title.replaceChildren(...brand(down.length === 1 ? `${down[0]} is down` : "Some projects are down"));
    sub.replaceChildren(...brand(`${listNames(down)} ${down.length === 1 ? "isn't" : "aren't"} responding. It's being looked at.`));
  } else if (partial.length) {
    box.classList.add("is-partial");
    title.replaceChildren(...brand(partial.length === 1 ? `${partial[0]} is partly down` : "Some projects are partly down"));
    sub.replaceChildren(...brand(`${listNames(partial)} ${partial.length === 1 ? "loads, but part of it isn't" : "load, but parts aren't"} responding.`));
  } else if (updating.length) {
    box.classList.add("is-maint");
    const m = updating[0];
    title.replaceChildren(...brand("Planned update in progress"));
    sub.replaceChildren(...brand(`${listNames(serviceNames(m.services))}: ${m.title}. Expected back by ${when(new Date(m.end))}.`));
  } else {
    box.classList.add("is-up");
    title.replaceChildren(...brand("Everything's up"));
    sub.replaceChildren(...brand(`All ${state.services.length} projects responded on the last check.`));
  }

  const age = now - new Date(state.status.checkedAt);
  if (age > STALE_AFTER_MS) sub.append(` Heads up: the last check was ${relative(age)} ago, so this may be out of date.`);
}

function maintenanceCard(m, now) {
  const phase = windowPhase(m, now);
  const start = new Date(m.start);
  const end = new Date(m.end);
  const finished = m.finishedAt ? new Date(m.finishedAt) : end;

  let timing;
  if (phase === "upcoming") {
    timing = `Starts ${when(start)} (in ${relative(start - now)}). Expected back by ${when(end)}, about ${relative(end - start)} of downtime.`;
  } else if (phase === "active") {
    timing = now < end
      ? `Started ${when(start)}. Expected back by ${when(end)}, in about ${relative(end - now)}.`
      : `Started ${when(start)}. Running a little past the expected ${when(end)}.`;
  } else {
    timing = `${when(start)} to ${timeOnly.format(finished)}. Finished.`;
  }

  const chip = { upcoming: ["Scheduled", "chip-sched"], active: ["In progress", "chip-maint"], done: ["Done", "chip-done"] }[phase];
  return el("article", { class: `plan plan-${phase}` },
    el("div", { class: "plan-top" },
      el("span", { class: `chip ${chip[1]}` }, chip[0]),
      el("h3", { class: "plan-title" }, brand(m.title)),
    ),
    el("p", { class: "plan-affects" }, brand(`Affects ${listNames(serviceNames(m.services))}`)),
    el("p", { class: "plan-time" }, timing),
    m.details ? el("p", { class: "plan-details" }, m.details) : null,
  );
}

function renderMaintenance(now) {
  const planned = $("planned");
  const pastBlock = $("past-block");
  const past = $("past");
  const sorted = [...state.maintenance].sort((a, b) => new Date(a.start) - new Date(b.start));
  const upcoming = sorted.filter((m) => windowPhase(m, now) !== "done");
  const recent = sorted.filter((m) => windowPhase(m, now) === "done" && now - new Date(m.end) < PAST_WINDOW_MS).reverse();

  planned.replaceChildren(
    ...(upcoming.length
      ? upcoming.map((m) => maintenanceCard(m, now))
      : [el("p", { class: "empty" }, "Nothing planned right now. When an update is scheduled, it shows up here with when it starts and when things should be back.")]),
  );
  pastBlock.hidden = recent.length === 0;
  past.replaceChildren(...recent.map((m) => maintenanceCard(m, now)));
}

function dayClass(counts) {
  if (!counts) return "none";
  const total = counts.up + counts.degraded + counts.down + counts.maintenance;
  if (!total) return "none";
  if (counts.down + counts.degraded === 0) return counts.up === 0 ? "maint" : "up";
  const counted = total - counts.maintenance;
  const ratio = counted ? counts.up / counted : 1;
  return ratio >= 0.95 ? "partial" : "down";
}

function uptimeBar(id) {
  const days = state.history[id] || {};
  const cells = [];
  let up = 0;
  let counted = 0;
  const today = new Date();
  for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
    const key = d.toISOString().slice(0, 10);
    const counts = days[key];
    if (counts) {
      up += counts.up;
      counted += counts.up + counts.degraded + counts.down;
    }
    const kind = dayClass(counts);
    const pct = counts && counts.up + counts.degraded + counts.down ? `${((counts.up / (counts.up + counts.degraded + counts.down)) * 100).toFixed(1).replace(/\.0$/, "")}% up` : kind === "maint" ? "planned update" : "no data";
    cells.push(el("span", { class: `day day-${kind}`, title: `${dayLabel.format(d)}: ${pct}` }));
  }
  const pct = counted ? (up / counted) * 100 : null;
  const text = pct === null ? "–" : pct === 100 ? "100%" : `${pct.toFixed(2)}%`;
  return { cells, text };
}

function serviceRow(svc, now) {
  const result = state.status?.services?.[svc.id];
  const current = result?.state || "unknown";
  const { cells, text } = uptimeBar(svc.id);

  let note = null;
  if (current === "down" || current === "degraded") {
    const failing = result.checks.filter((c) => !c.ok).map((c) => `${c.label} ${typeof c.code === "number" ? `returned ${c.code}` : c.code === "timeout" ? "timed out" : "unreachable"}`);
    note = el("p", { class: "svc-note is-bad" }, `Since ${when(new Date(result.since))}: ${failing.join(", ")}.`);
  } else {
    const next = state.maintenance
      .filter((m) => m.services.includes(svc.id) && windowPhase(m, now) !== "done")
      .sort((a, b) => new Date(a.start) - new Date(b.start))[0];
    if (next) {
      note = windowPhase(next, now) === "active"
        ? el("p", { class: "svc-note is-maint" }, `Updating now, back by ${when(new Date(next.end))}.`)
        : el("p", { class: "svc-note" }, `Update planned ${when(new Date(next.start))}.`);
    }
  }

  return el("article", { class: `svc state-${current}` },
    el("div", { class: "svc-main" },
      el("a", { class: "svc-name", href: svc.link }, brand(svc.name)),
      el("span", { class: "svc-about" }, svc.about),
    ),
    el("div", { class: "svc-bars", role: "img", "aria-label": `${svc.name}: ${text} up over the last ${HISTORY_DAYS} days` }, cells),
    el("div", { class: "svc-state" },
      el("span", { class: `chip chip-${current}` }, STATE_LABEL[current]),
      el("span", { class: "svc-meta" }, result ? `${result.ms} ms · ${text}` : text),
    ),
    note,
  );
}

function renderServices(now) {
  const groups = [...new Set(state.services.map((s) => s.group))];
  $("groups").replaceChildren(
    ...groups.map((group) =>
      el("div", { class: "group" },
        el("h3", { class: "group-title" }, group),
        state.services.filter((s) => s.group === group).map((s) => serviceRow(s, now)),
      ),
    ),
  );
}

function renderFooter() {
  const stamp = $("checked-at");
  if (!state.status) return;
  const at = new Date(state.status.checkedAt);
  stamp.dateTime = at.toISOString();
  stamp.textContent = `${when(at)} (${relative(Date.now() - at)} ago)`;
}

function render() {
  const now = new Date();
  renderSummary(now);
  renderMaintenance(now);
  if (state.services.length) renderServices(now);
  renderFooter();
}

async function loadConfig() {
  const [services, maintenance] = await Promise.all([getJson("/services.json"), getJson("/maintenance.json")]);
  state.services = services.services;
  state.maintenance = maintenance.maintenance;
}

async function loadResults() {
  try {
    const bust = `?t=${Date.now()}`;
    const [status, history] = await Promise.all([getJson(`${DATA_BASE}status.json${bust}`), getJson(`${DATA_BASE}history.json${bust}`)]);
    state.status = status;
    state.history = history;
    state.error = false;
  } catch {
    state.error = true;
  }
}

async function refresh() {
  await loadResults();
  render();
}

try {
  await loadConfig();
} catch {
  state.error = true;
}
await refresh();
setInterval(refresh, 60 * 1000);
setInterval(render, 30 * 1000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) refresh();
});
