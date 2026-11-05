import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_NAME, PENDING_MS, agentTabs, cleanTitle, countNamed, firstmateName, generalName,
  parseBacklog, reconcile, stripProject, truncate,
} from "../mods/herdr-tab-namer/naming.js";

const claude = { key: "claude", name: "Claude Code", agent: true, shell: false };
const zsh = { key: "shell", name: "zsh", agent: false, shell: true };

// Fictional rows shaped like Firstmate's data/backlog.md.
const backlog = [
  "# Backlog",
  "",
  "## In flight",
  "- [ ] tab-namer - herdr-tab-namer: 에이전트 탭에 작업 이름 자동 부여(범용, 우선), 상단 버튼 (repo: herdr-tab-namer) (kind: ship) (priority: 2) (since 2026-11-04)",
  "  A body line: (repo: not-this) - [ ] fake - ignored",
  "- [ ] shop-0405 - shop 04-05(신) 결제 승인 계약 PR-S1: 승인 endpoint·상태기계·OTP 경로 제거(GSD 04-05) blocked-by: shop-replan blocked-by: shop-cleanup (repo: shop) (kind: ship) (priority: 0) (since 2026-11-04)",
  "- [ ] shop-audit - shop 기반 점검 결함 8건 수정 data/audit-shop/report.md (repo: shop) (kind: ship) (priority: 1) (since 2026-11-04)",
  "## Queued",
  "- [ ] own-work - Tidy the notes · weekly (repo: -) (kind: ship)",
  "- [ ] waits - Ship the app https://example.com/x blocked-by: own-work - needs notes first (repo: app)",
  "## Done",
  "- [x] old-one - app: Old thing (repo: app) (merged 2026-10-01)",
  "- **bold-id** - Bold row title (repo: app)",
].join("\n");

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

test("parseBacklog reads every row's project and title like Firstmate's snapshot", () => {
  const tasks = parseBacklog(backlog);
  assert.deepEqual(tasks.get("tab-namer"), { project: "herdr-tab-namer", title: "에이전트 탭에 작업 이름 자동 부여(범용, 우선), 상단 버튼" });
  assert.deepEqual(tasks.get("shop-0405"), { project: "shop", title: "04-05(신) 결제 승인 계약 PR-S1: 승인 endpoint·상태기계·OTP 경로 제거(GSD 04-05)" });
  assert.deepEqual(tasks.get("shop-audit"), { project: "shop", title: "기반 점검 결함 8건 수정" });
  assert.deepEqual(tasks.get("own-work"), { project: "", title: "Tidy the notes · weekly" });
  assert.deepEqual(tasks.get("waits"), { project: "app", title: "Ship the app" });
  assert.deepEqual(tasks.get("old-one"), { project: "app", title: "Old thing" });
  assert.deepEqual(tasks.get("bold-id"), { project: "app", title: "Bold row title" });
  assert.equal(tasks.has("fake"), false, "body lines are not rows");
  assert.equal(tasks.size, 7);
  assert.equal(parseBacklog(null), null);
  assert.equal(parseBacklog("").size, 0);
});

test("stripProject drops the project in front, with a colon or a space", () => {
  assert.equal(stripProject("shop: fix login", "shop"), "fix login");
  assert.equal(stripProject("shop fix login", "shop"), "fix login");
  assert.equal(stripProject("shopping list", "shop"), "shopping list");
  assert.equal(stripProject("shop", "shop"), "shop");
  assert.equal(stripProject("shop fix", ""), "shop fix");
});

