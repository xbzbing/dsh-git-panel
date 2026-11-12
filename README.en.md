# dsh-git-panel

English | [简体中文](https://github.com/xbzbing/dsh-git-panel/blob/main/README.md)

![dsh-git-panel](https://cdn.jsdelivr.net/gh/xbzbing/dsh-git-panel@main/docs/assets/banner.png)

`dsh-git-panel` is a DSH Web GUI plugin that brings an IDE-style Git panel into the conversation workspace. It gathers the branch list, commit history graph, uncommitted-change commit & amend, and syntax-highlighted diffs into one resident tab, and puts a zsh-style branch marker at the left of the input bar — so you can check repo status and commit changes mid-conversation without switching to a terminal or a separate IDE.

The panel only reads the Git repository at the current session's working directory. Every git command runs through the host subprocess service as an argv array — no shell string concatenation — with the working directory locked to the repository root and per-command timeout and output caps. The plugin leaves your git config alone by default; the current branch's tracking config (`branch.<name>.remote` / `merge`) is written in exactly three cases — "Set upstream" (no push, no network), "Publish" (`git push -u`, which contacts the network and creates the same-named remote branch), and creating a local branch from a remote branch (`--track`). Every write (commit, amend, stage, discard) has an explicit entry point.

## Install

```bash
# Stable release (npm)
dsh plugin --profile web add @xbzbing/dsh-git-panel@latest

# Pre-release (GitHub Release asset; never published to npm)
dsh plugin --profile web add https://github.com/xbzbing/dsh-git-panel/releases/download/v1.8.0-rc.1/xbzbing-dsh-git-panel-1.8.0-rc.1.tgz
```

Pre-release versions carry a `-` suffix (e.g. `1.8.0-rc.1`): they ship only as GitHub prereleases, never to npm, and never trigger the in-panel "update available" prompt. `lib/` is not committed, so `dsh plugin add github:…` does not work.

After a first install the **Git** panel appears in the workspace tab bar with no restart or page refresh. On update, a version that only changes the client half takes effect immediately; one that changes the host half needs a dsh restart. Settings on the detail page apply immediately.

> **Compatibility**: verified on `dsh@0.2.1-rc.2`, `dsh@0.2.2-alpha.2` and `dsh@0.2.2-rc.1` — installation, the Git panel, the input-bar marker, the host RPC, and the plugin detail page all work normally.

## Features

- **Overview** — branch / tag list, commit history graph, and commit details; click a file to see its diff in that commit. History offers “message / hash” and “file / path” search. File / path search matches literal substrings in historical paths without distinguishing English letter case, including file names and directory fragments, while author, date and branch filters still combine with it. The search matches paths only, not code contents; deleted paths remain searchable and renames do not automatically follow the old name. Git may simplify parts of merge and side-branch history in the default path view; commit details still show the complete file list.
- **Changes** — stage and discard per file or in batches, commit and **Amend**, stash, and added·deleted statistics. The list switches between a flat and a folder-tree view (per-folder counts, folder-level stage / discard, renames show their old path); flat by default and configurable in the plugin settings, with a single switch icon on the action toolbar showing the view in use (it hides itself when space is tight). A pick carries the side it was made on: selecting only the staged row commits what the index already holds (no re-`git add` of unstaged hunks, so a partial `git add -p` survives), while selecting the working-tree row commits the whole file.
- **Common Git actions** — switch branches, create a branch (from a branch or a commit, without switching to it), merge a branch, cherry-pick a commit, delete local and remote branches (an unmerged local branch needs the extra force acknowledgement in the confirmation dialog; a remote delete always needs one), create and delete tags, revert / reset commits; a conflicting merge or cherry-pick is aborted automatically and the previous state restored; destructive actions ask for confirmation, and apart from deleting a remote branch nothing leaves the local repository or gets pushed automatically. When the branch has no upstream but at least one remote already has a same-named branch at HEAD, the sync control offers "Set upstream": it opens a chooser listing those remotes (origin preselected) and only writes the chosen tracking config, with no push and no network; otherwise it offers "Publish" (`push -u`).
- **AI commit-message suggestion** — follows the style of the repository's existing commits; the model follows the current session by default and can be pinned on the detail page. **Generation sends your diff content to the provider of the model you picked.**
- **Input-bar Git marker** — a zsh-style `<repo> (<branch>)`, green when in sync and orange with uncommitted changes; a click jumps to the panel. In a blank conversation whose view-tab row is not rendered yet, the click opens the Git page in the right sidebar instead; when the sidebar is expanded with only that page in it, another click collapses the sidebar (with another page present it still just jumps to Git). When that entry is unavailable too, it says to send the first message.
- **Multiple repositories** — worktrees and independent repositories in subdirectories are detected automatically; with `codeWorkspace` enabled, a `.code-workspace` file in the workspace also contributes the folders it names — including repositories beside or above the workspace — labeled with the file's own `name` values where it sets them; after a switch, the overview, changes and input-bar marker all act on the picked repo; the list stays expanded across picks, so switching again is one click, and a checkout read before comes back with its previous content.
- **File browser** — browse the workspace tree and preview code, Markdown (including mermaid diagrams), HTML and images; it is rooted at the project root by default and can follow Git switches instead; it also works outside a Git repository. Config and document files (json / yaml / xml / properties / md / txt / toml / conf / ini / cfg, `.gitignore` and the like) can be edited and saved in place. Java/Kotlin projects also fold package paths by convention: `src/main/java` becomes one source root and a run of single-child package directories becomes one `com.example…` row (on by default; turn it off under View in the plugin settings to get the physical tree back).
- **Context menus** — right-click files, directories, previewed images, branch and commit rows, changes, stashes, repository rows and the input-bar marker. Files and directories borrow the sidebar's public actions — open in a floating pane, reveal in Finder, open with the default application (with its icon), copy the path, download / save as (no "open in sidebar"); the two panes of an image diff offer copy, download and save as. Branch rows switch, create a branch from them, merge them into the current branch (issue #118, both behind a confirmation; creating does not switch), filter the history to that branch, copy its name and delete the local branch (issue #112, behind a confirmation); remote branch rows can also create and merge through their full tracking ref (issue #118) and delete the branch on the server (with a mandatory acknowledgement, remote only); commit rows copy hashes and the message, create tags, create a branch at the commit, cherry-pick the commit onto the current branch (issue #118, behind a confirmation), revert or reset (issue #107), and check the commit out as a detached HEAD when the host declares it; change rows open the diff, stage or discard; stash rows apply, pop, copy the message or drop; files, directories and commits can be quoted into the composer; repository rows reveal, copy the path and check the remote; the marker's menu opens the pages, copies the branch name and checks the remote. Requires dsh ≥ 0.2.2-alpha.3; older versions keep the browser's native menu.
- **Diff and source viewing** — unified / split / before / after views switched from the toolbar icons (the compare glyph rotates for split; click again to return to unified), with syntax highlighting, word-level emphasis, on-demand context expansion, and <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>F</kbd> find-in-place; images can be zoomed, panned and shown fullscreen.
- **Narrow panel / mobile** — the layout adapts to the panel size, so it works in the sidebar and on a phone.
- **Languages** — the UI follows the DSH system language: Simplified Chinese, English, 日本語, Español, Français, Deutsch, Русский and Português; any other language falls back to English.

## Permissions and data boundaries

The panel runs with the DSH process's privileges. These are the boundaries worth knowing before installing:

- **Git commands** — every git command goes through the host `subprocess` service: argv arrays, no shell string concatenation, cwd locked to the repository root, with a per-command timeout and output caps. It never force-pushes or force-resets. Local branch deletion uses git's safe `-d` first and switches to `-D` only after the extra acknowledgement in the confirmation dialog; remote deletion runs `git push --delete` for the exact `refs/heads/` ref and always requires the acknowledgement. Merging and cherry-picking stick to git's own behaviour (fast-forward when possible, a merge commit otherwise; never `--no-ff`, rebase or force flags), and a conflict is aborted with `git merge --abort` / `git cherry-pick --abort` to restore the previous state — a failed abort is reported explicitly instead. Apart from "Set upstream", a confirmed "Publish" (`git push -u`), and creating a local branch from a remote branch (`--track`) writing the current branch's tracking config, your git config is never touched.
- **File access** — it only reads files inside the workspace (diffs, file browser, the AI-suggestion input), after validation plus a realpath containment check: symlinks pointing outside the repository are refused and `.git` is not browsable. The one way to step outside the workspace is `codeWorkspace` (off by default): a `.code-workspace` file inside the workspace may name repositories outside it, and each of them is confirmed by `git rev-parse --show-toplevel` before it becomes a switcher row. Selecting such a row moves the file browser and editing to that root, under the same rules; a `..`-style selector is accepted for exactly those directories and nothing else. The plugin writes to disk in two ways only:
  - **Discarding an untracked entry** deletes the working-tree file after your confirmation, and refuses the whole batch when an entry is itself a Git repository.
  - **Editing an existing file in the file browser**, limited to `json` `code-workspace` `yaml` `yml` `xml` `properties` `md` `markdown` `txt` `toml` `conf` `ini` `cfg` plus `.gitignore` `.gitattributes` `.editorconfig` `.env`, up to 2 MiB and UTF-8; read-only files stay read-only. `.env` and `.env.*` variants such as `.env.local` are editable (they usually hold secrets). A save first compares the file version, so a change the AI or another program made while you were editing is never silently overwritten; the write replaces the file atomically through a temp file and keeps its line endings, BOM and permission bits. It can be turned off under Basic settings in the plugin config.
- **Network** — the plugin itself makes exactly one request, `GET https://api.github.com/repos/<owner>/<repo>/releases/latest`, for the "new version available" notice in the version bar (5 s timeout, cached in-process). `fetch` / `pull` / `push` / `publish` / `push --delete` reach the network only after you click, through git commands; "Set upstream" writes local tracking config only and never contacts the network. Credentials stay with git: the plugin never reads, stores, or returns a token or credential.
- **External service** — only "AI commit message" sends diff content to the model provider you configured in DSH; the host performs the call and the plugin holds no credentials.
- **System dependency** — the `git` CLI. Without git, or outside a Git repository, only the file browser is shown, rooted at the current working directory.

The client bundle (`lib/client.js`) makes no network requests of its own — it talks to the host over same-origin RPC — and the plugin collects no telemetry. UI-only preferences such as the panel font size and pane widths live in browser localStorage and never contain repository content. Apart from git commands, the confirmed deletion and the edits you save, the plugin's code writes no files and reads nothing outside the workspace — except the repositories a `.code-workspace` file names while that option is on (above); the detail-page settings are persisted by the host into the profile config.

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
    queries.ts      history / diff / file-lines / image-diff / dir-list / file-content / show / branches / tags / worktree-stats
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
    GitPill.tsx     input-bar marker
    code-spans.ts   split syntax tokens at word-level change ranges
    git-graph.ts    commit-graph lane layout
    file-tree.ts    file paths folded into a tree
    diff.ts         unified diff → side-by-side rows + inline rows + stats
```

## Acknowledgements

Thanks to [@ivanant](https://github.com/ivanant) for the many optimization suggestions and iteration requests filed against this project. Mobile layout, batch selection in the changes page, AI commit messages, commit-graph and icon polish, and publishing a branch that has no upstream all came mostly from his real-world usage reports — feedback that moved the panel well past "it works".

Thanks to [@QianYI-Yan](https://github.com/QianYI-Yan) for the foundation of workspace multi-repo support (#83): scanning the workspace's subdirectories for independent repositories, carrying an optional `repo` field on every RPC request to switch work trees, and dimming the old contents while a switch is in flight — his PR (#85) was the first implementation of all three, and this release's worktree detection and file-browser roots are built on top of it.

Thanks to [@homily707](https://github.com/homily707) for removing the confirmation prompts from high-frequency operations (#109): fast-forward pull, fast-forward push, and switching branches on a clean worktree now run immediately; when an operation fails after it starts, the error is reported against the repository it came from. PushModal, the pull / push dialog copy, and their preview queries are gone as well.

Thanks to [@GandzyTM](https://github.com/GandzyTM) for letting a session stay in its hub directory (#121): he proposed and implemented `.code-workspace` support (#122) from real multi-root workspace usage — the `codeWorkspace` setting, the JSONC parser and folder certification, the third gate for repositories outside the workspace (ADR-0030), and browsing and editing following the selected root; the later scan-cache TTL, attempt ceiling and `.code-workspace` editing are built on top of that implementation.

## License

[MIT License](https://github.com/xbzbing/dsh-git-panel/blob/main/LICENSE).
