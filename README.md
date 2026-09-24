# dsh-git-panel

[English](README_EN.md) | 简体中文

`dsh-git-panel` 是 DeepSeek Harness（dsh）的 Web GUI 插件，界面参照 IDE 的 Git 工具。它在对话工作区里新增一个常驻的 **Git** 面板（位于「对话」「轨迹」之后），并在输入框左侧放一个 zsh 风格的分支标记。

## 功能

### Git 面板（一个 `conversation.view` 标签页）

面板内含两个子标签：

- **Git 总览** —— 三栏布局：
  - 左栏：分支 / 标签列表，点击按该引用过滤历史；
  - 中栏：提交历史图，支持按提交信息、commit 哈希、作者、日期搜索；
  - 右栏：选中提交的变更文件树，以及完整的提交信息（comment）；点击文件在弹出的 modal 里看该文件在此提交中的差异，按 Esc 关闭。
- **变更记录** —— 本地工作区：
  - 左栏：统计条（文件数 / 增删行数 / 最近变更时间）、带复选框的未提交变更列表、含 **Amend** 复选框的提交框；
  - 右栏：选中文件的 side-by-side 差异对照（对照 / 变更前 / 变更后）。

子标签行右侧显示插件版本号，旁边有一个「检查新版本」按钮，由用户主动点击才去比对 GitHub 上的最新发布。

### 输入框 Git 标记

一个 zsh 主题风格的标记：`<仓库名> (<分支>)`。

- 仓库名青色，`(分支)` 绿色表示本地已同步、橙色表示有未提交的变更；
- 悬停弹出圆角提示面板，显示完整仓库路径；
- 点击跳转到 Git 面板：有未提交变更时进入**变更记录**，否则进入**Git 总览**；
- 当前目录不是 Git 仓库时，标记只显示目录名，不显示报错文案。

界面支持简体中文与英文，跟随 harness 的语言设置。

## 架构

插件分两半，通过 typert Remote 网关通信：

- **Host**（`lib/host/`）—— `gitPanel` 命名空间上的 Cordis + typert `GitPanelService`，暴露 `snapshot` / `run` / `query` / `version` 四个端点。git 命令经宿主 `subprocess` 服务执行：使用 argv 数组、不走 shell、工作目录锁定在仓库根、每条命令带超时和输出上限。
- **Client**（`lib/client.js`）—— 一个 React 包，注册 `conversation.view` 面板和 `conversation.input.left` 标记。每个会话一个快照控制器（轮询 + turn 完成后刷新），标记、变更记录页和统计条共用同一份快照。

## 安装

### 从 GitHub 安装（推荐）

仓库已提交构建产物 `lib/`，可以直接从 git 安装，不必在本地构建：

```bash
dsh plugin add github:xbzbing/dsh-git-panel
```

装好后重启或刷新 Web GUI，就能看到 Git 面板。

### 从本地源码安装

把插件加入 dsh web profile 的 `dsh.profile.bundles`，依赖里用 `file:` 指向本目录，再 `node build.mjs` 构建、刷新 Web GUI。

## 开发

```bash
node build.mjs      # tsc（host d.ts）+ esbuild（host bundle + client bundle）
npm run typecheck   # 类型检查
npm run test:unit   # 纯算法与 host 端点单测（node --test）
npm run test:e2e    # 隔离的 file:// 无头浏览器 e2e（不碰任何运行中的实例）
```

host bundle 不做压缩：typert 网关靠方法参数名做参数校验，压缩会改名并破坏 wire 契约。client 改动没有热重载，需重新构建并刷新页面。

## 许可

MIT
