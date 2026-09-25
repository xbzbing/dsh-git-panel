/**
 * Read-only query endpoint: history / diff / image-diff / show / branches /
 * tags / authors / last-commit-message / worktree-stats.
 */
import { join } from 'node:path'
import type { SnapshotDeps, GitPanelConfig } from './core.ts'
import { resolveWorkspace, runCommand, snapshotForSession } from './core.ts'
import { isSafePath, isSafeRev } from './validate.ts'
import { parseBranches, parseGraphLog, parseNameStatus } from './parser.ts'
import type { GitBranch, GitCommit, GitFileStat, GitQueryRequest, GitQueryResponse, GraphCommit } from './types.ts'
import { imageMimeFor } from './types.ts'

const GRAPH_FORMAT = '--format=%H%x1f%h%x1f%P%x1f%an%x1f%aI%x1f%D%x1f%s%x1e'

/** 7+ hex chars → treat search as a commit hash prefix. */
function isHexLike(text: string): boolean {
  return /^[0-9a-fA-F]{7,40}$/.test(text.trim())
}

export async function runQuery(
  deps: SnapshotDeps,
  config: GitPanelConfig,
  request: GitQueryRequest,
): Promise<GitQueryResponse> {
  const workspace = await resolveWorkspace(deps, request.sessionId)
  if (!workspace.ok) {
    const error = workspace.failure.error
    return {
      ok: false,
      error: {
        code: error.code === 'not-a-git-repo' || error.code === 'cwd-unavailable' || error.code === 'session-not-found' || error.code === 'timeout' || error.code === 'cancelled' || error.code === 'git-unavailable'
          ? error.code
          : 'git-error',
        ...('detail' in error ? { message: error.detail } : {}),
      },
    }
  }
  const root = workspace.root
  const q = request.query

  try {
    switch (q.kind) {
      case 'history': return await queryHistory(deps, root, q)
      case 'diff': return await queryDiff(deps, root, q)
      case 'image-diff': return await queryImageDiff(deps, config, root, q)
      case 'show': return await queryShow(deps, root, q.ref)
      case 'branches': return await queryBranches(deps, root)
      case 'tags': return await queryTags(deps, root)
      case 'authors': return await queryAuthors(deps, root)
      case 'last-commit-message': return await queryLastCommitMessage(deps, root)
      case 'worktree-stats': return await queryWorktreeStats(deps, config, request.sessionId)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: { code: 'git-error', message } }
  }
}

