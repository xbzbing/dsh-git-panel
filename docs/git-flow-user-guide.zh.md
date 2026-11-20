# Git Flow 使用帮助

GitFlow 入口位于 Git 总览的分支列表中。它适合已经约定使用 `develop`、`main` / `master`、`feature/*`、`release/*` 和 `hotfix/*` 的仓库。

如果当前 host 没有声明 `capabilities.flow`，面板不会显示 GitFlow 入口。普通分支操作仍然可以继续使用。

## 开始分支

### 开始 Feature

1. 在 `develop` 分支行打开菜单。
2. 选择“开始 Feature”。
3. 输入名称，面板会生成 `feature/<name>`。
4. 选择是否发布到 remote。
5. 查看预览并提交。

首次使用时，如果本地没有 `develop`，面板可以从所选基础分支创建 `develop`，再创建 Feature。

### 开始 Release

1. 在 `develop` 分支行打开菜单。
2. 选择“开始 Release”。
3. 输入版本或其他 release 名称，面板会生成 `release/<name>`。
4. 确认基础分支和是否发布。

Release 分支用于冻结功能、修复发布前问题和准备版本，不应继续加入未计划的功能。

### 开始 Hotfix

1. 在主线 `main` 或 `master` 行打开菜单。
2. 选择“开始 Hotfix”。
3. 输入版本或修复名称，面板会生成 `hotfix/<name>`。
4. 确认基础分支和是否发布。

Hotfix 应从当前生产主线开始，完成后会同时进入主线和 develop。

## 整合开发分支

在 `feature/*` 分支上打开 `develop` 行菜单，选择“整合开发”。面板会把 develop 合入当前 Feature。

发生冲突时，面板会尝试自动中止 merge 并恢复操作前状态。面板不提供冲突编辑器，需要解决冲突时请使用终端或其他 Git 工具。

## 完成 Feature

1. 在 `feature/*` 行打开菜单。
2. 选择“完成 Feature”。
3. 选择 merge、squash 或 rebase。
4. 确认目标为 `develop`。
5. 选择本地 branch、远端 upstream 是否删除。
6. 选择是否推送 develop。
7. 可选地勾选链式创建下一个 release。
8. 点击“完成”后，再检查步骤确认框。

Squash 后 branch 不在 develop 的祖先链上。如果要删除本地 branch，需要额外勾选强制删除。

## 完成 Release 或 Hotfix

完成 Release 或 Hotfix 时，面板会执行以下逻辑：

1. 将 flow branch 集成到主线。
2. 在主线集成提交上创建 annotated tag。
3. 将主线结果合回 develop。
4. 根据选择推送长期 branch。
5. 根据选择删除远端和本地 flow branch。

Release / Hotfix 的 tag 是发布识别的一部分。当前版本的 finish push 只推长期 branch，远端 tag 需要另外检查并手动推送。该行为属于待修复限制。

## 完成确认

finish 是多步写操作。确认框会列出：

- 集成方式和目标 branch。
- tag。
- 回合并 develop。
- 推送 branch。
- 删除本地 branch。
- 删除远端 branch。
- 链式 release。

删除远端 branch 时，需要在确认框中再次勾选不可逆操作确认。

## 失败状态

- 工作区不干净时，finish 会被拒绝。请先提交或 stash。
- `merge-conflict` 表示第一次集成冲突，且面板已完成自动恢复。
- `merge-stuck` 表示自动恢复失败。停止重复点击，先检查仓库是否仍处于 merge 或 rebase 状态。
- `flow-partial` 表示长期 branch 已经移动，后续步骤失败。先刷新并检查 branch、tag 和 remote。
- 网络请求返回不确定时，不能假设远端没有变化。先检查远端 branch，再决定是否重试。

当前版本没有完整的 finish 续作界面。遇到 partial 状态时，建议先保留现场并检查：

```bash
git status
git branch -vv
git log --oneline --decorate --graph --all
git tag --list
```

## 安全使用建议

- 在共享仓库中完成 finish 前先刷新面板。
- 需要删除远端 branch 时确认 remote 和 branch 的完整名称。
- 远端 branch 可能已经被其他协作者推进时，不要继续强制删除。
- release / hotfix 完成后检查远端 tag 是否存在。
- 远端 push 被拒绝时，先检查远端领先或分叉状态，不要使用 force push。

## 当前支持边界

- 支持 Feature、Release、Hotfix。
- 不支持 `bugfix/*` 和 `support/*` 的专用入口。
- 不依赖 `git flow` CLI。
- 不提供冲突编辑器。
- 不提供 force push。
- 入口和行为以当前仓库的 branch convention 为基础，不自动读取 `gitflow.*` 配置。
