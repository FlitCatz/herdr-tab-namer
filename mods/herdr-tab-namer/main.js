import { createHash } from "crypto";
import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, terminals, theme, checking, exec, run, shared, setShared, props, readTextFile, home } from "herdr";
import { FIRSTMATE_HOME, FIRSTMATE_TASK, agentTabs, countNamed, formatHomeTag, parseBacklog, reconcile, taskId } from "./naming.js";

/** @typedef {import("gpui-kit").Context} Context */
/** @typedef {import("./naming.js").AgentTab} AgentTab */

// Shared (persisted) state, so on/off and the names this mod set survive restarts
// and every copy of the button agrees.
const ENABLED = "herdr-tab-namer.enabled";
const OWNED = "herdr-tab-namer.owned";

// Mod timers keep running while hidden, so the reconcile tick stays gentle. Herdr's
// live data re-renders the count on its own; only renaming waits for the tick.
const TICK_MS = 4000;
const BACKLOG_MS = 15000;

/** The Firstmate home from the layout's props (`firstmate_home`), with `~` expanded. */
function firstmateHome() {
  const value = props()?.firstmate_home;
  if (typeof value !== "string" || !value.trim()) return null;
  const path = value.trim().replace(/\/+$/, "");
  if (!path) return null;
  return path === "~" || path.startsWith("~/") ? home() + path.slice(1) : path;
}

/**
 * Resolves Firstmate's `firstmate.home` tag for `homeDir`, matching
 * `bin/fm-backend-hometag-lib.sh`. Returns null when `homeDir` cannot be verified.
 * @param {string} homeDir
 * @returns {Promise<string | null>}
 */
async function resolveHomeId(homeDir) {
  let root;
  try {
    const res = await exec("pwd", ["-P"], { cwd: homeDir });
    if (res.code !== 0) return null;
    root = res.stdout.trim();
  } catch {
    return null;
  }
  if (!root) return null;
  let marker = null;
  try {
    marker = await readTextFile(`${homeDir}/.fm-secondmate-home`);
  } catch { /* absent or unreadable -> primary home prefix */ }
  const hash8 = String(createHash("sha256").update(root).digest("hex")).slice(0, 8);
  return formatHomeTag(marker, hash8);
}

function currentAgentTabs() {
  // Herdr types a terminal as an open record; every one carries the `address` Terminal needs.
  const list = /** @type {import("./naming.js").Terminal[]} */ (/** @type {unknown} */ (terminals()));
  return agentTabs(spaces(), panes(), list);
}

export default class TabNamer extends View {
  /**
   * @param {unknown} _props
   * @param {Context} cx
   */
  init(_props, cx) {
    /** @type {Record<string, import("./naming.js").Sent>} */
    this.pending = {};
    /** @type {import("./naming.js").Tasks} */
    this.tasks = new Map();
    /** @type {string | null} */
    this.homeDir = null;
    /** @type {string | null} */
    this.homeId = null;
    this.backlogAt = 0;
    this.loading = false;
    // `herdr-app check` runs init() for real: no timer, file read or tab.rename there.
    if (checking()) return;
    cx.timer.every(TICK_MS, (cx) => this.tick(cx, false));
    this.tick(cx, false);
  }

  /** Absent means on: a fresh install starts naming with the window. */
  enabled() {
    return shared(ENABLED) !== false;
  }

  /**
   * @param {Context} cx
   * @param {boolean} force a click, which also means on (its setShared may not read back yet)
   */
  tick(cx, force) {
    if (!force && !this.enabled()) return;
    const tabs = currentAgentTabs();
    const homeDir = firstmateHome();
    if (homeDir !== this.homeDir) {
      this.homeDir = homeDir;
      this.homeId = null;
      this.tasks = new Map();
      this.backlogAt = 0;
    }
    const taskLabels = tabs.map((t) => t.terminal?.labels).filter((l) => l?.[FIRSTMATE_TASK]);
    if (homeDir && taskLabels.length) {
      const age = Date.now() - this.backlogAt;
      const unknown = !this.homeId || taskLabels.some((l) =>
        l[FIRSTMATE_HOME] === this.homeId && !this.tasks.has(taskId(l[FIRSTMATE_TASK]))
      );
      if (force || age > BACKLOG_MS || (unknown && age > TICK_MS)) this.loadBacklog(cx, homeDir);
    }
    this.apply(tabs, force);
  }