async function queryHistory(
  deps: SnapshotDeps,
  root: string,
  q: Extract<GitQueryRequest['query'], { kind: 'history' }>,
): Promise<GitQueryResponse> {
  // Clamp paging: the host is the trust boundary; a huge limit walks all of
  // history into the output cap, a non-number is a git fatal.
  const limit = Number.isFinite(q.limit) ? Math.min(500, Math.max(1, Math.trunc(q.limit))) : 100
  const skip = Number.isFinite(q.skip) ? Math.max(0, Math.trunc(q.skip)) : 0
  const args = ['git', 'log', GRAPH_FORMAT, `--max-count=${limit}`, `--skip=${skip}`]
  const search = q.search?.trim() ?? ''
  const hexJump = search !== '' && isHexLike(search)
  const countArgs = ['git', 'rev-list', '--count']
  // Untrusted ref/author filters must never reach an option position: reject a
  // dash-prefixed / metacharacter ref (the `--output=` file-write vector) and
  // pass the ref after `--end-of-options`, which git treats as a bare operand.
  if (!hexJump) {
    if (search !== '') { args.push('-i', '-E', `--grep=${search}`); countArgs.push('-i', '-E', `--grep=${search}`) }
    if (q.author !== undefined && q.author !== '') { args.push(`--author=${q.author}`); countArgs.push(`--author=${q.author}`) }
    if (q.since !== undefined && q.since !== '') { args.push(`--since=${q.since}`); countArgs.push(`--since=${q.since}`) }
    if (q.ref !== undefined && q.ref !== '') {
      if (!isSafeRev(q.ref)) return { ok: false, error: { code: 'invalid-name', message: `unsafe ref: ${q.ref}` } }
      args.push('--end-of-options', q.ref); countArgs.push('--end-of-options', q.ref)
    } else {
      args.push('--all'); countArgs.push('--all')
    }
  } else {
    // Hash jump: `search` is already constrained to [0-9a-f]{7,40} by isHexLike.
    args.push('--end-of-options', search)
  }
  // Run the page log and the total count concurrently (the count is a second
  // full history walk; serializing it roughly doubled the first-page latency).
  const [res, countRes] = await Promise.all([
    runCommand(deps.run, args, root, 'history', deps.signal),
    hexJump ? Promise.resolve(null) : runCommand(deps.run, countArgs, root, 'history-count', deps.signal),
  ])
  if (!('run' in res)) return { ok: false, error: { code: 'git-unavailable' } }
  if (res.run.cancelled) return { ok: false, error: { code: 'cancelled' } }
  if (res.run.timedOut) return { ok: false, error: { code: 'timeout' } }
  if (res.run.exitCode !== 0) {
    // Only a hash-jump miss or a genuine unknown/empty ref is an empty page;
    // every other non-zero exit surfaces as an error instead of a silent
    // "no commits" that would also mask malformed input.
    const stderr = res.run.stderr.trim()
    if (hexJump || /unknown revision|bad revision|does not have any commits|ambiguous argument/i.test(stderr)) {
      return { ok: true, value: { kind: 'history', commits: [], total: 0 } }
    }
    return { ok: false, error: { code: 'git-error', message: stderr || `git exited ${res.run.exitCode}` } }
  }
  const commits: GraphCommit[] = parseGraphLog(res.run.stdout)
  let total = -1
  if (hexJump) {
    total = commits.length
  } else if (countRes !== null && 'run' in countRes && countRes.run.exitCode === 0) {
    const n = Number(countRes.run.stdout.trim())
    if (Number.isFinite(n)) total = n
  }
  return { ok: true, value: { kind: 'history', commits, total } }
}

async function queryDiff(
  deps: SnapshotDeps,
  root: string,
  q: Extract<GitQueryRequest['query'], { kind: 'diff' }>,
): Promise<GitQueryResponse> {
  if (!isSafePath(q.path)) return { ok: false, error: { code: 'invalid-path', message: q.path } }
  // Context lines around each change; a large value effectively shows the whole
  // file (expand-all). Clamp to a sane ceiling to bound output.
  const ctx = q.context !== undefined && Number.isFinite(q.context) ? Math.max(0, Math.min(100000, Math.floor(q.context))) : 3
  const unified = `-U${ctx}`
  let args: string[]
  if (q.base === 'staged') {
    args = ['git', 'diff', unified, '--cached', '--', q.path]
  } else if (q.base === 'commit') {
    if (!isSafeRev(q.commit)) return { ok: false, error: { code: 'invalid-name', message: `unsafe commit: ${q.commit}` } }
    args = ['git', 'show', unified, '--end-of-options', q.commit, '--', q.path]
  } else {
    // worktree: unstaged diff; for untracked files use --no-index against /dev/null.
    args = ['git', 'diff', unified, '--', q.path]
  }
  const res = await runCommand(deps.run, args, root, 'diff', deps.signal)
  if (!('run' in res)) return { ok: false, error: { code: 'git-unavailable' } }
  if (res.run.cancelled) return { ok: false, error: { code: 'cancelled' } }
  if (res.run.timedOut) return { ok: false, error: { code: 'timeout' } }
  let text = res.run.stdout
  // Untracked file: `git diff` yields nothing; synthesize with --no-index.
  if (q.base === 'worktree' && text.trim() === '') {
    const noIndex = await runCommand(deps.run, ['git', 'diff', unified, '--no-index', '--', '/dev/null', q.path], root, 'diff-untracked', deps.signal)
    if ('run' in noIndex) text = noIndex.run.stdout
  }
  return { ok: true, value: { kind: 'diff', path: q.path, text } }
}

