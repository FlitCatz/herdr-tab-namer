# Tab namer

A small button at the right end of the window's top bar that names agent tabs after the
work they run. Tabs that showed `1`, `2`, `3` read `my-app · fix login`, `Refactor auth`;
the button says how many agent tabs carry a name (`Tabs 3/3`), and its color says whether
the namer is on, so when it's off you see it and turn it on.

![Tab namer](preview.png)

## What you see

- One block, 112 px wide, as tall as the top bar (30 px in Herdr's `main`, 42 px in
  taller bars), to the right of the tab bar. Background `chrome`, a 1 px `border` line at
  the bottom so the bar's line runs through, 6 px side padding, the button centered.
- The button: 26 px tall, 9 px side padding, radius 6, 1 px border, 12 px UI text, a 7 px
  round dot, 6 px gap, then `Tabs n/m` (`n` agent tabs with a name, `m` agent tabs, across
  every space).
  - On: background `raised`, border `border`, text `foreground`, dot filled in `done`.
  - Off: background `chrome`, border and text `blocked`, dot hollow with a `blocked` ring.
- Hover: background `hover`. A tooltip after half a second:
  - On: `Tab namer is on: n of m agent tabs named. Click to re-apply names, right-click to turn it off.`
  - Off: `Tab namer is off: agent tabs keep their numbers. Click to turn it on.`

## How it behaves

- Agent status (working, blocked, done, idle) doesn't change the button; any status makes
  a terminal an agent. An agent tab is a tab with a terminal pane whose program reports a
  status (`panes()[i].status`), is an agent in Herdr's program table (`program.agent`), or
  carries a `firstmate.task` label. Tabs with only shells don't count and aren't named.
- Every 4 s while on, each unnamed agent tab gets a name with `tab.rename {id, name}`.
  The name comes from the tab's Firstmate terminal if it has one, else its first agent:
  1. `firstmate.task=fm-<id>` label: `<project> · <task title>` from the row
     `- [ ] <id> - <title> ... (repo: <project>) (kind: ...) ...` (or `- [x]`, or
     `- **<id>** - ...`) in `<firstmate_home>/data/backlog.md`, any section. The title is
     the rest of the row without links, `blocked-by: <id>` notes (and a `- reason` after
     one), the trailing `(repo|kind|priority|hold...: ...)` / `(since|merged|reported|done
     ...)` groups, and a trailing `data/.../report.md` or `local main`, as Firstmate's
     `bin/fm-fleet-snapshot.sh` reads it. `(repo: -)` means no project. A leading
     `<project>:` or `<project> ` is removed from the title. No home configured, or the
     task isn't listed: the task id (`<id>`), which never replaces a name the mod already
     gave. The backlog is read at most every 15 s, sooner (4 s) when a task id it doesn't
     know appears; tasks it knew are kept after they leave it.
  2. The terminal's `name` (from `terminals()`).
  3. The terminal's `title`, else the pane's, leading non-letter glyphs (spinners, `✳`)
     removed. Skipped when it equals the program's name or key, is a version
     (`2.1.318`), starts with `/` or `~`, or is a terminal address (`t1j`, `vps/t7`;
     Herdr shows the address for a terminal with an empty title). The `name` is skipped
     when it is an address too.
  Names are cut to 40 characters (code points), whitespace collapsed, ending in `…`.
- The names the mod set are remembered per tab id. A tab showing one of them is the mod's:
  if its source changes (a new title), the tab is renamed to follow. A tab showing any
  other name was named by a person and is never renamed; the mod forgets it.
  A tab renamed back to its number (`""`) is unnamed again and gets named again.
- A name never gets worse. When a tab's source has nothing to say any more (its title
  turns generic or empty), the tab keeps the name it has. A bare task id (the fallback
  for a task the backlog doesn't list, or a backlog that can't be read) only names a tab
  that has no name; once the task's title is known, the id gives way to it.
- A rename the app hasn't shown yet is waited for up to 5 s before it's sent again, so
  a slow rename is neither sent every tick nor taken for a person's name.
