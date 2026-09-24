/**
 * Read-only query endpoint: history / diff / show / branches / tags / authors
 * / last-commit-message / worktree-stats.
 */
import type { SnapshotDeps, GitPanelConfig } from './core.ts'
import { maxChangeMtime, resolveWorkspace, runCommand, snapshotForSession } from './core.ts'
import { isSafePath } from './actions.ts'
import { parseBranches, parseGraphLog, parseNameStatus, sumNumstat } from './parser.ts'
import type { GitBranch, GitCommit, GitFileStat, GitQueryRequest, GitQueryResponse, GraphCommit, WorktreeStats } from './types.ts'

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
        code: error.code === 'not-a-git-repo' || error.code === 'cwd-unavailable' || error.code === 'session-not-found' || error.code === 'timeout' || error.code === 'git-unavailable'
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
      case 'show': return await queryShow(deps, root, q.ref)
      case 'branches': return await queryBranches(deps, root)
      case 'tags': return await queryTags(deps, root)
      case 'authors': return await queryAuthors(deps, root)
      case 'last-commit-message': return await queryLastCommitMessage(deps, root)
      case 'worktree-stats': return await queryWorktreeStats(deps, config, root, request.sessionId)
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
  const args = ['git', 'log', GRAPH_FORMAT, `--max-count=${q.limit}`, `--skip=${q.skip}`]
  const search = q.search?.trim() ?? ''
  const hexJump = search !== '' && isHexLike(search)
  const countArgs = ['git', 'rev-list', '--count']
  if (!hexJump) {
    if (q.ref !== undefined && q.ref !== '') { args.push(q.ref); countArgs.push(q.ref) }
    else { args.push('--all'); countArgs.push('--all') }
    if (search !== '') { args.push('-i', '-E', `--grep=${search}`); countArgs.push('-i', '-E', `--grep=${search}`) }
    if (q.author !== undefined && q.author !== '') { args.push(`--author=${q.author}`); countArgs.push(`--author=${q.author}`) }
    if (q.since !== undefined && q.since !== '') { args.push(`--since=${q.since}`); countArgs.push(`--since=${q.since}`) }
  } else {
    // Hash jump: log from the commit itself.
    args.push(search)
  }
  // Run the page log and the total count concurrently (the count is a second
  // full history walk; serializing it roughly doubled the first-page latency).
  const [res, countRes] = await Promise.all([
    runCommand(deps.run, args, root, 'history', deps.signal),
    hexJump ? Promise.resolve(null) : runCommand(deps.run, countArgs, root, 'history-count', deps.signal),
  ])
  if (!('run' in res)) return { ok: false, error: { code: 'git-unavailable' } }
  if (res.run.timedOut) return { ok: false, error: { code: 'timeout' } }
  if (res.run.exitCode !== 0) {
    // A hash-jump miss or bad ref → empty result, not a hard error.
    return { ok: true, value: { kind: 'history', commits: [], total: 0 } }
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
  let args: string[]
  if (q.base === 'staged') {
    args = ['git', 'diff', '--cached', '--', q.path]
  } else if (q.base === 'commit') {
    args = ['git', 'show', `${q.commit}`, '--', q.path]
  } else {
    // worktree: unstaged diff; for untracked files use --no-index against /dev/null.
    args = ['git', 'diff', '--', q.path]
  }
  const res = await runCommand(deps.run, args, root, 'diff', deps.signal)
  if (!('run' in res)) return { ok: false, error: { code: 'git-unavailable' } }
  if (res.run.timedOut) return { ok: false, error: { code: 'timeout' } }
  let text = res.run.stdout
  // Untracked file: `git diff` yields nothing; synthesize with --no-index.
  if (q.base === 'worktree' && text.trim() === '') {
    const noIndex = await runCommand(deps.run, ['git', 'diff', '--no-index', '--', '/dev/null', q.path], root, 'diff-untracked', deps.signal)
    if ('run' in noIndex) text = noIndex.run.stdout
  }
  return { ok: true, value: { kind: 'diff', path: q.path, text } }
}

async function queryShow(deps: SnapshotDeps, root: string, ref: string): Promise<GitQueryResponse> {
  const metaFormat = '--format=%H%x1f%h%x1f%s%x1f%an%x1f%aI%x1f%b'
  const [metaRes, statRes] = await Promise.all([
    runCommand(deps.run, ['git', 'show', '-s', metaFormat, ref], root, 'show-meta', deps.signal),
    runCommand(deps.run, ['git', 'show', '--name-status', '-z', '--format=', ref], root, 'show-stat', deps.signal),
  ])
  if (!('run' in metaRes)) return { ok: false, error: { code: 'git-unavailable' } }
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
  root: string,
  sessionId: string,
): Promise<GitQueryResponse> {
  const snapshot = await snapshotForSession(deps, config, sessionId)
  if (!snapshot.ok) return { ok: false, error: { code: 'git-error', message: 'snapshot failed' } }
  const snap = snapshot.value
  const distinct = new Set(snap.changes.map((c) => c.path))

  const [worktreeNum, stagedNum, headTime] = await Promise.all([
    runCommand(deps.run, ['git', 'diff', '--numstat'], root, 'numstat-worktree', deps.signal),
    runCommand(deps.run, ['git', 'diff', '--numstat', '--cached'], root, 'numstat-staged', deps.signal),
    runCommand(deps.run, ['git', 'log', '-1', '--format=%aI'], root, 'head-time', deps.signal),
  ])
  const a = 'run' in worktreeNum && worktreeNum.run.exitCode === 0 ? sumNumstat(worktreeNum.run.stdout) : { insertions: 0, deletions: 0 }
  const b = 'run' in stagedNum && stagedNum.run.exitCode === 0 ? sumNumstat(stagedNum.run.stdout) : { insertions: 0, deletions: 0 }

  // Untracked files: count their lines as insertions (best effort, binary skipped).
  let untrackedInsertions = 0
  const untrackedPaths = snap.changes.filter((c) => c.status === 'untracked' && !c.isDirectory).map((c) => c.path)
  if (untrackedPaths.length > 0) {
    const safe = untrackedPaths.filter(isSafePath).slice(0, 200)
    if (safe.length > 0) {
      const noIndex = await runCommand(deps.run, ['git', 'diff', '--numstat', '--no-index', '--', '/dev/null', ...safe], root, 'numstat-untracked', deps.signal)
      if ('run' in noIndex) untrackedInsertions = sumNumstat(noIndex.run.stdout).insertions
    }
  }

  const lastChangeAt = await maxChangeMtime(deps, root, snap.changes)
  const headCommittedAt = 'run' in headTime && headTime.run.exitCode === 0 ? headTime.run.stdout.trim() || null : null

  const stats: WorktreeStats = {
    fileCount: distinct.size,
    staged: snap.staged,
    modified: snap.modified,
    untracked: snap.untracked,
    insertions: a.insertions + b.insertions + untrackedInsertions,
    deletions: a.deletions + b.deletions,
    lastChangeAt,
    headCommittedAt,
  }
  return { ok: true, value: { kind: 'worktree-stats', stats } }
}
