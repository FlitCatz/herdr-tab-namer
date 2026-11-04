import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_NAME, PENDING_MS, agentTabs, cleanTitle, countNamed, firstmateName, generalName,
  parseFirstmateTasks, reconcile, truncate,
} from "../mods/herdr-tab-namer/naming.js";

const claude = { key: "claude", name: "Claude Code", agent: true, shell: false };
const zsh = { key: "shell", name: "zsh", agent: false, shell: true };

const summary = JSON.stringify({
  active_children: [
    { id: "tab-namer", repo: "herdr-tab-namer", name: "herdr-tab-namer: name agent tabs" },
    { id: "no-repo", name: "Audit the login flow" },
    { id: "bad" },
    "junk",
  ],
});

test("truncate keeps short names, cuts long ones by characters with an ellipsis", () => {
  assert.equal(truncate("  fix   login  "), "fix login");
  const long = "에이전트 탭에 작업 이름 자동 부여(범용, firstmate 작업 표시 우선), 상단 버튼";
  const cut = truncate(long);
  assert.equal(Array.from(cut).length, MAX_NAME);
  assert.ok(cut.endsWith("…"));
  assert.equal(truncate("abcdef", 4), "abc…");
});

test("cleanTitle drops spinner and status glyphs in front", () => {
  assert.equal(cleanTitle("⠼ Prepare v1 launch brief | herdr-firstmate"), "Prepare v1 launch brief | herdr-firstmate");
  assert.equal(cleanTitle("✳  Fix the login bug"), "Fix the login bug");
  assert.equal(cleanTitle("(draft) notes"), "(draft) notes");
});

test("parseFirstmateTasks reads project and title, stripping the project prefix", () => {
  const tasks = parseFirstmateTasks(summary);
  assert.deepEqual(tasks.get("tab-namer"), { project: "herdr-tab-namer", title: "name agent tabs" });
  assert.deepEqual(tasks.get("no-repo"), { project: "", title: "Audit the login flow" });
  assert.deepEqual(tasks.get("bad"), { project: "", title: "bad" });
  assert.equal(tasks.size, 3);
  assert.equal(parseFirstmateTasks("{not json"), null);
  assert.equal(parseFirstmateTasks(null), null);
  assert.equal(parseFirstmateTasks("{}").size, 0);
});

test("firstmateName gives <project> · <task title>, else the task id", () => {
  const tasks = parseFirstmateTasks(summary);
  assert.equal(firstmateName("fm-tab-namer", tasks), "herdr-tab-namer · name agent tabs");
  assert.equal(firstmateName("fm-no-repo", tasks), "Audit the login flow");
  assert.equal(firstmateName("fm-unknown-task", tasks), "unknown-task");
  assert.equal(firstmateName("fm-tab-namer", new Map()), "tab-namer");
});

test("generalName prefers the terminal name, then a meaningful title", () => {
  assert.equal(generalName({ name: "reviewer", title: "Something" }, { program: claude }), "reviewer");
  assert.equal(generalName({ name: null, title: "✳ Fix the login bug" }, { program: claude }), "Fix the login bug");
  assert.equal(generalName(null, { title: "Fix the login bug", program: claude }), "Fix the login bug");
  assert.equal(generalName({ title: "✳ Claude Code" }, { program: claude }), null);
  assert.equal(generalName({ title: "2.1.318" }, { program: claude }), null);
  assert.equal(generalName({ title: "~/src/app" }, { program: claude }), null);
  assert.equal(generalName({ title: "" }, { program: claude }), null);
});

function world() {
  const spaces = [
    { id: "s1", tabs: [
      { id: "a", name: "1", named: false },
      { id: "b", name: "2", named: false },
      { id: "c", name: "my work", named: true },
      { id: "d", name: "4", named: false },
    ] },
  ];
  const panes = [
    { pane: "p1", tab: "a", terminal: "t1", status: "working", program: claude, title: "✳ Claude Code" },
    { pane: "p2", tab: "a", terminal: "t2", status: null, program: zsh, title: "zsh" },
    { pane: "p3", tab: "b", terminal: "t3", status: null, program: zsh, title: "zsh" },
    { pane: "p4", tab: "c", terminal: "t4", status: "idle", program: claude, title: "Refactor auth" },
    { pane: "p5", tab: "d", terminal: "t5", status: "idle", program: claude, title: "zsh" },
    { pane: "p6", tab: "d", terminal: "t6", status: "working", program: claude, title: "Other" },
  ];
  const terminals = [
    { address: "t1", labels: { "firstmate.task": "fm-tab-namer" }, title: "✳ Claude Code" },
    { address: "t3", labels: {}, title: "zsh" },
    { address: "t4", labels: {}, title: "Refactor auth" },
    { address: "t5", labels: {}, title: "Plan the release" },
    { address: "t6", labels: { "firstmate.task": "fm-no-repo" }, title: "Other" },
  ];
  return { spaces, panes, terminals };
}

