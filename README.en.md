# dsh-git-panel

English | [简体中文](https://github.com/xbzbing/dsh-git-panel/blob/main/README.md)

![dsh-git-panel](https://cdn.jsdelivr.net/gh/xbzbing/dsh-git-panel@main/docs/assets/banner.png)

`dsh-git-panel` is a DSH Web GUI plugin that brings an IDE-style Git panel into the conversation workspace. It gathers the branch list, commit history graph, uncommitted-change commit & amend, and syntax-highlighted diffs into one resident tab, and puts a zsh-style branch marker at the left of the input bar — so you can check repo status and commit changes mid-conversation without switching to a terminal or a separate IDE.

The panel only reads the Git repository at the current session's working directory: every git command runs through the host subprocess service as an argv array — no shell string concatenation — with the working directory locked to the repository root and per-command timeout and output caps. The plugin leaves your git config alone by default, and every write (commit, amend, stage, discard) has an explicit entry point. The finer boundaries are under "Permissions and data boundaries" below.

## Install

```bash
# Stable release (npm)
dsh plugin --profile web add @xbzbing/dsh-git-panel@latest

# Pre-release (GitHub Release asset; never published to npm)
dsh plugin --profile web add https://github.com/xbzbing/dsh-git-panel/releases/download/<TAG>/xbzbing-dsh-git-panel-<VERSION>.tgz
```

New versions can be installed directly through dsh's plugin update mechanism; for a manual update, uninstall the old version first and then install the new one. Installing a new version directly with `add` may require restarting the dsh instance.

## Features

- **Overview** — branch / tag list, commit history graph and commit details; click a file to see its diff in that commit. The file-diff dialog also offers a read-only **File** view of that version's complete source, and “Copy post-change file content” writes the whole file (strictly below 10 MiB). History offers “message / hash” and “file / path” search, combined with author, date and branch filters. The relative-time column is sized from the active language's own labels; as the panel narrows, rows drop the author first and then the hash.
- **Changes** — stage and discard per file or in batches, commit and **Amend**, stash, added·deleted statistics. The list switches between a flat and a folder-tree view, with folder-level stage and discard; a pick carries the side it was made on, so selecting only the staged row commits what the index already holds. The "Staged changes" and "Changes" headers stay on screen even when empty, showing (0), so whether anything is staged is visible at a glance. The caret right of **Commit** switches this session's action to **Commit and Push** (the pick, Amend and the staged scope are shared with **Commit**; the choice is kept in this tab across a refresh and a hot reload, and a new tab returns to plain commit), and <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>Alt</kbd>+<kbd>K</kbd> always commits and pushes. A failed push never undoes the commit; a branch that is behind or diverged, has no upstream, is detached, is still unborn, or amends a published tip only commits — the reason is read from the state after the commit and shown as a neutral notice above the box, while a rejected push is shown as an error.
- **Common Git actions** — switch, create, merge and delete branches, cherry-pick a commit, create and delete tags, revert / reset. Destructive actions ask for confirmation; a conflicting merge or cherry-pick is aborted and the previous state restored; apart from deleting a remote branch nothing is pushed automatically. When there is no upstream but a remote already has a same-named branch, the sync control offers "Set upstream" (tracking config only, no push, no network) and "Publish" otherwise. The status bar states sync in symbols: `✓` in sync, `↑n` to push, `↓n` to pull, `↓n ↑n` diverged, `HEAD` detached, and a bare `↑` when the branch has no upstream; the full sentence stays in the tooltip and the accessible name. A diverged branch offers one confirmed “Sync”: merge the upstream into the current branch, then push normally (never force; a conflict is aborted).
- **Git Flow** — branch rows support starting, integrating and finishing Feature, Release and Hotfix flows around `develop`, `main` / `master` and the conventional prefixes. Finish previews merge, tag, push and deletion steps before asking for confirmation. See the [Git Flow user guide](docs/git-flow-user-guide.en.md) for usage and [ADR-0037](docs/adr/0037-git-flow-operations.md) for the safety invariants and implementation boundaries.
- **AI commit-message suggestion** — follows the style of the repository's existing commits; the model follows the current session by default and can be pinned on the detail page. **Generation sends your diff content to the provider of the model you picked.**
- **Input-bar Git marker** — a zsh-style `<repo> (<branch>)`, green when in sync and orange with uncommitted changes; a click jumps to the panel, and in a blank conversation it opens the Git page in the right sidebar instead.
- **Multiple repositories** — worktrees and independent repositories in subdirectories are detected automatically, and a worktree of the session's own repository is switchable wherever it lives. Folders a `.code-workspace` file names — usually outside the workspace — can join the same list; see [Multiple repositories and `.code-workspace`](#multiple-repositories-and-code-workspace). The same section caps the list at 10–100 rows (50 by default): more rows make the scan and the picker slower.
- **File browser** — browse the workspace tree and preview code, Markdown (including mermaid diagrams), HTML and images; config and document files can be edited and saved in place; Java/Kotlin projects fold package paths by convention. The source preview supports <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>A</kbd>: a file up to 2000 lines and 1 MiB is fully mounted, so the selection is complete; above that the preview becomes a virtual window, Ctrl/⌘+A covers only the loaded rows and says so, and “Copy file content” remains the way to get the whole file. Reading Markdown, the top-right corner holds nothing but a small "Contents" button; clicking it opens the floating outline: it marks the section you are in as you scroll, jumps to one when picked, and covers the document instead of narrowing it (it paints above the sticky code-block banners that scroll beneath it). It is about 60% of the width the card used to have, so long titles ellipsize. The outline folds back into the button, or closes outright — nothing is left in its corner, and the button comes back when the file is opened again. The fullscreen reader grows with the screen (up to about 1600×1100).
- **Context menus** — right-click files, directories, images, branches, commits, changes, stashes, repository rows and the input-bar marker; destructive actions still ask for confirmation. Requires dsh ≥ 0.2.2-alpha.3; older versions keep the browser's native menu.
- **Diff and source viewing** — unified / split / before / after views with syntax highlighting, word-level emphasis, on-demand context expansion and <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>F</kbd> find-in-place; images can be zoomed, panned and shown fullscreen. The commit file-diff dialog adds a read-only **File** view that reuses the file browser's two rendering tiers: up to 2000 lines and 1 MiB mounts every line, above that it windows; “Copy post-change file content” reads the complete text of that version (strictly below 10 MiB), independent of diff truncation or folded context.
- **Diff line comments** — in any text diff, hovering a line shows a “+” beside its number; click it (or the number) to pick the line and Shift+click to extend it within the same hunk (from the keyboard: Tab into the numbers, arrow keys to move, Enter to pick, Shift+Enter to extend), write a comment and press “Add to input”: the comment goes into the current session's composer as a quote with the repository, file, side, lines, compared source and the picked lines plus three lines of context on each side, and nothing is sent until you send the draft, so several comments travel as one message. The quote matches the “Local changes” tab of dsh 0.2.3's optional “Change requests & worktrees” plugin and numbers on with its comments; with that plugin enabled and the session's own repository selected, the changes diff toolbar also offers “Review in Local changes”. File context menus use the platform's “Add to chat” (dsh ≥ 0.2.3), which inserts an `@file` reference, in place of this plugin's “Reference in the composer”; older hosts keep the latter, and directory rows are unchanged. Design: [ADR-0039](docs/adr/0039-diff-review-quotes.md).
- **Narrow panel / mobile** — the layout adapts to the panel size, so it works in the sidebar and on a phone.
- **Languages** — the UI follows the DSH system language: Simplified Chinese, English, 日本語, Español, Français, Deutsch, Русский and Português; any other language falls back to English.

## Git Flow

Git Flow entries live in the branch list of the Git Overview and are on by default; the "What is Git Flow" dialog can turn them off, and the plugin settings turn them back on. They support starting, integrating and finishing Feature, Release and Hotfix branches using the `develop`, `main` / `master`, `feature/*`, `release/*` and `hotfix/*` conventions. Finish previews the target branch, strategy, tag, push and deletion steps, then asks for confirmation before writing.

The Git Flow user guide includes the core concepts, Mermaid branch diagrams, rendered plugin screenshots and a complete Feature → Release / Hotfix case. Finish push includes the new release or hotfix tag and every long-lived branch moved by the operation. A multi-step failure can return `flow-partial`, so refresh and inspect branches, tags and remote refs before retrying. When a release or hotfix already has its merge, tag and develop back-merge, the host can recognize that state and continue the remaining steps. See the [Git Flow user guide](docs/git-flow-user-guide.en.md) and [ADR-0037](docs/adr/0037-git-flow-operations.md).

## Multiple repositories and `.code-workspace`

The switcher follows the repository of the session's working directory by default, but it can list three kinds at once: every worktree of the session's own repository (wherever it lives), independent repositories in subdirectories of the workspace, and the folders a VS Code `.code-workspace` multi-root workspace file names — the last group usually sits outside the workspace, which is exactly the "hub directory" layout. When the session's live working directory moves between checkouts of its own repository (the platform's `enter_worktree` / `exit_worktree`, or a worktree created elsewhere but certified), the panel follows automatically; unrelated sub-repositories and `.code-workspace` roots are never followed. Following happens only when the directory really changes: a checkout you picked by hand survives a page refresh or hot reload instead of being replaced by the automatic result, while turning the setting from off to on follows the current directory immediately. Following does not ask about an unsaved edit; the draft is kept and labelled with the checkout it belongs to. This follow mode is on by default and can be turned off in the **Repositories** section of the plugin settings.

The selected repository and the file browser's root are remembered per session in the current tab (`sessionStorage`): a page refresh, or the hot reload that installing or removing another plugin triggers, brings the panel back to the same checkout. A blank new tab or a restarted browser still starts on the default repository; a duplicated tab, or one opened from this page, starts from a copy of the picks and keeps its own from then on. The record is deleted only when the host answers definitively that the checkout is gone; git failing to answer for a moment (a worktree listing that timed out, say), or a `.code-workspace` file being edited and not readable right now, falls back to the default repository for this load only, and the next load tries again.

The third kind has to be turned on explicitly: it reads a file on disk, and a workspace file committed to a repository must not take effect just because a session opened. `codeWorkspace` in the **Repositories** section has three states:

- **Off** (default): no workspace file is read.
- **Auto-detect**: use the single `*.code-workspace` in the session directory; with two or more the panel does not guess and says it cannot choose.
- **A specific file name**: the file name only (e.g. `team.code-workspace`), no path; the file has to be in the session directory.

Once on:

- A folder's `path` may be relative to the workspace file or absolute. It has to resolve (by realpath) outside the session directory and survive `git rev-parse --show-toplevel` equalling that directory before it becomes a row; subdirectories, ordinary directories and folders pointing back into the session directory are skipped (the last are already listed by the scan, never twice).
- `folders[].name` is the row's display name; at most 50 roots, the rest are ignored.
- An external root is one row for the folder itself: its own worktrees are not expanded.
- When the session directory holds a workspace file while the setting is still off, the switcher says so in place (in the file browser's notice bar when the working directory is not a repository), and one click turns it on. This is a plugin-wide setting: turning it on affects every session, and the hint alone changes nothing.
- A file that cannot be used names the check that refused it: a malformed setting, a symlink out of the directory, a directory in the file's place, a file too large, an unreadable file, or content that is not a workspace file — most often a `folders` entry without `path`; JSONC comments and trailing commas are supported.

## Permissions and data boundaries

The panel runs with the DSH process's privileges. These are the boundaries worth knowing before installing:

- **Git commands** — every git command goes through the host `subprocess` service: argv arrays, no shell string concatenation, cwd locked to the repository root, with a per-command timeout and output caps. It never force-pushes or force-resets; local branch deletion uses git's safe `-d` first and switches to `-D` only after the extra acknowledgement (squash) or, in a Git Flow finish, after proving the branch tip is already an ancestor of HEAD when `-d` refuses a stale upstream; a remote delete always requires its own acknowledgement. Merging and cherry-picking stick to git's own behaviour, and a conflict is aborted to restore the previous state. Apart from "Set upstream", a confirmed "Publish" (`git push -u`) and creating a local branch from a remote branch (`--track`), your git config is never touched.
- **File access** — it only reads files inside the workspace (diffs, file browser, the AI-suggestion input) after validation plus a realpath containment check: symlinks pointing outside the repository are refused and `.git` is not browsable. There are exactly two ways out of the workspace, both decided by realpath: a worktree of the session's own repository is switchable wherever it lives, but its `.git` must point back into that repository's `worktrees/` records — the record alone is not evidence, since it can be copied or hand-written; the repositories a `.code-workspace` file names need `codeWorkspace` turned on (off by default). Every such root must pass `git rev-parse --show-toplevel` before it becomes a switcher row, and selecting it moves the file browser and editing to that root under the same rules.
- **Two write paths only** — discarding an untracked entry deletes the working-tree file after your confirmation and refuses the whole batch when an entry is itself a Git repository; editing an existing file in the file browser is limited to a suffix allowlist, 2 MiB and UTF-8, compares the file version first and replaces it atomically, and also covers secret-bearing variants such as `.env`. It can be turned off in the plugin config.
- **Network** — the plugin itself makes exactly one request, `GET https://api.github.com/repos/<owner>/<repo>/releases/latest`, for the "new version available" notice (5 s timeout, cached in-process). `fetch` / `pull` / `push` / `publish` / `push --delete` reach the network only after you click, through git; "Set upstream" never contacts the network. Credentials stay with git: the plugin never reads, stores or returns a token.
- **External service** — only "AI commit message" sends diff content to the model provider you configured in DSH; the host performs the call and the plugin holds no credentials.
- **System dependency** — the `git` CLI. Without git, or outside a Git repository, only the file browser is shown.

The client bundle (`lib/client.js`) makes no network requests of its own — it talks to the host over same-origin RPC — and the plugin collects no telemetry. UI-only preferences such as the panel font size and pane widths live in browser localStorage and never contain repository content.

## Screenshots

| Overview | File-diff modal |
| :---: | :---: |
| ![Overview: branches, commit graph, commit detail, hover card](https://cdn.jsdelivr.net/gh/xbzbing/dsh-git-panel@main/docs/assets/screenshots/1-git-panel-overview.png) | ![File-diff modal: syntax-highlighted unified / split diff with on-demand gap expansion and word-level emphasis](https://cdn.jsdelivr.net/gh/xbzbing/dsh-git-panel@main/docs/assets/screenshots/2-overview-tab.png) |
| Changes | File browser |
| ![Changes: stats bar, uncommitted list, commit box, diff](https://cdn.jsdelivr.net/gh/xbzbing/dsh-git-panel@main/docs/assets/screenshots/3-changes.png) | ![File browser: lazy directory tree, official type icons, dimmed ignored entries, and file preview](https://cdn.jsdelivr.net/gh/xbzbing/dsh-git-panel@main/docs/assets/screenshots/4-files.png) |
| Narrow / mobile | Plugin config |
| ![Narrow / mobile: single-column drill-in layout with stats bar, change list, and commit box](https://cdn.jsdelivr.net/gh/xbzbing/dsh-git-panel@main/docs/assets/screenshots/5-mobile-panel.png) | ![Plugin config: marker toggle, default diff view, graph style, and AI generation settings](https://cdn.jsdelivr.net/gh/xbzbing/dsh-git-panel@main/docs/assets/screenshots/6-plugin-config.png) |

## Architecture

Two halves communicating over the typert Remote gateway.

- **Host** (`lib/host/`) — a Cordis + typert `GitPanelService` on the `dbGitPanel` namespace (the service key is globally unique; a duplicate mount stays inert instead of failing to activate), exposing `snapshot` / `run` / `query` / `suggest` / `version` / `openFile` / `writeFile` and doing only endpoint delegation and lifecycle wiring; git runs through the host `subprocess` service (argv arrays, no shell, cwd locked to the repository root, timeout + output caps); the `suggest` endpoint makes a one-shot commit-message call through the host `llm` service with your configured model.
- **Client** (`lib/client.js`) — a React bundle that registers the `conversation.view` panel and the `conversation.input.left` marker. One snapshot controller per session (polling + a refresh after each turn + a reload on connection reset) feeds the marker, the changes page, and the stats bar from a single snapshot, avoiding duplicate git commands.

## Development

```bash
node build.mjs      # tsc (host d.ts) + esbuild (per-module host js + client bundle + testkit)
npm run typecheck   # type check
npm run test:unit   # pure-algorithm and host-endpoint unit tests (node --test)
npm run test:e2e    # isolated file:// headless-browser e2e (never touches a running instance)
npm test            # unit + e2e
```

The host output is emitted one file per `src/host/` module (stack traces land in the module that raised) and is never minified: the typert gateway validates arguments by method parameter name, and minification would rename them and break the wire contract. Client changes are hot-reloaded: after rebuilding `lib/client.js`, the running dsh detects the file change within a second and pushes it to the browser for an in-place swap (old fiber torn down, new code remounted) — no page refresh needed; host changes still need a restart, since loaded modules keep running their previous code. `lib/` is local build output and is not committed; for local development, add the plugin to a dsh web profile's `dsh.profile.bundles` with a `file:` dependency pointing at this directory, then run `node build.mjs`.

## Project structure

```text
src/
  host/
    types.ts        the single source of truth for the wire data model (reused by the client)
    index.ts        GitPanelService: endpoint delegation + lifecycle wiring
    git.ts          subprocess → a GitRunner with timeouts
    core.ts         workspace resolution + snapshotForSession
    actions.ts      GitAction → git command sequences (commit / amend / stage …)
    queries.ts      history / diff / file-lines / file-version / image-diff / dir-list / file-content / show / branches / tags / worktree-stats
    package-tree.ts source-root detection, package-chain folding and src projection (the file browser's Java/Kotlin view)
    suggest.ts      AI commit-message suggestion (diff collection + language inference + one ctx.llm call)
    parser.ts       git output parsed into structured data
    version.ts      package version + GitHub release update check
  client/
    rpc.ts          the client face of the dbGitPanel endpoints
    controller.ts   per-session snapshot controller
    Panel.tsx       panel shell: sub-tab routing + version bar
    OverviewTab.tsx Overview three columns + hover card
    ChangesTab.tsx  changes page
    FilesTab.tsx    file browser (lazy directory tree + file preview)
    DiffView.tsx    diff view (unified / split / before / after)
    DiffReviewBar.tsx diff line comments: picking state and the comment form
    review-quote.ts comment quote format, numbering and picking rules
    GitPill.tsx     input-bar marker
    code-spans.ts   split syntax tokens at word-level change ranges
    git-graph.ts    commit-graph lane layout
    file-tree.ts    file paths folded into a tree
    diff.ts         unified diff → side-by-side rows + inline rows + stats
```

## Acknowledgements

Thanks to [@ivanant](https://github.com/ivanant) for his ongoing optimization suggestions, iteration requests and code. Mobile layout, batch selection in the changes page, AI commit messages, commit-graph and icon polish, and publishing a branch that has no upstream all came mostly from his real-world usage reports — feedback that moved the panel well past "it works". Git Flow support (#133) is his work as well: the start / finish / integrate entries in the branch list, branch and tag validation against the flow's naming rules, the step confirmations and chained release on finish, and the preview of the branch changes each action will make; this release's finish hardening, entry switch and user guide are built on top of it.

Thanks to [@QianYI-Yan](https://github.com/QianYI-Yan) for the foundation of workspace multi-repo support (#83): scanning the workspace's subdirectories for independent repositories, carrying an optional `repo` field on every RPC request to switch work trees, and dimming the old contents while a switch is in flight — his PR (#85) was the first implementation of all three, and this release's worktree detection and file-browser roots are built on top of it.

Thanks to [@homily707](https://github.com/homily707) for removing the confirmation prompts from high-frequency operations (#109): fast-forward pull, fast-forward push, and switching branches on a clean worktree now run immediately; when an operation fails after it starts, the error is reported against the repository it came from. PushModal, the pull / push dialog copy, and their preview queries are gone as well.

Thanks to [@GandzyTM](https://github.com/GandzyTM) for letting a session stay in its hub directory (#121): he proposed and implemented `.code-workspace` support (#122) from real multi-root workspace usage — the `codeWorkspace` setting, the JSONC parser and folder certification, the third gate for repositories outside the workspace (ADR-0030), and browsing and editing following the selected root; the later scan-cache TTL, attempt ceiling and `.code-workspace` editing are built on top of that implementation.

## License

[MIT License](https://github.com/xbzbing/dsh-git-panel/blob/main/LICENSE).
