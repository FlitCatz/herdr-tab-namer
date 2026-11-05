// Naming rules for agent tabs, kept free of Herdr imports so Node's test
// runner can load this file directly (see test/naming.test.js).

/** @typedef {{ key?: string, name?: string, agent?: boolean }} Program */
/** @typedef {{ tab: string, terminal: string | null, status: string | null, program?: Program, title?: string }} Pane */
/** @typedef {{ address: string, name?: string | null, title?: string | null, labels?: Record<string, string> }} Terminal */
/** @typedef {{ id: string, name: string, named: boolean }} Tab */
/** @typedef {{ tabs?: Tab[] }} Space */
/** @typedef {{ project: string, title: string }} Task */
/** @typedef {Map<string, Task>} Tasks */
/** @typedef {Tab & { pane: Pane, terminal: Terminal | null }} AgentTab */
/** @typedef {{ name: string, at: number }} Sent */

/** Longest tab name the mod writes, in characters (code points). */
export const MAX_NAME = 40;

/** How long a rename may take to show up before it is sent again. */
export const PENDING_MS = 5000;

export const FIRSTMATE_TASK = "firstmate.task";

/**
 * Collapses whitespace and cuts `text` to `max` characters with an ellipsis.
 * @param {unknown} text
 * @param {number} [max]
 */
export function truncate(text, max = MAX_NAME) {
  const flat = String(text ?? "").replace(/\s+/g, " ").trim();
  const chars = Array.from(flat);
  return chars.length > max ? chars.slice(0, max - 1).join("").trimEnd() + "…" : flat;
}

/**
 * A terminal title without the spinner or status glyphs agents put in front of it.
 * @param {unknown} title
 */