test("agentTabs keeps tabs running an agent and prefers the Firstmate terminal", () => {
  const { spaces, panes, terminals } = world();
  const tabs = agentTabs(spaces, panes, terminals);
  assert.deepEqual(tabs.map((t) => t.id), ["a", "c", "d"]);
  assert.equal(tabs[0].terminal.address, "t1");
  assert.equal(tabs[2].terminal.address, "t6");
  assert.deepEqual(countNamed(tabs), { named: 1, total: 3 });
});

test("a terminal with a Firstmate label counts before it reports a status", () => {
  const spaces = [{ id: "s", tabs: [{ id: "x", name: "1", named: false }] }];
  const panes = [{ pane: "p", tab: "x", terminal: "t9", status: null, program: zsh, title: "zsh" }];
  const terminals = [{ address: "t9", labels: { "firstmate.task": "fm-late" } }];
  assert.equal(agentTabs(spaces, panes, terminals).length, 1);
});

test("reconcile names unnamed agent tabs and never touches a person's name", () => {
  const { spaces, panes, terminals } = world();
  const tasks = parseFirstmateTasks(summary);
  const tabs = agentTabs(spaces, panes, terminals);
  const out = reconcile(tabs, { tasks, now: 1000 });
  assert.deepEqual(out.renames, [
    { id: "a", name: "herdr-tab-namer · name agent tabs" },
    { id: "d", name: "Audit the login flow" },
  ]);
  assert.deepEqual(Object.keys(out.pending).sort(), ["a", "d"]);
  assert.deepEqual(out.owned, {});
});

test("reconcile waits for a sent rename, then owns it once it shows", () => {
  const tasks = parseFirstmateTasks(summary);
  const tab = (name, named) => ({ id: "a", name, named, terminal: { labels: { "firstmate.task": "fm-tab-namer" } }, pane: {} });
  const want = "herdr-tab-namer · name agent tabs";
  const first = reconcile([tab("1", false)], { tasks, now: 0 });
  assert.equal(first.renames.length, 1);
  const waiting = reconcile([tab("1", false)], { tasks, now: 1000, pending: first.pending });
  assert.equal(waiting.renames.length, 0);
  const landed = reconcile([tab(want, true)], { tasks, now: 2000, pending: waiting.pending });
  assert.deepEqual(landed.owned, { a: want });
  assert.deepEqual(landed.pending, {});
  assert.equal(landed.renames.length, 0);
  const lost = reconcile([tab("1", false)], { tasks, now: PENDING_MS + 1, pending: first.pending });
  assert.equal(lost.renames.length, 1, "a rename that never showed is sent again");
});

test("reconcile updates its own names and lets go of names a person changed", () => {
  const tab = (name, title) => ({ id: "a", name, named: true, terminal: { title }, pane: { program: claude } });
  const moved = reconcile([tab("Old task", "New task")], { owned: { a: "Old task" }, now: 0 });
  assert.deepEqual(moved.renames, [{ id: "a", name: "New task" }]);
  const person = reconcile([tab("Mine", "New task")], { owned: { a: "Old task" }, now: 0 });
  assert.deepEqual(person.renames, []);
  assert.deepEqual(person.owned, {});
  const blank = reconcile([tab("Old task", "✳ Claude Code")], { owned: { a: "Old task" }, now: 0 });
  assert.deepEqual(blank.renames, [], "no source keeps the name it has");
  assert.deepEqual(blank.owned, { a: "Old task" });
});

test("reconcile drops ownership of closed tabs only", () => {
  const out = reconcile([], { owned: { a: "x", gone: "y" }, tabIds: new Set(["a"]) });
  assert.deepEqual(out.owned, { a: "x" });
});