// ── image diff ─────────────────────────────────────────────────────────────

/** One image side: base64 payload, an over-cap flag, or absent (no such side). */
type ImageSide = { readonly data: string } | { readonly tooLarge: true } | undefined

/**
 * Old/new image sides for a binary image, mirroring the text diff's sources:
 * worktree rows compare index vs working file, staged rows HEAD vs index,
 * commit rows parent vs commit — so each pane matches the code pane's meaning.
 * Each side is capped at `config.maxBytes` (profile-configurable): as base64
 * inside one JSON envelope, two capped sides bound the RPC payload.
 */
async function queryImageDiff(
  deps: SnapshotDeps,
  config: GitPanelConfig,
  root: string,
  q: Extract<GitQueryRequest['query'], { kind: 'image-diff' }>,
): Promise<GitQueryResponse> {
  if (!isSafePath(q.path)) return { ok: false, error: { code: 'invalid-path', message: q.path } }
  if (q.base === 'commit' && !isSafeRev(q.commit)) return { ok: false, error: { code: 'invalid-name', message: `unsafe commit: ${q.commit}` } }
  const mime = imageMimeFor(q.path)
  if (mime === null) return { ok: true, value: { kind: 'image-diff', path: q.path, mime } }

  const oldSpec = q.base === 'staged' ? `HEAD:${q.path}` : q.base === 'commit' ? `${q.commit}^1:${q.path}` : `:${q.path}`
  const newSpec = q.base === 'staged' ? `:${q.path}` : q.base === 'commit' ? `${q.commit}:${q.path}` : null
  const [oldOid, newOid] = await Promise.all([
    resolveOid(deps, root, oldSpec),
    newSpec === null ? Promise.resolve(undefined) : resolveOid(deps, root, newSpec),
  ])

  const cap = config.maxBytes
  const gitDir = oldOid !== undefined || newOid !== undefined ? await absoluteGitDir(deps, root) : ''
  const [oldSide, newSide] = await Promise.all([
    oldOid === undefined ? Promise.resolve(undefined) : blobSide(deps, gitDir, oldOid, cap),
    newOid !== undefined
      ? blobSide(deps, gitDir, newOid, cap)
      : q.base === 'worktree' ? worktreeSide(deps, root, q.path, cap) : Promise.resolve(undefined),
  ])
  const sides = [oldSide, newSide]
  if (sides.some((s) => s !== undefined && 'tooLarge' in s)) {
    return { ok: true, value: { kind: 'image-diff', path: q.path, mime, tooLarge: true } }
  }
  const old64 = sides[0] !== undefined && !('tooLarge' in sides[0]) ? sides[0].data : undefined
  const new64 = sides[1] !== undefined && !('tooLarge' in sides[1]) ? sides[1].data : undefined
  return {
    ok: true,
    value: {
      kind: 'image-diff', path: q.path, mime,
      ...(old64 !== undefined ? { old: `data:${mime};base64,${old64}` } : {}),
      ...(new64 !== undefined ? { new: `data:${mime};base64,${new64}` } : {}),
    },
  }
}

/** Resolve `<rev>:<path>` to a full object id; absent spec → undefined. */
async function resolveOid(deps: SnapshotDeps, root: string, spec: string): Promise<string | undefined> {
  const res = await runCommand(deps.run, ['git', 'rev-parse', '--verify', '--quiet', spec], root, 'image-oid', deps.signal)
  if (!('run' in res) || res.run.exitCode !== 0) return undefined
  const oid = res.run.stdout.trim()
  return /^[0-9a-f]{40}$|^[0-9a-f]{64}$/.test(oid) ? oid : undefined
}

