# ADR-0024：工作区文件编辑的边界

- 状态：Accepted（2026-10-30）
- 相关：issue #94、`src/host/write-file.ts`、`src/host/edit-info.ts`、`src/host/types.ts`（`isEditablePath` / `EDIT_MAX_BYTES`）、`src/client/use-file-edit.ts`、ADR-0006 / 0008

## Context

插件最初只读：它用来观察 AI 在工作区里做了什么，所有改动原计划都让 AI 执行。issue #94 的讨论里确定要加一类「顺手的编辑」：改一行配置、补一句文档、调整 `.gitignore`。这类改动交给 AI 既费 token，又少了人的参与感。

写盘带来几个必须先回答的问题：

1. 能改哪些文件？通用代码编辑器不在范围内，而且一份脚本被误改的代价远高于一份 Markdown。
2. 多大的文件可以改？编辑器要把整份文件放进浏览器，大文件在手机上不可用。
3. 怎样不损坏文件？面板的编辑器按 LF 处理文本、按 UTF-8 解码。GBK 编码的 `.properties`、混用 LF 与 CRLF 的文件，原样读进来再写回去就会被静默改写。
4. AI 会话在你编辑时可能正在改同一个文件。保存时要怎样才能不把它的改动覆盖掉？
5. 写入要原子：AI 的读取工具不能读到写了一半的文件。

备选方案：

- 复用 `run` 端点：它绑定 Git 工作树并返回快照，而文件浏览的根可以不是 Git 仓库。不采用。
- 引入 `dsh-atomic-write` 包：它不是现有 peer 依赖，加进来会收紧兼容门禁。而且这里还需要它没有的「保留权限位」与「写 realpath」两项。不采用。
- 用 dsh 的 `withFileLock` 协调写方：它只对同样使用它的写方有效，agent 经 bash 写文件不走它，加了也关不掉竞态窗口。不采用。

## Decision

