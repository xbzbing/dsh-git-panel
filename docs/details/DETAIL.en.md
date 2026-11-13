# dsh-git-panel

An IDE-style Git panel in the conversation workspace: branches and commit history, staging and committing changes, diffs and a file browser in one resident tab, plus a zsh-style branch marker at the left of the input bar, so you never have to switch to a terminal or an IDE mid-conversation.

## Repository

Source code, permissions and data boundaries, and issue reports: <https://github.com/xbzbing/dsh-git-panel>

## Features

- **Overview**: branch / tag list, commit history graph and commit details; click a file to see its diff. History searches by “message / hash” or “file / path”, combined with author, date and branch filters. The relative-time column sizes itself to the UI language, and a narrow panel drops the author and then the hash.
- **Changes**: stage and discard per file or in batches, commit and **Amend**, stash, added·deleted statistics; the list switches between flat and folder-tree views, with folder-level stage and discard.
- **Common Git actions**: switch branches, create and delete tags, revert / reset; destructive actions ask for confirmation, and nothing is pushed automatically.
- **AI commit messages**: follow the style of the repository's existing commits; the model follows the current session by default and can be pinned on the detail page. **Generation sends your diff content to the provider of the model you picked.**
- **Input-bar Git marker**: a zsh-style `<repo> (<branch>)`, green when in sync and orange with uncommitted changes; a click jumps to the panel.
- **Multiple repositories**: worktrees and independent repositories in subdirectories are detected automatically, and after a switch the overview, changes and marker all act on the picked repository; a worktree of the session's own repository is switchable wherever it lives. VS Code `.code-workspace` multi-root workspace files are supported too — turn them on in the plugin settings (off by default).
- **File browser**: preview code, Markdown (mermaid included), HTML and images, and edit config files in place. Java/Kotlin projects fold package paths by convention, `src/main/java` becoming one source root (configurable).
- **Diff and source viewing**: unified / split / before / after views with syntax highlighting, word-level emphasis, on-demand context and <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>F</kbd> find-in-place.
- **Narrow panel / mobile**: the layout adapts to the panel size, so it works in the sidebar and on a phone.
- **Languages**: the UI follows the DSH system language: Simplified Chinese, English, 日本語, Español, Français, Deutsch, Русский and Português.
- **Context menus**: right-click files, directories, images, branches, commits, changes and stashes; destructive actions still ask for confirmation.
