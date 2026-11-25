# ADR-0040：提交并推送是「提交 + 普通 push」的组合，不折入需要确认的远程写

- 状态：Accepted（2026-11-25）
- 相关：issue #152、ADR-0007、ADR-0036、`src/client/commit-push.ts`、`src/client/commit-mode.ts`、`src/client/push-policy.ts`、`src/client/ChangesTab.tsx`

## Context

issue #152 要求在提交按钮旁边加一个「提交并上传」，把两次点击合成一次。难点不在顺序，而在**边界**：面板的远程写不止普通 push——还有 publish（在远端创建同名分支）、set-upstream（选一个 remote 接上去）和分叉时的合并式同步（fetch + merge + push）。后三者都写远程配置或历史，按 ADR-0007 / ADR-0036 各有自己的确认框。

另外两个约束决定了交互形态：

- 用户可能在两种意图之间切换（只提交 / 提交并推送），而按钮只有一个位置。业内两种做法：复选框式（SourceTree 的「push immediately」）与分体下拉（Visual Studio 的 Commit Staged + 下拉）。issue 作者点名要后者，VS 2022 与 IDEA 的提交面板也是这个形状。
- 状态必须可预期：VS Code 的 `postCommitCommand` 曾被抱怨「明明写着 commit，却偷偷 push 了」，所以主按钮的文字必须跟着选择变。

## Decision

1. **一次点击只做两件各自本来就能一次点击完成的事**：提交，然后普通 `push`。publish / set-upstream / 分叉同步不折进来：它们要么需要先选 remote，要么需要先合并，折进来只能变成「先提交、再弹窗」或者「静默建远端分支」，两者都违背「点击前可预期」。
2. **分体按钮 + 会话级选择**。主按钮执行当前选择，右侧 24px caret 打开两项，勾选态由平台 `Menu` 的 `selectedId` 表达。选择写进会话级 `commit-mode.ts`（内存 Map），不写插件配置：它是本次工作的操作习惯，不是安装偏好；刷新回默认。主按钮文字始终等于将要执行的动作。
3. **快捷键恒等于「提交并推送」且不改选择**（`Ctrl`/`⌘`+`Alt`+`K`，IDEA 的 Commit-and-Push）。键位按 `event.code` 匹配（macOS 的 Option+K 打出「˚」）。作用域是本页签子树，但三种输入不算数：(a) 声明了 `data-gp-overlay` 的浮层（确认框、放大卡片）打开——portal 弹窗的 React 父节点仍在这棵子树里，合成事件照常冒泡，不挡就会在确认框里提交；(b) 按住不放的自动重复——链路结束时输入框已清空，第二次 keydown 只会报「提交信息为空」；(c) AltGr，Windows 上报成 Ctrl+Alt，在把字符放在 AltGr+K 上的布局里打字会直接提交。焦点落在提交框以外的文本输入（textarea / 文本类 `input` / `contenteditable`）时也不触发，但复选框、按钮这类不接收字符的控件不算：点过 Amend 后焦点停在复选框上，一刀切拦 `input` 会让快捷键静默失效。caret 菜单不是浮层：那一行正是这个快捷键，菜单打开时照常执行并随 `busy` 关闭。
4. **提交与推送是两个独立结果，不互相回滚**。提交失败不推（否则会把此前积压的提交推出去）；推送只用提交回填的**新快照**，仓库在写入期间被切换（没有新快照）就停止；推送被拒不撤销提交。
5. **跳过而不是尝试**。普通 push 不能 fast-forward 时（`detached` / `unborn` / `no-upstream` / `behind`，以及 amend 已推送的提交），链只提交并说明原因；绝不 force。判断分两处读快照：只有「amend 已推送 vs 未推送」必须读提交前状态（amend 后两者都读作 diverged），其余原因和 `behind` 计数一律取提交回填的新快照——提交本身会消掉 `unborn`，用旧快照会把「分支还没有提交」写在一个刚产生的提交下面。这条分支条件的单源在 `push-policy.ts` 的 `pushBlockedReason`，`canPush` 由它派生，链只额外加 amend。
6. **跳过不是错误**。跳过是用户点击时菜单已经预告过的预期结果，走中性通知条；只有推送真的被拒才走错误条。

## Consequences

- 这几种状态下用户需要两次点击（先提交，再用工具栏的发布 / 设置上游 / 同步）。这是有意的：每一次远程写都保留自己的确认与选择。
- 菜单的选择态只在本会话有效；重开页面回到「提交」。不做全局记忆，避免「上次设过，这次静默推送」。
- 平台 `Menu` 的 `autoFocus` / `selection` / `shortcut` 在旧宿主上会被忽略：菜单仍可用、仍能选择，只是打开后不自动聚焦、没有快捷键角标。按「降级不报错」接受，不为此维护第二套菜单。
- 真实宿主不把选中态写成 `aria-checked`（那是 Switch 的属性），e2e 的选中断言读取的是 harness stub 暴露的 `selectedId`；可访问性依赖平台 Menu 自己的选中呈现，升级 dsh 时需复核。
