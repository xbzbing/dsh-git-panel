# dsh-git-panel

[English](#dsh-git-panel-english) | 中文

DeepSeek Harness（dsh）Web GUI 的 Git 面板插件，界面参照 IDE 的 Git 工具。它在对话工作区里新增一个常驻的 **Git** 面板（位于「对话」「轨迹」之后），并在输入框左侧放一个 zsh 风格的分支标记。

## 功能

### Git 面板（一个 `conversation.view` 标签页）

面板内含两个子标签：

- **Git 总览** —— 三栏布局：
  - 左栏：分支 / 标签列表，点击按该引用过滤历史；
  - 中栏：提交历史图，支持按提交信息、commit 哈希、作者、日期搜索；
  - 右栏：选中提交的变更文件树，以及完整的提交信息（comment）。
- **变更记录** —— 本地工作区：
  - 左栏：统计条（文件数 / 增删行数 / 最近变更时间）、带复选框的未提交变更列表、含 **Amend** 复选框的提交框；
  - 右栏：选中文件的 side-by-side 差异对照（对照 / 变更前 / 变更后）。

### 输入框 Git 标记

一个 zsh 主题风格的标记：`<仓库名> git:(<分支>)`。

- 仓库名青色，`git:(分支)` 绿色表示本地已同步、橙色表示有未提交的变更；
- 悬停弹出圆角提示面板，显示完整仓库路径；
- 点击跳转到 Git 面板：有未提交变更时进入**变更记录**，否则进入**Git 总览**；
- 当前目录不是 Git 仓库时，标记只显示目录名，不显示报错文案。

界面支持简体中文与英文，跟随 harness 的语言设置。

## 架构

插件分两半，通过 typert Remote 网关通信：

- **Host**（`lib/host/`）—— `gitPanel` 命名空间上的 Cordis + typert `GitPanelService`，暴露 `snapshot` / `run` / `query` 三个端点。git 命令经宿主 `subprocess` 服务执行：使用 argv 数组、不走 shell、工作目录锁定在仓库根、每条命令带超时和输出上限。
- **Client**（`lib/client.js`）—— 一个 React 包，注册 `conversation.view` 面板和 `conversation.input.left` 标记。每个会话一个快照控制器（轮询 + turn 完成后刷新），标记、变更记录页和统计条共用同一份快照。

## 构建

```bash
node build.mjs      # tsc（host d.ts）+ esbuild（host bundle + client bundle）
npx tsc --noEmit    # 类型检查
```

host bundle 不做压缩：typert 网关靠方法参数名做参数校验，压缩会改名并破坏 wire 契约。

## 本地安装

把插件加入 dsh web profile 的 `dsh.profile.bundles`，并在依赖里指向它（用 `file:` 路径，或在 profile 的 `node_modules` 里建符号链接），然后重新构建 client bundle 并刷新 Web GUI。

## 许可

MIT

---

<a id="dsh-git-panel-english"></a>

# dsh-git-panel (English)

[English](#dsh-git-panel-english) | [中文](#dsh-git-panel)

An IDE-style Git panel plugin for the DeepSeek Harness (dsh) Web GUI. It adds a resident **Git** panel to the conversation workspace (after Chat and Trajectory) and a zsh-style branch marker at the left of the input bar.

## Features

### Git panel (a `conversation.view` tab)

Two sub-tabs:

- **Overview** — three columns:
  - left: branch / tag list; clicking one filters history by that ref;
  - middle: the commit history graph, searchable by commit message, commit hash, author, or date;
  - right: the selected commit's changed-file tree and full commit message.
- **Changes** — the local working tree:
  - left: a statistics bar (file count / added·deleted lines / last-change time), the uncommitted change list with per-file checkboxes, and a commit box with an **Amend** checkbox;
  - right: the selected file's side-by-side diff (split / before / after).

### Input-bar Git marker

A zsh-theme marker: `<repo> git:(<branch>)`.

- the repo name is cyan; `git:(branch)` is green when the working tree is in sync and orange when changes are uncommitted;
- hovering opens a rounded tooltip panel with the full repository path;
- clicking jumps to the Git panel — to **Changes** when there are uncommitted changes, otherwise to **Overview**;
- when the current directory is not a Git repository, the marker shows only the directory name, with no error text.

The UI is available in Simplified Chinese and English, following the harness locale.

## Architecture

Two halves communicating over the typert Remote gateway:

- **Host** (`lib/host/`) — a Cordis + typert `GitPanelService` on the `gitPanel` namespace, exposing `snapshot` / `run` / `query`. Git runs through the host `subprocess` service: argv arrays, no shell, working directory locked to the repository root, per-command timeout and output caps.
- **Client** (`lib/client.js`) — a React bundle that registers the `conversation.view` panel and the `conversation.input.left` marker. One snapshot controller per session (polling plus a refresh after each turn) feeds the marker, the changes page, and the stats bar from a single snapshot.

## Build

```bash
node build.mjs      # tsc (host d.ts) + esbuild (host bundle + client bundle)
npx tsc --noEmit    # type check
```

The host bundle is not minified: the typert gateway validates arguments by method parameter name, and minification would rename them and break the wire contract.

## Local install

Add the plugin to a dsh web profile's `dsh.profile.bundles` and point a dependency at it (a `file:` path, or a symlink in the profile's `node_modules`), then rebuild the client bundle and refresh the Web GUI.

## License

MIT
