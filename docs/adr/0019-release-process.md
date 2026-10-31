# ADR-0019：发布流程与发布说明

- 状态：Accepted（2026-10-18；预发布是否记录正文由 ADR-0021 细化）
- 相关：`.github/RELEASE_TEMPLATE.md`、`docs/releases/`、`.github/workflows/release.yml`、`test/unit/release-notes.test.mjs`、ADR-0018、ADR-0021

## Context

24 个已发布 Release 的正文格式**漂过好几次**：早期是 `中文 / English`，中间变成 `主要变更 / 验证`，英文标题在 `English` 与 `What's changed` 之间摇摆，对比链接时有时无；直到 v1.6.1 才稳定成「四段双语 + 对比链接」。每次发版都要翻历史 Release 反推格式，而人写的正文还会出现**沿用上一版单测数**这类失真。

同时发布本身是手工的：改 manifest、构建、打 tag、写正文、发布，每一步都能漏；npm 发布**不可逆**，漏了正文就没法回头。

## Decision

- **发布说明随发版提交入库**：`docs/releases/v<版本>.md`，格式以 **`.github/RELEASE_TEMPLATE.md` 为唯一来源**，在发版 PR 里与代码一起 review。**不再去翻历史 Release 反推格式。**（本条后由 ADR-0021 收窄：只有正式版入库，rc / alpha 不写正文。）
- **正文固定四段双语**：`## 主要变更` / `## 验证`，`---` 分隔，`## English` / `## Verification`；两段都以 `<PREV>...<TAG>` 的 compare 链接收尾。**不使用 GitHub 自动生成的 `## What's Changed`，也不使用 `gh release create --generate-notes`**（自动生成只列 PR 标题，会破坏结构）。
- **「验证」写当次 `npm run check` 的真实输出**（单测数、e2e runner 数、产物一致性），数字**不得沿用上一版**；再写 1–3 条最有判别力的回归（去掉修复后哪条测试转红）。
- **发布由 workflow 执行**（`release.yml`，main 驱动：push 到 main 且改动 `package.json`，或 `workflow_dispatch`）。
- **版本号里的 `-` 决定渠道**：
  - **预发布**（`1.8.0-rc.1`）：只建 GitHub prerelease Release 并附 tgz，**跳过 npm publish**；
  - **正式版**（`1.8.0`）：先 `npm publish --provenance`，再建稳定 Release 并附同一个 tgz。
  两者共用同一套门禁、正文文件与幂等逻辑。GitHub 的 `releases/latest` 服务端排除 prerelease，预发布不会触发版本条「有新版本」提示，`version.ts` 零改动。
- **步骤顺序**：状态检查 → 门禁（含缺正文早失败 + `npm pack` + `assert-pack.mjs`）→ 打 tag（在 main 的发布提交上）→ [正式版才] npm publish → 创建/更新 Release（`--notes-file`）。npm 是唯一不可逆的一步；tag 与 Release 都可事后修正，所以 npm 排在 tag 之后、稳定 Release 之前——版本条读的是 Release，只有 npm 就绪后才该出现提示。
- **幂等可重跑**：npm 上已有该版本则跳过发布，远端已有 tag 则跳过打 tag，已有 Release 则**更新正文**而非失败。
- **发布前校验三件事**：正式版的 `docs/releases/v<版本>.md` 必须存在（预发布用固定说明，见 ADR-0021）、门禁必须绿、版本号必须与 tag 名一致。**缺正文必须在打包前失败**。
- **格式由测试守住**：`test/unit/release-notes.test.mjs` 断言模板含四段与对比链接、每个 `docs/releases/*.md` 都合规（缺段、缺链接、英文段位置不对即红）。
- 发版仍由人发起：开 release PR，用 `npm version <v> --no-git-tag-version` 同步 manifest 与 lock（ADR-0017），合并即发布。

## Consequences

- 正文在合并前就被 review，格式不再漂移；发布说明的失真（旧单测数）被测试挡在本地与 CI。
- 代价：发版多一步「写 `docs/releases/v<v>.md`」；在网页上手工改 Release 正文而不改文件，下次重跑会被文件内容覆盖——这是刻意的，文件是唯一来源。
- 预发布可以反复发（`rc.1` → `rc.2`），每次都是完整门禁 + 同一份固定说明正文（ADR-0021）；正式版不可回收，出问题只能发补丁。
- 两个 job 分工：`gate`（只读）装依赖、跑门禁、打包并做 assert-pack，把 tarball 作为 artifact 交出；`release`（`contents: write` + `id-token: write`）只下载 artifact 后打 tag、publish、建 Release，不执行任何依赖代码——否则被投毒的 devDependency 能用合法 provenance 发出恶意版本。npm 认证优先 OIDC，退回 `NPM_TOKEN` 时用 granular、仅限此包、仅 publish 的 token。
- 触发面收在 main 上：`push` 与 `workflow_dispatch` 都要求 `github.ref == 'refs/heads/main'`；tag 已存在时核对它指向当前发布提交（`v$V^{}` 的 commit 必须等于 `GITHUB_SHA`），否则失败而不是复用。第三方 action 一律 pin 到 commit SHA。
- 仓库目前没有配置 tag / 分支保护规则集：`v*` tag 由本 workflow 创建，重跑靠上述 SHA 核对保证幂等；如需禁止删除或 force-push，属于 GitHub 仓库设置，不在代码里。
