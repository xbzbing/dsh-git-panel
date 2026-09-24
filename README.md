# dsh-git-panel

An IDE-style Git panel plugin for the [DeepSeek Harness](https://github.com/deepseek-ai) (dsh) Web GUI.

It adds a resident **Git** panel tab to the conversation workspace (beside Chat and Trajectory) and a zsh-style branch marker to the input bar.

## Features

### Git panel (a `conversation.view` tab)

Two internal sub-tabs:

- **Overview** — IDE-style three columns:
  - left: branch / tag list (click to filter history);
  - middle: commit history graph with search by message, commit hash, author, or date;
  - right: the selected commit's changed-file tree and full message (comment).
- **Changes** — the local working tree:
  - left: a statistics bar (file count / added·deleted lines / last-change time), the uncommitted change list with per-file checkboxes, and a commit box with an **Amend** checkbox and Commit action;
  - right: the selected file's side-by-side diff (split / before / after).

### Input-bar Git marker

A zsh-theme style pill: `<repo> git:(<branch>)`.

- **green** branch — everything committed (in sync);
- **orange** branch — uncommitted changes present;
- hover shows the full repository path;
- click jumps to the Git panel — to **Changes** when there are uncommitted changes, otherwise to **Overview**.

Bilingual: English and 简体中文, following the harness locale.

## Architecture

Two halves communicating over the typert Remote gateway:

- **Host** (`lib/host/`) — a Cordis + typert `GitPanelService` on the `gitPanel` namespace, exposing `snapshot` / `run` / `query`. Git runs through the host `subprocess` service (argv arrays, no shell, cwd locked to the repository root, per-command timeout and output caps).
- **Client** (`lib/client.js`) — a React bundle registering the `conversation.view` panel and the `conversation.input.left` pill; a per-session snapshot controller (polling + turn-completion refresh) feeds the pill, the changes page, and the stats bar from one snapshot.

## Build

```bash
node build.mjs      # tsc (host d.ts) + esbuild (host bundle + client bundle)
npx tsc --noEmit    # type check
```

The host bundle is never minified — the typert gateway reflects method parameter names for argument validation.

## Install (local development)

Add the package to a dsh web profile's `dsh.profile.bundles` and depend on it (a `file:` path or a symlink into the profile's `node_modules`), then rebuild the client bundle and refresh the Web GUI.

## License

MIT