- Click while on: renames now (pending renames are resent, the backlog is re-read).
  Click while off: turns it on and renames now. Right-click: turns it off (or on).
  Off stops renaming; names already given stay.
- Presses on the button don't drag the window (`stop_propagation` on mouse down).

## Built from

- Layout: the top bar block becomes a `row` (the bar's own `size`, `resizable: false`)
  holding the tab bar block and `{ "id": "tab-namer", "type": "block", "size": { "px": 112 },
  "window_drag": true, "content": { "mod": "herdr-tab-namer", "props": { "firstmate_home": "~/firstmate" } } }`.
  `firstmate_home` is optional; `~` expands with `home()`.
- `mods/herdr-tab-namer/`: `mod.json` (`{ "place": "none", "title": "Tab namer" }`),
  `main.js` (the view: timer, backlog read, button), `naming.js` (pure naming rules,
  no imports), `jsconfig.json` (`checkJs`, as Herdr writes it).
- `herdr`: `spaces()` (tab `id`, `name`, `named`), `panes()` (`tab`, `terminal`, `status`,
  `program`, `title`), `terminals()` (`address`, `labels`, `name`, `title`), `theme()`,
  `props()`, `home()`, `readTextFile()`, `shared()` / `setShared()` (keys
  `herdr-tab-namer.enabled`, absent means on, and `herdr-tab-namer.owned`, tab id to the
  name the mod set), `run("tab.rename", { id, name })`.
- gpui-kit: `cx.timer.every(4000, ...)`, `cx.spawn`, `.tooltip()`, `h_flex` from gpui-base.
- No programs run, no network. It reads one file outside its folder: the Firstmate
  backlog, only when `firstmate_home` is set.

## Watch out

- Tab names live in each machine's core document, so every Herdr window on that machine
  shows them, and a second window running this mod names the same tabs (the same names).
- `herdr-app check` builds the view in a hidden window with no tabs: it proves the mod
  loads, not that it names anything.
- `theme()` is typed `Record<string, string>` but the color setters want `#rrggbb`: cast
  it once (`import("gpui-kit").Color`) or `tsc` reports every color.
- Ownership is pruned when a tab id disappears from `spaces()`. A remote machine that is
  briefly unavailable drops its tabs, so the mod forgets those names: they stay, but
  become a person's names and stop following their source.
- Don't take titles from Firstmate's `state/home-summary.json`: its `active_children`
  lists only the tasks it counts as active at that moment, so other live task tabs fall
  back to bare ids. The backlog has every task.
- `Tabs n/m` counts agent tabs in every space, not just the shown one, while the tab bar
  shows only the shown space's tabs: a bar with three named tabs can read `Tabs 6/7` (the
  preview does), because other spaces hold more agent tabs and one is unnamed.
- Two copies pointed at different homes (a second layout, a demo) don't undo each other:
  to each, the other's tasks are unknown, and an unknown task's id never replaces a name.
- On Windows and Linux the tab bar draws the window buttons at its right end, so the
  button sits right of the close button; put the block before the tab bar if that bothers.
- Herdr has no command to move a tab to another space, so the mod only names tabs.

## Done when

- `herdr-app check mods/herdr-tab-namer` passes, and `node --test` passes the naming rules.
- With the block in the top bar and an unnamed tab running Claude Code on a task, within
  4 s the tab shows the agent's title and the button reads `Tabs 1/1` with a `done` dot.
- A terminal started with `--label firstmate.task=fm-<id>` gets `<project> · <title>` when
  `firstmate_home` points at a home whose backlog lists `<id>`, else `<id>`.
- A task whose backlog title starts with its project (`shop: x` or `shop x`, repo `shop`)
  shows `shop · x`, not `shop · shop x`.
- A tab whose agent terminal has no title stays unnamed rather than showing `t1j`.
- With the backlog renamed away, task tabs already named `<project> · <title>` keep their
  names; a new task tab gets its id, and the full name once the backlog is back.
- A tab renamed by hand keeps its name across ticks and restarts.
- Right-click turns the button `blocked`-colored with a hollow dot and stops renaming; a
  click turns it back on. The state is the same after restarting Herdr.
- A tab with only a shell is never renamed and isn't counted.
