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
/** @typedef {{ name: string, at: number, prev?: string }} Sent */
/** @typedef {string | { name: string, prev: string }} Owned */

/** Longest tab name the mod writes, in characters (code points). */
export const MAX_NAME = 40;

/** How long a rename may take to show up before it is sent again. */
export const PENDING_MS = 5000;

export const FIRSTMATE_TASK = "firstmate.task";
export const FIRSTMATE_HOME = "firstmate.home";

/**
 * Formats Firstmate's home tag (`<prefix>-<hash>`) from an optional `.fm-secondmate-home`
 * marker's text and the 8-char SHA-256 prefix of the resolved home path.
 * @param {string | null | undefined} marker
 * @param {string} hash8
 */
export function formatHomeTag(marker, hash8) {
  const id = typeof marker === "string" ? marker.replace(/\s+/g, "") : "";
  const prefix = id ? `2ndmate-${id}` : "firstmate";
  return `${prefix}-${hash8}`;
}

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
  return String(title ?? "").replace(/^[^\p{L}\p{N}([{"'`~/]+/u, "").replace(/\s+/g, " ").trim();
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
  const title = cleanTitle(terminal?.title || pane?.title);
  if (/^[~/]/.test(title)) return null; // a shell showing its folder
  if (!title || isAddress(title, address) || isGenericTitle(title, pane?.program)) return null;
  return truncate(title);
}

/**
 * The name a tab should carry: Firstmate's task first, then the general sources.
 * `fallback`: only the bare task id, because the Firstmate home doesn't know the task
 * or the terminal's `firstmate.home` label does not match `homeId`.
 * @param {AgentTab} entry
 * @param {Tasks} tasks
 * @param {string | null} [homeId]
 * @returns {{ name: string, fallback: boolean } | null}
 */
export function wantedName(entry, tasks, homeId = null) {
  const label = entry.terminal?.labels?.[FIRSTMATE_TASK];
  if (typeof label === "string" && label) {
    const terminalHome = entry.terminal?.labels?.[FIRSTMATE_HOME];
    const sameHome = typeof homeId === "string" && homeId !== "" && terminalHome === homeId;
    const name = sameHome ? firstmateName(label, tasks) : null;
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
  /** @type {Map<string, Pane[]>} */
  const panesByTab = new Map();
  for (const pane of panes ?? []) {
    const tabId = pane.tab;
    let list = panesByTab.get(tabId);
    if (!list) {
      list = [];
      panesByTab.set(tabId, list);
    }
    list.push(pane);
  }
  /** @type {AgentTab[]} */
  const out = [];
  for (const space of spaces ?? []) {
    for (const tab of space.tabs ?? []) {
      const tabPanes = panesByTab.get(tab.id);
      if (!tabPanes) continue;
      /** @type {{ pane: Pane, terminal: Terminal | null } | null} */
      let firstAgent = null;
      /** @type {{ pane: Pane, terminal: Terminal | null } | null} */
      let firstTask = null;
      for (const pane of tabPanes) {
        const terminal = pane.terminal ? (byAddress.get(pane.terminal) ?? null) : null;
        if (!isAgentPane(pane, terminal)) continue;
        if (terminal?.labels?.[FIRSTMATE_TASK]) {
          firstTask = { pane, terminal };
          break;
        }
        if (!firstAgent) firstAgent = { pane, terminal };
      }
      const pick = firstTask ?? firstAgent;
      if (pick) out.push({ id: tab.id, name: tab.name, named: tab.named, ...pick });
    }
  }
  return out;
}

/**
 * `Tabs n/m`: how many agent tabs carry a name, by anyone.
 * @param {AgentTab[]} tabs
 */
export function countNamed(tabs) {
  let named = 0;
  for (const t of tabs) if (t.named) named++;
  return { named, total: tabs.length };
}

/**
 * The machine a tab id belongs to: `wsl` for `wsl/tb…`, `""` for a local tab.
 * @param {string} id
 */
export function machineOf(id) {
  const slash = id.lastIndexOf("/");
  return slash < 0 ? "" : id.slice(0, slash);
}

/**
 * Decides which tabs to rename. `owned` maps a tab id to the name this mod set, recorded
 * when the rename is sent so it survives a restart before the next tick. Until that name
 * shows, the entry also keeps the name it replaces (`{ name, prev }`), so a tab still
 * showing it stays the mod's and the rename is sent again. A tab whose name is anything
 * else was named by a person and is never touched. Unnamed agent tabs are
 * free to name. `pending` holds renames sent but not yet seen, so a slow one is neither
 * mistaken for a person's name nor sent on every tick.
 * Returns the renames to run and the next `owned` / `pending`.
 * `tabIds` (every tab that exists) prunes ownership of closed tabs, but only on a machine
 * that shows some tab: before the window loads its spaces, or while a machine is
 * disconnected, its tabs are missing without being closed, and losing them would leave
 * the mod's names looking like a person's for good. `force` (a click)
 * sends a wanted rename again even while the same one is still pending.
 * @param {AgentTab[]} tabs
 * @param {{ owned?: Record<string, Owned>, pending?: Record<string, Sent>, tasks?: Tasks, homeId?: string | null, now?: number, tabIds?: Set<string> | null, force?: boolean }} state
 */
export function reconcile(tabs, { owned = {}, pending = {}, tasks = new Map(), homeId = null, now = 0, tabIds = null, force = false }) {
  /** @type {Record<string, { name: string, prev?: string }>} */
  const nextOwned = {};
  /** @type {Record<string, Sent>} */
  const nextPending = {};
  const loaded = tabIds ? new Set([...tabIds].map(machineOf)) : null;
  for (const [id, entry] of Object.entries(owned)) {
    const closed = tabIds && loaded && loaded.has(machineOf(id)) && !tabIds.has(id);
    if (!closed) nextOwned[id] = typeof entry === "string" ? { name: entry } : entry;
  }
  /** @type {{ id: string, name: string }[]} */
  const renames = [];
  for (const tab of tabs) {
    const sent = pending[tab.id];
    const mine = nextOwned[tab.id];
    const matchesMine = tab.named && (
      tab.name === sent?.name ||
      tab.name === sent?.prev ||
      tab.name === mine?.name ||
      tab.name === mine?.prev
    );
    if (tab.named && !matchesMine) {
      delete nextOwned[tab.id]; // a person's name
      continue;
    }
    if (tab.named && (tab.name === sent?.name || tab.name === mine?.name)) nextOwned[tab.id] = { name: tab.name };
    else if (sent && now - sent.at < PENDING_MS) nextPending[tab.id] = sent;
    const want = wantedName(tab, tasks, homeId);
    if (!want || (tab.named && tab.name === want.name)) continue;
    // A bare task id never replaces a name this mod already gave (a backlog that couldn't
    // be read, or another copy pointed at another home).
    if (want.fallback && tab.named) continue;
    if (!force && nextPending[tab.id]?.name === want.name) continue;
    renames.push({ id: tab.id, name: want.name });
    nextOwned[tab.id] = tab.named ? { name: want.name, prev: tab.name } : { name: want.name };
    nextPending[tab.id] = tab.named ? { name: want.name, at: now, prev: tab.name } : { name: want.name, at: now };
  }
  /** @type {Record<string, Owned>} */
  const savedOwned = {};
  for (const [id, { name, prev }] of Object.entries(nextOwned)) savedOwned[id] = prev === undefined ? name : { name, prev };
  return { renames, owned: savedOwned, pending: nextPending };
}