async function absoluteGitDir(deps: SnapshotDeps, root: string): Promise<string> {
  const res = await runCommand(deps.run, ['git', 'rev-parse', '--absolute-git-dir'], root, 'git-dir', deps.signal)
  if (!('run' in res) || res.run.exitCode !== 0) throw new Error('git dir unavailable')
  return res.run.stdout.trim()
}

/**
 * Raw blob bytes: `unpack-file` writes the object to a temp file (stdout is a
 * lossy utf8 decode and cannot carry binary), created in the git dir — which
 * must be the cwd so the temp file never shows up as an untracked worktree
 * entry. The printed name is charset-checked before it is joined and read.
 */
async function blobSide(deps: SnapshotDeps, gitDir: string, oid: string, cap: number): Promise<ImageSide> {
  const sizeRes = await runCommand(deps.run, ['git', 'cat-file', '-s', oid], gitDir, 'image-size', deps.signal)
  if (!('run' in sizeRes) || sizeRes.run.exitCode !== 0) return undefined
  const size = Number(sizeRes.run.stdout.trim())
  if (!Number.isFinite(size)) return undefined
  if (size > cap) return { tooLarge: true }
  const nameRes = await runCommand(deps.run, ['git', 'unpack-file', oid], gitDir, 'image-unpack', deps.signal)
  if (!('run' in nameRes) || nameRes.run.exitCode !== 0) return undefined
  const name = nameRes.run.stdout.trim()
  if (!/^[A-Za-z0-9._-]+$/.test(name)) return undefined
  const file = join(gitDir, name)
  try {
    const buf = await deps.fs.readFile(file)
    if (buf.length > cap) return { tooLarge: true }
    return { data: buf.toString('base64') }
  } catch {
    return undefined
  } finally {
    await deps.fs.remove(file).catch(() => {})
  }
}

/** The working-tree file (absent when deleted). */
async function worktreeSide(deps: SnapshotDeps, root: string, path: string, cap: number): Promise<ImageSide> {
  try {
    const file = join(root, path)
    const info = await deps.fs.stat(file)
    if (info.size > cap) return { tooLarge: true }
    const buf = await deps.fs.readFile(file)
    if (buf.length > cap) return { tooLarge: true }
    return { data: buf.toString('base64') }
  } catch {
    return undefined
  }
}

async function queryShow(deps: SnapshotDeps, root: string, ref: string): Promise<GitQueryResponse> {
  if (!isSafeRev(ref)) return { ok: false, error: { code: 'invalid-name', message: `unsafe ref: ${ref}` } }
  const metaFormat = '--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1f%b'
  const [metaRes, statRes] = await Promise.all([
    runCommand(deps.run, ['git', 'show', '-s', metaFormat, '--end-of-options', ref], root, 'show-meta', deps.signal),
    runCommand(deps.run, ['git', 'show', '--name-status', '-z', '--format=', '--end-of-options', ref], root, 'show-stat', deps.signal),
  ])
  if (!('run' in metaRes)) return { ok: false, error: { code: 'git-unavailable' } }
  if (metaRes.run.cancelled) return { ok: false, error: { code: 'cancelled' } }
  if (metaRes.run.timedOut) return { ok: false, error: { code: 'timeout' } }
  if (metaRes.run.exitCode !== 0) {
    return { ok: false, error: { code: 'git-error', message: metaRes.run.stderr.trim() || 'unknown ref' } }
  }
  const parts = metaRes.run.stdout.split('\x1f')
  let commit: GitCommit | null = null
  let body = ''
  if (parts.length >= 5 && parts[0]) {
    commit = {
      hash: parts[0]!,
      shortHash: parts[1] ?? '',
      subject: parts[2] ?? '',
      author: parts[3] ?? '',
      dateIso: parts[4] ?? '',
    }
    body = (parts[5] ?? '').trim()
  }
  const stats: GitFileStat[] = 'run' in statRes && statRes.run.exitCode === 0
    ? parseNameStatus(statRes.run.stdout)
    : []
  return { ok: true, value: { kind: 'show', ref, commit, body, stats } }
}

