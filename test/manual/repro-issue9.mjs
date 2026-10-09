/**
 * Reproduce issue #9: run the plugin's exact history query (same GRAPH_FORMAT,
 * no --topo-order) through parseGraphLog + layoutGraph, dump rows/edges, and
 * compare row order against `git log --graph --oneline --all` (topo order).
 */
import { execFileSync } from 'node:child_process'
import { parseGraphLog, layoutGraph, graphWidth } from '../../lib/testkit.mjs'

const repo = process.argv[2] ?? '/tmp/dsh-simple-remote'
const limit = Number(process.argv[3] ?? 100)

// The plugin's history query (post-fix): visible refs + topo order.
const GRAPH_FORMAT = '--format=%H%x1f%h%x1f%P%x1f%an%x1f%aI%x1f%D%x1f%s%x1e'
const raw = execFileSync(
  'git',
  ['log', '--topo-order', GRAPH_FORMAT, `--max-count=${limit}`, '--branches', '--remotes', '--tags'],
  { cwd: repo, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
)
const commits = parseGraphLog(raw)
console.log(`parsed ${commits.length} commits, graphWidth=${graphWidth(layoutGraph(commits))}`)

// Real topology (topo order) for reference.
const topo = execFileSync(
  'git',
  ['log', '--graph', '--format=%h %s', '--topo-order', '--branches', '--remotes', '--tags'],
  { cwd: repo, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
)
const topoLines = topo.split('\n').filter((l) => l.trim() !== '')

// Detect date-order vs topo-order divergence (index of each hash in query order).
const queryOrder = commits.map((c) => c.shortHash)
const topoOrder = topoLines
  .map((l) => l.match(/\*?\s*([0-9a-f]{7,})/)?.[1])
  .filter(Boolean)
console.log('query order :', queryOrder.slice(0, 25).join(' '))
console.log('topo  order :', topoOrder.slice(0, 25).join(' '))
const diverge = queryOrder.some((h, i) => topoOrder[i] !== undefined && topoOrder[i] !== h)
console.log('order diverges from topo:', diverge)

const rows = layoutGraph(commits)
console.log('\n=== rows ===')
for (const [i, r] of rows.entries()) {
  const parentInfo = r.commit.parents.map((p) => p.slice(0, 7)).join(',')
  const edges = r.edges
    .map((e) => (e.fromLane === e.toLane ? `${e.fromLane}┃${e.color}` : `${e.fromLane}→${e.toLane}·${e.color}`))
    .join(' ')
  console.log(
    `#${String(i).padStart(2)} lane=${r.lane} c=${r.color}${r.merge ? ' M' : ''} ` +
    `${r.commit.shortHash} p[${parentInfo}] refs[${r.commit.refs.map((x) => x.name).join(',')}] :: ${edges}`,
  )
}

// Signature detection: same non-straight edge (from,to,color) in >=3 consecutive rows.
let run = 0
let prev = ''
const offenders = []
for (const r of rows) {
  const sig = r.edges
    .filter((e) => e.fromLane !== e.toLane)
    .map((e) => `${e.fromLane}→${e.toLane}·${e.color}`)
    .sort()
    .join(',')
  if (sig !== '' && sig === prev) { run += 1 } else { run = 1; prev = sig }
  if (sig !== '' && run === 3) offenders.push(`rows around ${r.commit.shortHash}: ${sig}`)
}
console.log('\nrepeated-hook signatures (>=3 consecutive rows):')
for (const o of offenders) console.log('  ' + o)
