# dsh-git-panel

English | [简体中文](README.md)

`dsh-git-panel` is a Web GUI plugin for the DeepSeek Harness (dsh), modeled on the Git tools found in IDEs. It adds a resident **Git** panel to the conversation workspace (after Chat and Trajectory) and a zsh-style branch marker at the left of the input bar.

## Features

### Git panel (a `conversation.view` tab)

Two sub-tabs:

- **Overview** — three columns:
  - left: branch / tag list; clicking one filters history by that ref;
  - middle: the commit history graph, searchable by commit message, commit hash, author, or date;
  - right: the selected commit's changed-file tree and full commit message. Click a file to see its diff within that commit in a modal; press Esc to close.
- **Changes** — the local working tree:
  - left: a statistics bar (file count / added·deleted lines / last-change time), the uncommitted change list with per-file checkboxes, and a commit box with an **Amend** checkbox;
  - right: the selected file's side-by-side diff (split / before / after).

The sub-tab row shows the plugin version on the right, next to a "Check for updates" button that only queries GitHub for the latest release when you click it.

### Input-bar Git marker

A zsh-theme marker: `<repo> (<branch>)`.

- the repo name is cyan; `(branch)` is green when the working tree is in sync and orange when there are uncommitted changes;
- hovering opens a rounded tooltip panel with the full repository path;
- clicking jumps to the Git panel — to **Changes** when there are uncommitted changes, otherwise to **Overview**;
- when the current directory is not a Git repository, the marker shows only the directory name, with no error text.

The UI is available in Simplified Chinese and English, following the harness locale.

## Architecture

Two halves communicating over the typert Remote gateway:

- **Host** (`lib/host/`) — a Cordis + typert `GitPanelService` on the `gitPanel` namespace, exposing `snapshot` / `run` / `query` / `version`. Git runs through the host `subprocess` service: argv arrays, no shell, working directory locked to the repository root, per-command timeout and output caps.
- **Client** (`lib/client.js`) — a React bundle that registers the `conversation.view` panel and the `conversation.input.left` marker. One snapshot controller per session (polling plus a refresh after each turn) feeds the marker, the changes page, and the stats bar from a single snapshot.

## Install

### From GitHub (recommended)

The repository commits the built `lib/` tree, so you can install straight from git without a local build:

```bash
dsh plugin add github:xbzbing/dsh-git-panel
```

Restart or refresh the Web GUI afterwards and the Git panel appears.

### From local source

Add the plugin to a dsh web profile's `dsh.profile.bundles`, point a dependency at this directory with a `file:` path, then run `node build.mjs` and refresh the Web GUI.

## Development

```bash
node build.mjs      # tsc (host d.ts) + esbuild (host bundle + client bundle)
npm run typecheck   # type check
npm run test:unit   # pure-algorithm and host-endpoint unit tests (node --test)
npm run test:e2e    # isolated file:// headless-browser e2e (never touches a running instance)
```

The host bundle is not minified: the typert gateway validates arguments by method parameter name, and minification would rename them and break the wire contract. Client changes are not hot-reloaded — rebuild and refresh the page.

## License

MIT