test("firstmateName gives <project> · <task title>, null when the home doesn't know it", () => {
  const tasks = parseBacklog(backlog);
  assert.equal(firstmateName("fm-shop-audit", tasks), "shop · 기반 점검 결함 8건 수정");
  assert.equal(firstmateName("fm-own-work", tasks), "Tidy the notes · weekly");
  const long = firstmateName("fm-shop-0405", tasks);
  assert.ok(long.startsWith("shop · 04-05(신) 결제 승인 계약 PR-S1:"));
  assert.equal(Array.from(long).length, MAX_NAME);
  assert.equal(firstmateName("fm-unknown-task", tasks), null);
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

test("generalName never uses a bare terminal address", () => {
  assert.equal(generalName({ address: "t1j", name: "t1j", title: "t1j" }, { program: claude }), null);
  assert.equal(generalName({ address: "t1j", title: "t1j" }, { terminal: "t1j", program: claude }), null);
  assert.equal(generalName(null, { terminal: "vps/t7", title: "vps/t7", program: claude }), null);
  assert.equal(generalName({ address: "t2", title: "t1k" }, { program: claude }), null);
  assert.equal(generalName({ address: "t1j", title: "test the parser" }, { program: claude }), "test the parser");
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
    { address: "t6", labels: { "firstmate.task": "fm-own-work" }, title: "Other" },
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
  const tasks = parseBacklog(backlog);
  const tabs = agentTabs(spaces, panes, terminals);
  const out = reconcile(tabs, { tasks, now: 1000 });
  assert.deepEqual(out.renames, [
    { id: "a", name: firstmateName("fm-tab-namer", tasks) },
    { id: "d", name: "Tidy the notes · weekly" },
  ]);
  assert.deepEqual(Object.keys(out.pending).sort(), ["a", "d"]);
  assert.deepEqual(out.owned, { a: firstmateName("fm-tab-namer", tasks), d: "Tidy the notes · weekly" });
});

test("reconcile waits for a sent rename, then owns it once it shows", () => {
  const tasks = parseBacklog(backlog);
  const tab = (name, named) => ({ id: "a", name, named, terminal: { labels: { "firstmate.task": "fm-tab-namer" } }, pane: {} });
  const want = firstmateName("fm-tab-namer", tasks);
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

test("a click keeps a landed rename owned and resends one still pending", () => {
  const tab = (name, named) => ({ id: "a", name, named, terminal: { labels: { "firstmate.task": "fm-new-task" } }, pane: {} });
  const sent = reconcile([tab("1", false)], { now: 0 });
  const clicked = reconcile([tab("new-task", true)], { pending: sent.pending, now: 2000, force: true });
  assert.deepEqual(clicked.owned, { a: "new-task" }, "a rename that landed is still this mod's own");
  const tasks = new Map([["new-task", { project: "app", title: "New task" }]]);
  const later = reconcile([tab("new-task", true)], { owned: clicked.owned, pending: clicked.pending, tasks, now: 6000 });
  assert.deepEqual(later.renames, [{ id: "a", name: "app · New task" }], "the id still gives way once the title is known");
  const resent = reconcile([tab("1", false)], { pending: sent.pending, now: 2000, force: true });
  assert.deepEqual(resent.renames, [{ id: "a", name: "new-task" }], "a click resends a rename that hasn't shown yet");
  assert.deepEqual(resent.pending, { a: { name: "new-task", at: 2000 } });
});

test("a rename is owned as it is sent, so a restart before the next tick keeps it", () => {
  const tab = (name, named) => ({ id: "a", name, named, terminal: { labels: { "firstmate.task": "fm-new-task" } }, pane: {} });
  const sent = reconcile([tab("1", false)], { now: 0 });
  assert.deepEqual(sent.owned, { a: "new-task" });
  const tasks = new Map([["new-task", { project: "app", title: "New task" }]]);
  const restarted = reconcile([tab("new-task", true)], { owned: sent.owned, tasks, now: 4000 });
  assert.deepEqual(restarted.renames, [{ id: "a", name: "app · New task" }], "the id still gives way after a restart");
  assert.deepEqual(restarted.owned, { a: { name: "app · New task", prev: "new-task" } });
  const person = reconcile([tab("Mine", true)], { owned: sent.owned, tasks, now: 4000 });
  assert.deepEqual(person.renames, [], "a name other than the one sent is a person's");
  assert.deepEqual(person.owned, {});
});

test("a tab still showing the name a rename replaces stays the mod's", () => {
  const tab = (name, title) => ({ id: "a", name, named: true, terminal: { title }, pane: { program: claude } });
  const sent = reconcile([tab("Old task", "New task")], { owned: { a: "Old task" }, now: 0 });
  assert.deepEqual(sent.renames, [{ id: "a", name: "New task" }]);
  assert.deepEqual(sent.owned, { a: { name: "New task", prev: "Old task" } });
  const lost = reconcile([tab("Old task", "New task")], { owned: sent.owned, pending: sent.pending, now: PENDING_MS + 1 });
  assert.deepEqual(lost.renames, [{ id: "a", name: "New task" }], "a re-rename that never showed is sent again");
  assert.deepEqual(lost.owned, { a: { name: "New task", prev: "Old task" } });
  const restarted = reconcile([tab("Old task", "New task")], { owned: sent.owned, now: 1000 });
  assert.deepEqual(restarted.renames, [{ id: "a", name: "New task" }], "a restart before it shows keeps the tab");
  const landed = reconcile([tab("New task", "New task")], { owned: sent.owned, now: 1000 });
  assert.deepEqual(landed.owned, { a: "New task" }, "the replaced name is dropped once the new one shows");
  const person = reconcile([tab("Mine", "New task")], { owned: sent.owned, now: 1000 });
  assert.deepEqual(person.renames, []);
  assert.deepEqual(person.owned, {}, "any other name is a person's");
  const after = reconcile([tab("Old task", "New task")], { owned: landed.owned, now: 2000 });
  assert.deepEqual(after.owned, {}, "the replaced name is a person's once the new one has shown");
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

test("a task the home doesn't know is named by its id, but never over a better name", () => {
  const tab = (name, named) => ({ id: "a", name, named, terminal: { labels: { "firstmate.task": "fm-new-task" } }, pane: {} });
  const fresh = reconcile([tab("1", false)], { now: 0 });
  assert.deepEqual(fresh.renames, [{ id: "a", name: "new-task" }]);
  const kept = reconcile([tab("app · New task", true)], { owned: { a: "app · New task" }, now: 0 });
  assert.deepEqual(kept.renames, [], "an unreadable backlog keeps the name");
  assert.deepEqual(kept.owned, { a: "app · New task" });
  const tasks = new Map([["new-task", { project: "app", title: "New task" }]]);
  const upgraded = reconcile([tab("new-task", true)], { owned: { a: "new-task" }, tasks, now: 0 });
  assert.deepEqual(upgraded.renames, [{ id: "a", name: "app · New task" }], "the id gives way once the title is known");
});