  /**
   * @param {Context} cx
   * @param {string} homeDir
   */
  loadBacklog(cx, homeDir) {
    if (this.loading) return;
    this.loading = true;
    this.backlogAt = Date.now();
    cx.spawn(async (cx) => {
      try {
        const [homeId, text] = await Promise.all([
          resolveHomeId(homeDir),
          readTextFile(`${homeDir}/data/backlog.md`).catch(/** @returns {string | null} */ () => null),
        ]);
        if (this.homeDir !== homeDir) return;
        this.homeId = homeId;
        // Known tasks are kept: one that leaves the backlog keeps its name while its terminal
        // lives, and a missing or unreadable backlog changes nothing.
        const parsed = parseBacklog(text);
        if (parsed) this.tasks = new Map([...this.tasks, ...parsed]);
        if (this.enabled()) this.apply(currentAgentTabs(), false);
        cx.notify();
      } finally {
        this.loading = false;
      }
    });
  }

  /**
   * @param {AgentTab[]} tabs
   * @param {boolean} force
   */
  apply(tabs, force) {
    const owned = /** @type {Record<string, import("./naming.js").Owned>} */ (shared(OWNED) ?? {});
    const tabIds = new Set(spaces().flatMap((s) => s.tabs.map((t) => t.id)));
    const next = reconcile(tabs, {
      owned,
      pending: this.pending,
      tasks: this.tasks,
      homeId: this.homeId,
      now: Date.now(),
      tabIds,
      force,
    });
    for (const r of next.renames) run("tab.rename", { id: r.id, name: r.name });
    this.pending = next.pending;
    if (JSON.stringify(next.owned) !== JSON.stringify(owned)) setShared(OWNED, next.owned);
  }

  render() {
    const t = /** @type {Record<string, import("gpui-kit").Color>} */ (theme());
    const on = this.enabled();
    const { named, total } = countNamed(currentAgentTabs());
    const tip = on
      ? `Tab namer is on: ${named} of ${total} agent tabs named. Click to re-apply names, right-click to turn it off.`
      : "Tab namer is off: agent tabs keep their numbers. Click to turn it on.";
    // On: a calm button with a filled dot in the theme's "done" color. Off: the theme's
    // "blocked" color on the border, text and a hollow dot, so it asks to be turned on.
    const tint = on ? t.done : t.blocked;
    const button = h_flex().id("tab-namer").h(26).px(9).gap(6).flex_none().items_center().rounded(6)
      .text_size(12).border(1).border_color(on ? t.border : t.blocked)
      .bg(on ? t.raised : t.chrome).text_color(on ? t.foreground : t.blocked)
      .hover((s) => s.bg(t.hover))
      .tooltip(tip)
      .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
      .on_mouse_down("right", (_e, cx) => {
        cx.stop_propagation();
        setShared(ENABLED, !on);
        cx.notify();
      })
      .on_click((_e, cx) => {
        if (!on) setShared(ENABLED, true);
        this.tick(cx, true);
        cx.notify();
      })
      .child(div().size(7).flex_none().rounded(4).when(on, (d) => d.bg(tint)).when(!on, (d) => d.border(1).border_color(tint)))
      .child(div().child(`Tabs ${named}/${total}`));
    return h_flex().id("root").size_full().px(6).items_center().justify_center()
      .bg(t.chrome).border_b(1).border_color(t.border)
      .child(button);
  }
}