async function queryBranches(deps: SnapshotDeps, root: string): Promise<GitQueryResponse> {
  const fmt = '--format=%(refname:short)%00%(objectname:short)%00%(upstream:track)'
  const [localRes, remoteRes, currentRes, defaultRes] = await Promise.all([
    runCommand(deps.run, ['git', 'for-each-ref', '--sort=-committerdate', fmt, 'refs/heads'], root, 'branches-local', deps.signal),
    runCommand(deps.run, ['git', 'for-each-ref', '--sort=-committerdate', fmt, 'refs/remotes'], root, 'branches-remote', deps.signal),
    runCommand(deps.run, ['git', 'symbolic-ref', '--quiet', '--short', 'HEAD'], root, 'branch-current', deps.signal),
    runCommand(deps.run, ['git', 'symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], root, 'branch-default', deps.signal),
  ])
  const local: GitBranch[] = 'run' in localRes && localRes.run.exitCode === 0 ? parseBranches(localRes.run.stdout) : []
  const remote: GitBranch[] = 'run' in remoteRes && remoteRes.run.exitCode === 0
    ? parseBranches(remoteRes.run.stdout).filter((b) => !b.name.endsWith('/HEAD'))
    : []
  const current = 'run' in currentRes && currentRes.run.exitCode === 0 ? currentRes.run.stdout.trim() || null : null
  let defaultBranch: string | null = null
  if ('run' in defaultRes && defaultRes.run.exitCode === 0) {
    const raw = defaultRes.run.stdout.trim()
    defaultBranch = raw.replace(/^origin\//, '') || null
  }
  return { ok: true, value: { kind: 'branches', current, defaultBranch, local, remote } }
}

async function queryTags(deps: SnapshotDeps, root: string): Promise<GitQueryResponse> {
  const res = await runCommand(deps.run, ['git', 'for-each-ref', '--sort=-creatordate', '--format=%(refname:short)%00%(objectname:short)', 'refs/tags'], root, 'tags', deps.signal)
  const tags: GitBranch[] = 'run' in res && res.run.exitCode === 0
    ? res.run.stdout.split('\n').flatMap((line) => {
        if (line.trim() === '') return []
        const [name, shortHash = ''] = line.split('\0')
        return name ? [{ name, shortHash: shortHash === '' ? null : shortHash }] : []
      })
    : []
  return { ok: true, value: { kind: 'tags', tags } }
}

async function queryAuthors(deps: SnapshotDeps, root: string): Promise<GitQueryResponse> {
  const res = await runCommand(deps.run, ['git', 'log', '--all', '--format=%an', '--max-count=2000'], root, 'authors', deps.signal)
  const authors = 'run' in res && res.run.exitCode === 0
    ? [...new Set(res.run.stdout.split('\n').map((s) => s.trim()).filter((s) => s !== ''))].sort((a, b) => a.localeCompare(b))
    : []
  return { ok: true, value: { kind: 'authors', authors } }
}

async function queryLastCommitMessage(deps: SnapshotDeps, root: string): Promise<GitQueryResponse> {
  const res = await runCommand(deps.run, ['git', 'log', '-1', '--format=%B'], root, 'last-message', deps.signal)
  const message = 'run' in res && res.run.exitCode === 0 ? res.run.stdout.replace(/\n+$/, '') : ''
  return { ok: true, value: { kind: 'last-commit-message', message } }
}

async function queryWorktreeStats(
  deps: SnapshotDeps,
  config: GitPanelConfig,
  sessionId: string,
): Promise<GitQueryResponse> {
  // The worktree stats now live on the snapshot (single source of git spawns);
  // this endpoint just reads them so a bare stats request stays cheap.
  const snapshot = await snapshotForSession(deps, config, sessionId)
  if (!snapshot.ok) return { ok: false, error: { code: 'git-error', message: 'snapshot failed' } }
  return { ok: true, value: { kind: 'worktree-stats', stats: snapshot.value.stats } }
}
