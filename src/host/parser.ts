/**
 * git output parsers: porcelain status, log, branch, numstat, name-status.
 * Pure functions over raw stdout, no I/O.
 */
import type { GitBranch, GitChange, GitChangeStatus, GitFileStat, GraphCommit, GitRef } from './types.ts'

/** Map a porcelain single-column status char to our status vocabulary. */
function statusOf(code: string): GitChangeStatus {
  switch (code) {
    case 'A': return 'added'
    case 'M': return 'modified'
    case 'D': return 'deleted'
    case 'R': return 'renamed'
    case 'C': return 'added'
    case 'T': return 'typechange'
    case 'U': return 'conflicted'
    case '?': return 'untracked'
    default: return 'modified'
  }
}

/**
 * Parse `git status --porcelain=v1 -z`. A mixed XY (both non-space, e.g. MM)
 * is split into a staged side (X) and an unstaged side (Y). Untracked (??) is
 * a single unstaged entry. Real conflicts (UU/AA/DD…) stay one entry.
 */
export function parseStatus(stdout: string): GitChange[] {
  const out: GitChange[] = []
  const records = stdout.split('\0')
  for (let i = 0; i < records.length; i++) {
    const rec = records[i]
    if (rec === undefined || rec.length < 3) continue
    const x = rec[0]!
    const y = rec[1]!
    let path = rec.slice(3)
    // Renames/copies encode "new\0old" — the old path is the next NUL field.
    if (x === 'R' || x === 'C' || y === 'R' || y === 'C') {
      i++ // consume the old-path field
    }
    const isDirectory = path.endsWith('/')
    if (isDirectory) path = path.replace(/\/+$/, '')
    if (x === '?' && y === '?') {
      out.push({ path, status: 'untracked', staged: false, isDirectory })
      continue
    }
    if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) {
      out.push({ path, status: 'conflicted', staged: false, isDirectory })
      continue
    }
    if (x !== ' ' && x !== '?') {
      out.push({ path, status: statusOf(x), staged: true, isDirectory })
    }
    if (y !== ' ' && y !== '?') {
      out.push({ path, status: statusOf(y), staged: false, isDirectory })
    }
  }
  return out
}

/**
 * Parse a graph log emitted with the record format:
 *   %H%x1f%h%x1f%P%x1f%an%x1f%aI%x1f%D%x1f%s%x1e
 * (unit sep 0x1f between fields, record sep 0x1e between commits.)
 */
export function parseGraphLog(stdout: string): GraphCommit[] {
  const out: GraphCommit[] = []
  for (const record of stdout.split('\x1e')) {
    const rec = record.replace(/^\n+/, '')
    if (rec.trim() === '') continue
    const parts = rec.split('\x1f')
    if (parts.length < 7) continue
    const [hash, shortHash, parentsRaw, author, dateIso, decoration, subject] = parts
    const parents = (parentsRaw ?? '').trim() === '' ? [] : parentsRaw!.trim().split(/\s+/)
    out.push({
      hash: hash ?? '',
      shortHash: shortHash ?? '',
      subject: subject ?? '',
      author: author ?? '',
      dateIso: dateIso ?? '',
      parents,
      refs: parseRefs(decoration ?? ''),
    })
  }
  return out
}

/** Parse the `%D` decoration into structured refs. */
export function parseRefs(decoration: string): GitRef[] {
  const refs: GitRef[] = []
  for (const raw of decoration.split(',')) {
    let token = raw.trim()
    if (token === '') continue
    let head = false
    if (token.startsWith('HEAD -> ')) {
      head = true
      token = token.slice('HEAD -> '.length).trim()
    } else if (token === 'HEAD') {
      continue
    }
    if (token.startsWith('tag: ')) {
      refs.push({ kind: 'tag', name: token.slice('tag: '.length).trim(), head: false })
    } else if (token.startsWith('origin/') || token.includes('/')) {
      refs.push({ kind: 'remote', name: token, head })
    } else {
      refs.push({ kind: 'branch', name: token, head })
    }
  }
  return refs
}

/** Parse `git for-each-ref` local/remote branch lines: `name\0shortHash\0track`. */
export function parseBranches(stdout: string): GitBranch[] {
  const out: GitBranch[] = []
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue
    const [name, shortHash = '', track = ''] = line.split('\0')
    if (name === undefined || name === '') continue
    const branch: { name: string; shortHash: string | null; ahead?: number; behind?: number } = {
      name,
      shortHash: shortHash === '' ? null : shortHash,
    }
    const ahead = /ahead (\d+)/.exec(track)
    const behind = /behind (\d+)/.exec(track)
    if (ahead) branch.ahead = Number(ahead[1])
    if (behind) branch.behind = Number(behind[1])
    out.push(branch)
  }
  return out
}

/** Parse `git show --name-status -z` file lines into stats. */
export function parseNameStatus(stdout: string): GitFileStat[] {
  const out: GitFileStat[] = []
  const tokens = stdout.split('\0')
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]
    if (tok === undefined || tok === '') continue
    const code = tok[0]
    if (code === undefined || !/[AMDRCTU]/.test(code)) continue
    // R/C carry a similarity number; the next token is old, the one after new.
    if (code === 'R' || code === 'C') {
      const newPath = tokens[i + 2]
      i += 2
      if (newPath) out.push({ path: newPath, status: statusOf(code) })
      continue
    }
    const path = tokens[i + 1]
    i += 1
    if (path) out.push({ path, status: statusOf(code) })
  }
  return out
}

/** Sum `git diff --numstat` output: { insertions, deletions }. Binary rows ("-") skipped. */
export function sumNumstat(stdout: string): { insertions: number; deletions: number } {
  let insertions = 0
  let deletions = 0
  for (const line of stdout.split('\n')) {
    if (line.trim() === '') continue
    const parts = line.split('\t')
    if (parts.length < 2) continue
    const add = Number(parts[0])
    const del = Number(parts[1])
    if (Number.isFinite(add)) insertions += add
    if (Number.isFinite(del)) deletions += del
  }
  return { insertions, deletions }
}
