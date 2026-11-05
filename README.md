# herdr-tab-namer

A [Herdr](https://herdr.dev) mod that names agent tabs after the work they run, so a tab
bar of `1`, `2`, `3` becomes `my-app · fix login`, `Refactor auth`, ... It sits as a small
button in the window's top bar: the button shows how many agent tabs are named
(`Tabs 3/3`), and its color shows whether the namer is on.

![herdr-tab-namer](preview.png)

## What it does

- Every few seconds it looks at tabs that run an agent (a terminal whose program reports a
  status, or one Firstmate labelled) and gives each unnamed one a name with `tab.rename`.
  Tabs with only plain shells are left alone.
- It never overwrites a name a person gave: it remembers which names it set itself, and
  only updates those. Rename a tab by hand and the namer leaves it for good.
- Its own names only get better: a tab keeps its name when the source goes quiet, and a
  bare task id never replaces a name.
- Names are at most 40 characters, cut with `…`.
- **On** (the default): a filled dot in the theme's `done` color. Click to re-apply names now.
  Right-click to turn it off.
- **Off**: border, text and a hollow dot in the theme's `blocked` color. Agent tabs keep
  their numbers. Click to turn it on.
- On/off and the names it set are kept in Herdr's shared state, so they survive restarts.

### Where names come from

For each agent tab, the first source that has something:

1. **Firstmate task.** A terminal carrying the `firstmate.task` label is a Firstmate task.
   When the layout gives the button a `firstmate_home`, the name is
   `<project> · <task title>` from that home's backlog (`data/backlog.md`: the row's
   `(repo: ...)` and title, the same ones Firstmate's Board shows). A title that starts with
   its project (`my-app: ...`, `my-app ...`) loses that prefix, so the project shows once.
   Without a home, or for a task the backlog doesn't list, the name is the task id, and an
   id never replaces a better name the namer already gave.
2. **Terminal name.** The name the terminal was started with (`hc run --name ...`).
3. **Terminal title.** The title the agent set (Claude Code and Codex set one that says what
   they're working on), without leading spinner glyphs. Titles that only name the
   program (`Claude Code`), a version (`2.1.318`), a folder (`~/src`) or a bare terminal
   address (`t1j`, which Herdr shows for a terminal with no title) don't count.

Herdr and herdr-core don't keep an agent's first message, so that can't be a source. A tab
with none of these stays unnamed until one shows up.

## Add it

1. Copy `mods/herdr-tab-namer/` into `~/.config/herdr-app/mods/`.
2. Herdr's own layouts are read-only, so clone the one you use (here `main`):

   ```sh
   herdr-app do layout.clone '{"name":"main","as":"my-main"}'
   ```

3. In `~/.config/herdr-app/layouts/my-main.json`, turn the top bar block (`"id": "tabs"`)
   into a row with the tab bar and the button. Keep the bar's own `size` on the row:

   ```json
   { "id": "top", "type": "row", "size": { "px": 30 }, "resizable": false,
     "children": [
       { "id": "tabs", "type": "block", "content": { "mod": "tabs" }, "window_drag": true },
       { "id": "tab-namer", "type": "block", "size": { "px": 112 }, "window_drag": true,
         "content": { "mod": "herdr-tab-namer", "props": { "firstmate_home": "~/firstmate" } } } ] }
   ```

   Leave out `props` if you don't use Firstmate. `firstmate_home` is the folder that holds
   Firstmate's `state/`; `~` is your home folder.

4. Check it: `herdr-app check ~/.config/herdr-app/mods/herdr-tab-namer`.

The button starts with the window, because it is part of the layout.

## Develop

Plain JavaScript, no build step. `mods/herdr-tab-namer/naming.js` holds the naming rules as
pure functions; `main.js` is the button.

```sh
node --test                                   # naming rules
herdr-app check mods/herdr-tab-namer          # loads the mod; also writes gpui-kit.d.ts
tsc -p mods/herdr-tab-namer/jsconfig.json     # type-check against those types
```
