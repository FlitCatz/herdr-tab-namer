import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { spaces, panes, terminals, theme, run, shared, setShared, props, readTextFile, home } from "herdr";
import { FIRSTMATE_TASK, agentTabs, countNamed, parseBacklog, reconcile, taskId } from "./naming.js";

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
  return path === "~" || path.startsWith("~/") ? home() + path.slice(1) : path;
}

function currentAgentTabs() {
  return agentTabs(spaces(), panes(), terminals());
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
    this.backlogAt = 0;
    this.loading = false;
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
    const labels = tabs.map((t) => t.terminal?.labels?.[FIRSTMATE_TASK]).filter(Boolean);
    if (homeDir && labels.length) {
      const age = Date.now() - this.backlogAt;
      const unknown = labels.some((label) => !this.tasks.has(taskId(label)));
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
      /** @type {string | null} */
      let text = null;
      try { text = await readTextFile(`${homeDir}/data/backlog.md`); } catch { /* unreadable: keep what we know */ }
      this.loading = false;
      // Known tasks are kept: one that leaves the backlog keeps its name while its terminal
      // lives, and a missing or unreadable backlog changes nothing.
      const parsed = parseBacklog(text);
      if (parsed) this.tasks = new Map([...this.tasks, ...parsed]);
      if (this.enabled()) this.apply(currentAgentTabs(), false);
      cx.notify();
    });
  }

  /**
   * @param {AgentTab[]} tabs
   * @param {boolean} force
   */
  apply(tabs, force) {
    const owned = /** @type {Record<string, string>} */ (shared(OWNED) ?? {});
    const tabIds = new Set(spaces().flatMap((s) => s.tabs.map((t) => t.id)));
    const next = reconcile(tabs, { owned, pending: this.pending, tasks: this.tasks, now: Date.now(), tabIds, force });
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