- **白名单单源**：`types.ts` 的 `EDITABLE_EXTENSIONS`（`json` `yaml` `yml` `xml` `properties` `md` `markdown` `txt` `toml` `conf` `ini` `cfg`）与 `EDITABLE_FILENAMES`（`.gitignore` `.gitattributes` `.editorconfig` `.env`），大小写不敏感，两半共用 `isEditablePath`。`.env` 只按完整文件名命中，任何 `.env.` 前缀的名字在查扩展名**之前**就被排除，否则 `.env.json`、`.env.yaml` 会借扩展名通过。
- **请求路径与 realpath 的文件名都要命中白名单**：根内软链 `notes.md → run.sh` 不能借道编辑脚本。路径检查与 `file-content` 同一套：`isSafePath`、不含 `.git` 段、`isInsideRoot(..., hideGit=true)`（ADR-0006）。写入侧只解析一次 realpath（`resolveInsideRoot`），通过包含检查的那个路径就是被替换的路径。
- **可编辑的字节条件**（`editInfo`）：不超过 `EDIT_MAX_BYTES` = 2 MiB（读与写两个方向都查）；不含 NUL 字节（预览的二进制探测只看前 8 KB，这里看全文）；UTF-8 解码再编码后与原字节逐字节相等；换行风格单一（全 LF 或全 CRLF，孤立 `\r` 算混用）。另外进程对文件本身要有写权限（`access(W_OK)`）：`rename` 只要求目录可写，不查这一条就会替换只读文件。不满足时 `file-content` 带 `edit: { ok: false, reason }`（`too-large` / `encoding` / `mixed-eol` / `read-only`），按钮禁用并说明原因；保存时被同一条规则拒绝，返回 `not-editable` 并带同一个 `reason`，界面用同一句文案。
- **保存是比对写**：`file-content` 附带磁盘字节的 `sha256`，保存请求带上它作为 `baseSha256`。host 在进程内按 realpath 排队，重读字节比对；不一致返回 `file-changed` 和当前指纹 `currentSha256`，不写盘。「仍然覆盖」用这个当前指纹再发一次，所以仍是比对写：用户确认之后文件若又变了，会再次冲突。
- **还原编码细节**：client 发 LF、无 BOM 的文本；host 按当前磁盘文件的换行风格展开、按需补回 BOM。
- **原子替换**：同目录下以 `wx` 独占创建 `.<name>.gp-<随机>.tmp`，写入并 `chmod` 为原文件的权限位，再 `rename` 到 realpath 目标。失败时删除临时文件（`unlink`）；独占创建报 `EEXIST` 时那个名字上的条目不是自己的，不删。系统拒绝写入（`EACCES` / `EPERM` / `EROFS`）返回 `write-denied`，其余写盘错误返回 `write-failed`，两者的 `message` 只带 errno 码：系统原文含绝对路径（包括临时文件路径），不上 wire。软链本身保留，写入的是它指向的文件。
- **不跑 git**：写文件与 Git 无关，被 `.gitignore` 忽略的文件同样可编辑。
- **配置开关** `allowFileEdit`（volatile，默认开）：关闭时 `file-content` 不带编辑字段，`writeFile` 返回 `edit-disabled`；开关随快照下发，界面据此立即收起编辑按钮，不必等下一次读文件。
- **离开守卫**：未保存的草稿在切文件、compact 返回、切浏览根、跟随模式下切仓库时要求确认；刷新或关闭页面时挂 `beforeunload`。草稿随会话暂存，不受 60 秒回收窗口限制。分支切换等使工作树整体替换的事件不丢弃未保存的草稿：草稿仍绑定读入它的那个根与版本，保存时照常比对。
- **草稿状态在 `edit-store.ts` 单处收口**：同一会话可能同时挂两个面板（会话页签与侧栏），所以「未保存」按挂载实例记，任一实例或该会话的暂存草稿未保存，会话就算未保存；面板确认放弃时作用于该会话的所有实例并清掉暂存。每份草稿有唯一 `id`，保存响应只认发出它的那份草稿。
- **一次只跑一个保存**：保存在途时再次保存（按钮、Cmd/Ctrl+S、「仍然保存」「仍然覆盖」）不发请求；这期间的离开请求等结果，保存成功直接离开，失败再询问。编辑器在保存在途与确认框打开期间只读。
- **无法拦截的换根**（配置翻转、所选仓库消失后的回退）：未保存草稿留在原根，界面标明它属于哪个文件，保存仍写回原文件；手动刷新不再按新根重读这个路径，草稿结束后选中项随之清空。
- **全屏阅读器里的确认框渲染在阅读器卡片内**：浏览器全屏时只有全屏元素可见；确认框取得焦点，Tab 留在框内，一次 Escape 只关它自己（`dialog-focus.ts` 以最近的叠层标记判定按键归属）。

## Consequences

- README「权限与数据边界」的承诺随之改变：写盘动作从一项（放弃未跟踪条目，ADR-0008）变成两项。文档写明白名单、大小上限、比对写，以及 `.env` 可编辑而 `.env.*` 不可编辑。`.env` 的内容本来就能在预览里看到，编辑没有扩大暴露面，但它通常含密钥。
- 反方向的保护由 dsh 提供：`dsh-fs-observation-policy` 让 agent 的 edit / write 工具对「读过之后被改过」的文件返回 `FS_STALE_VERSION`，面板保存之后 agent 的编辑工具不会静默覆盖它。**agent 经 bash 直接写文件不受这套检查保护**，插件无能为力。
- 比对与 `rename` 之间仍有一个跨进程竞态窗口，长度是一次本地小文件写入（毫秒级）。窗口内另一个进程的写入会被覆盖。
- `rename` 换了 inode：硬链接会断开，属主与扩展属性不跟随（与 `dsh-atomic-write` 同一语义）。配置与文档文件极少是硬链接，接受。
- 只读目录里的可写文件存不了（临时文件建不出来），返回 `write-denied`。
- GBK 等非 UTF-8 文件、混合换行文件不能编辑，用户会看到禁用原因而不是一份被改坏的文件。
- 本期不做新建、重命名、删除。`.gitignore` 不存在时的「生成」留给后续，届时用 `wx` 独占创建。