export function cleanTitle(title) {
  return String(title ?? "").replace(/^[^\p{L}\p{N}([{"'`]+/u, "").replace(/\s+/g, " ").trim();
}

/**
 * Titles that say which program runs, not what it works on: "Claude Code", "2.1.318".
 * @param {string} title
 * @param {Program | undefined} program
 */
export function isGenericTitle(title, program) {
  const t = title.toLowerCase();
  if (/^v?\d+(\.\d+)+$/.test(t)) return true;
  return [program?.name, program?.key].some((n) => typeof n === "string" && n.toLowerCase() === t);
}

/**
 * Firstmate labels a task's terminal `firstmate.task=fm-<task id>`.
 * @param {string} label
 */
export function taskId(label) {
  return String(label).replace(/^fm-/, "");
}

// Backlog rows as Firstmate writes them (`data/backlog.md`), parsed the way its fleet
// snapshot (bin/fm-fleet-snapshot.sh) reads them, which is what the Board shows:
//   - [ ] <id> - <title> blocked-by: <id> (repo: <project>) (kind: ship) (priority: 2) (since 2026-11-04)
const ROW = /^[-*]\s+\[[ xX]\]\s+(\S+)\s+-\s+(.*)$/;
const BOLD_ROW = /^[-*]\s+\*\*([^*]+)\*\*\s+-\s+(.*)$/;
const TRAILING_META = /\s*\(\s*(?:(?:repo|kind|priority|hold|hold-kind|hold-until):\s*[^)]*|(?:since|merged|reported|done)\s+[^)]*)\s*\)\s*$/;

/**
 * A row's `(key: value)` metadata, the last one when repeated.
 * @param {string} rest
 * @param {string} key
 */
function rowMeta(rest, key) {
  const m = new RegExp(`.*(?:\\(|,\\s*)${key}:\\s*([^,)]*)`).exec(rest);
  return m ? m[1].trim() : "";
}

/**
 * A row's title: links, `blocked-by:` notes and trailing metadata removed.
 * @param {string} rest
 */
export function backlogTitle(rest) {
  let title = rest
    .replace(/<?https?:\/\/[^\s)"<>]+>?/g, "")
    .replace(/\s*blocked-by:\s+[^\s)]+\s+-\s+.*$/, "")
    .replace(/\s*blocked-by:\s+\S+/g, "");
  for (let i = 0; i < 20 && TRAILING_META.test(title); i++) title = title.replace(TRAILING_META, "");
  return title
    .replace(/\s+-\s+data\/[^\s)]+\/report\.md$/, "")
    .replace(/\s+data\/[^\s)]+\/report\.md$/, "")
    .replace(/\s+-\s+local main$/, "")
    .replace(/\s+local main$/, "")
    .replace(/\s+-\s*$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The title without its project in front ("shop: x", "shop x" -> "x"), since the
 * name shows the project already.
 * @param {string} title
 * @param {string} project
 */
export function stripProject(title, project) {
  if (!project) return title;
  for (const sep of [":", " "]) {
    if (title.startsWith(project + sep)) {
      const rest = title.slice(project.length + sep.length).trim();
      if (rest) return rest;
    }
  }
  return title;
}

/**
 * Firstmate's tasks by id from its `data/backlog.md` (every section): `{ project, title }`.
 * Null when there is no backlog text, so the caller can keep what it knew.
 * @param {string | null | undefined} text
 * @returns {Tasks | null}
 */
export function parseBacklog(text) {
  if (typeof text !== "string") return null;
  /** @type {Tasks} */
  const tasks = new Map();
  for (const line of text.split("\n")) {
    const m = ROW.exec(line) ?? BOLD_ROW.exec(line);
    if (!m) continue;
    const id = m[1].trim();
    const rest = m[2];
    // The backlog writes "-" for an item with no project (Firstmate's own work).
    const repo = rowMeta(rest, "repo");
    const project = repo === "-" ? "" : repo;
    tasks.set(id, { project, title: stripProject(backlogTitle(rest), project) || id });
  }
  return tasks;
}

/**
 * `<project> · <task title>` for a Firstmate task. Null when the home doesn't know it:
 * the caller then uses the task id, but never in place of a better name it already gave.
 * @param {string} label
 * @param {Tasks} tasks
 */
export function firstmateName(label, tasks) {
  const task = tasks.get(taskId(label));
  if (!task) return null;
  return truncate(task.project ? `${task.project} · ${task.title}` : task.title);
}

/**
 * A terminal address (`t1j`, `vps/t7`): what some terminals show when nothing named them.
 * @param {string} text
 * @param {string | null | undefined} address
 */
export function isAddress(text, address) {
  return text === address || /^(?:[\w.-]+\/)?t[0-9][0-9a-z]*$/i.test(text);
}

/**
 * The name the terminal Herdr reports, else the title its program set, if it says anything.
 * @param {Terminal | null} terminal
 * @param {Partial<Pane>} pane
 */
export function generalName(terminal, pane) {
  const address = terminal?.address ?? pane?.terminal;
  const name = String(terminal?.name ?? "").trim();
  if (name && !isAddress(name, address)) return truncate(name);
  const raw = String(terminal?.title || pane?.title || "").trim();
  if (/^[~/]/.test(raw)) return null; // a shell showing its folder
  const title = cleanTitle(raw);
  if (!title || isAddress(title, address) || isGenericTitle(title, pane?.program)) return null;
  return truncate(title);
}

/**
 * The name a tab should carry: Firstmate's task first, then the general sources.
 * `fallback`: only the bare task id, because the Firstmate home doesn't know the task.
 * @param {AgentTab} entry
 * @param {Tasks} tasks
 * @returns {{ name: string, fallback: boolean } | null}
 */
export function wantedName(entry, tasks) {
  const label = entry.terminal?.labels?.[FIRSTMATE_TASK];
  if (typeof label === "string" && label) {
    const name = firstmateName(label, tasks);
    return name ? { name, fallback: false } : { name: truncate(taskId(label)), fallback: true };
  }
  const name = generalName(entry.terminal, entry.pane);
  return name ? { name, fallback: false } : null;
}

/**
 * @param {Pane} pane
 * @param {Terminal | null} terminal
 */
function isAgentPane(pane, terminal) {
  if (!pane.terminal) return false;
  if (terminal?.labels?.[FIRSTMATE_TASK]) return true;
  return pane.status != null || pane.program?.agent === true;
}

/**
 * Tabs that run an agent, each with the pane and core terminal its name comes from:
 * a Firstmate task's terminal first, else the tab's first agent. Plain shells don't count.
 * @param {Space[]} spaces
 * @param {Pane[]} panes
 * @param {Terminal[]} terminals
 * @returns {AgentTab[]}
 */
export function agentTabs(spaces, panes, terminals) {
  const byAddress = new Map((terminals ?? []).map((t) => [t.address, t]));
  /** @type {AgentTab[]} */
  const out = [];
  for (const space of spaces ?? []) {
    for (const tab of space.tabs ?? []) {
      const agents = (panes ?? [])
        .filter((p) => p.tab === tab.id)
        .map((pane) => ({ pane, terminal: byAddress.get(pane.terminal) ?? null }))
        .filter(({ pane, terminal }) => isAgentPane(pane, terminal));
      if (!agents.length) continue;
      const pick = agents.find((a) => a.terminal?.labels?.[FIRSTMATE_TASK]) ?? agents[0];
      out.push({ id: tab.id, name: tab.name, named: tab.named, ...pick });
    }
  }
  return out;
}

/**
 * `Tabs n/m`: how many agent tabs carry a name, by anyone.
 * @param {AgentTab[]} tabs
 */
export function countNamed(tabs) {
  return { named: tabs.filter((t) => t.named).length, total: tabs.length };
}

/**
 * Decides which tabs to rename. `owned` maps a tab id to the name this mod set, recorded
 * when the rename is sent so it survives a restart before the next tick; a tab whose name
 * is anything else was named by a person and is never touched. Unnamed agent tabs are
 * free to name. `pending` holds renames sent but not yet seen, so a slow one is neither
 * mistaken for a person's name nor sent on every tick.
 * Returns the renames to run and the next `owned` / `pending`.
 * `tabIds` (every tab that exists) prunes ownership of closed tabs. `force` (a click)
 * sends a wanted rename again even while the same one is still pending.
 * @param {AgentTab[]} tabs
 * @param {{ owned?: Record<string, string>, pending?: Record<string, Sent>, tasks?: Tasks, now?: number, tabIds?: Set<string> | null, force?: boolean }} state
 */
export function reconcile(tabs, { owned = {}, pending = {}, tasks = new Map(), now = 0, tabIds = null, force = false }) {
  /** @type {Record<string, string>} */
  const nextOwned = {};
  /** @type {Record<string, Sent>} */
  const nextPending = {};
  for (const [id, name] of Object.entries(owned)) if (!tabIds || tabIds.has(id)) nextOwned[id] = name;
  /** @type {{ id: string, name: string }[]} */
  const renames = [];
  for (const tab of tabs) {
    const sent = pending[tab.id];
    if (tab.named && sent && tab.name === sent.name) nextOwned[tab.id] = sent.name;
    else if (sent && now - sent.at < PENDING_MS) nextPending[tab.id] = sent;
    if (tab.named && tab.name !== nextOwned[tab.id] && !nextPending[tab.id]) {
      delete nextOwned[tab.id]; // a person's name
      continue;
    }
    const want = wantedName(tab, tasks);
    if (!want || (tab.named && tab.name === want.name)) continue;
    // A bare task id never replaces a name this mod already gave (a backlog that couldn't
    // be read, or another copy pointed at another home).
    if (want.fallback && tab.named) continue;
    if (!force && nextPending[tab.id]?.name === want.name) continue;
    renames.push({ id: tab.id, name: want.name });
    nextOwned[tab.id] = want.name;
    nextPending[tab.id] = { name: want.name, at: now };
  }
  return { renames, owned: nextOwned, pending: nextPending };
}
