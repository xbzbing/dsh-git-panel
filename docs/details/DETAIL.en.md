# dsh-git-panel

An IDE-style Git panel in the conversation workspace: branches and commit history, staging and committing changes, diffs and a file browser in one resident tab, plus a zsh-style branch marker at the left of the input bar, so you never have to switch to a terminal or an IDE mid-conversation.

## Features

- **Overview**: branch / tag list, a searchable commit history graph, and commit details; click a file to see its diff in that commit.
- **Changes**: stage and discard per file or in batches, commit and **Amend**, stash, and added·deleted statistics.
- **Common Git actions**: switch branches, create and delete tags, revert / reset commits; destructive actions ask for confirmation, and nothing leaves the local repository or gets pushed automatically.
- **AI commit-message suggestion**: follows the style of the repository's existing commits; the model follows the current session by default and can be pinned on the detail page. **Generation sends your diff content to the provider of the model you picked.**
- **Input-bar Git marker**: a zsh-style `<repo> (<branch>)`, green when in sync and orange with uncommitted changes; a click jumps to the panel.
- **Multiple repositories**: worktrees and independent repositories in subdirectories are detected automatically; after a switch, the overview, changes and input-bar marker all act on the picked repository.
- **File browser**: browse the workspace tree and preview code, Markdown (including mermaid diagrams), HTML and images; it also works outside a Git repository.
- **Diff and source viewing**: unified / split / before / after views with syntax highlighting, word-level emphasis, on-demand context expansion, and <kbd>Ctrl</kbd>/<kbd>⌘</kbd>+<kbd>F</kbd> find-in-place.
- **Narrow panel / mobile**: the layout adapts to the panel size, so it works in the sidebar and on a phone.
- **Languages**: the UI follows the DSH system language: Simplified Chinese, English, 日本語, Español, Français, Deutsch, Русский and Português.

## Repository

Source code, permissions and data boundaries, and issue reports: <https://github.com/xbzbing/dsh-git-panel>
