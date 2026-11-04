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

/**
 * Firstmate's tasks by id from its `state/home-summary.json`: `{ project, title }`.
 * Null when the text isn't JSON, so the caller can keep what it knew.
 * @param {string | null | undefined} text
 * @returns {Tasks | null}
 */
export function parseFirstmateTasks(text) {
  /** @type {Tasks} */
  const tasks = new Map();
  let summary;
  try { summary = JSON.parse(text ?? ""); } catch { return null; }
  for (const child of Array.isArray(summary?.active_children) ? summary.active_children : []) {
    if (typeof child?.id !== "string" || !child.id) continue;
    const project = typeof child.repo === "string" ? child.repo.trim() : "";
    let title = typeof child.name === "string" ? child.name.trim() : "";
    // Firstmate titles usually start with their project ("herdr-tab-namer: ...").
    if (project && title.startsWith(`${project}:`)) title = title.slice(project.length + 1).trim();
    tasks.set(child.id, { project, title: title || child.id });
  }
  return tasks;
}

/**
 * `<project> · <task title>` for a Firstmate task, or its id when the home doesn't know it.
 * @param {string} label
 * @param {Tasks} tasks
 */
export function firstmateName(label, tasks) {
  const id = taskId(label);
  const task = tasks.get(id);
  if (!task) return truncate(id);
  return truncate(task.project ? `${task.project} · ${task.title}` : task.title);
}

/**
 * The name the terminal Herdr reports, else the title its program set, if it says anything.
 * @param {Terminal | null} terminal
 * @param {Partial<Pane>} pane
 */
export function generalName(terminal, pane) {
  const name = String(terminal?.name ?? "").trim();
  if (name) return truncate(name);
  const raw = String(terminal?.title || pane?.title || "").trim();
  if (/^[~/]/.test(raw)) return null; // a shell showing its folder
  const title = cleanTitle(raw);
  if (!title || isGenericTitle(title, pane?.program)) return null;
  return truncate(title);
}

/**
 * The name a tab should carry: Firstmate's task first, then the general sources.
 * @param {AgentTab} entry
 * @param {Tasks} tasks
 */
export function wantedName(entry, tasks) {
  const label = entry.terminal?.labels?.[FIRSTMATE_TASK];
  if (typeof label === "string" && label) return firstmateName(label, tasks);
  return generalName(entry.terminal, entry.pane);
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
 * Decides which tabs to rename. `owned` maps a tab id to the name this mod set; a tab
 * whose name is anything else was named by a person and is never touched. Unnamed agent
 * tabs are free to name. `pending` holds renames sent but not yet seen, so a slow one is
 * neither mistaken for a person's name nor sent on every tick.
 * Returns the renames to run and the next `owned` / `pending`.
 * `tabIds` (every tab that exists) prunes ownership of closed tabs.
 * @param {AgentTab[]} tabs
 * @param {{ owned?: Record<string, string>, pending?: Record<string, Sent>, tasks?: Tasks, now?: number, tabIds?: Set<string> | null }} state
 */
export function reconcile(tabs, { owned = {}, pending = {}, tasks = new Map(), now = 0, tabIds = null }) {
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
    const wanted = wantedName(tab, tasks);
    if (!wanted || (tab.named && tab.name === wanted)) continue;
    if (nextPending[tab.id]?.name === wanted) continue;
    renames.push({ id: tab.id, name: wanted });
    nextPending[tab.id] = { name: wanted, at: now };
  }
  return { renames, owned: nextOwned, pending: nextPending };
}
