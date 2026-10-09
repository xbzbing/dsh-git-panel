/**
 * 差分模糊测试：插件 layoutGraph 的列布局 vs 真实 `git log --graph`。
 *
 * 方法：mulberry32 定种生成 200 个随机 DAG（8~21 提交、35% 概率合并、
 * ~30% 提交挂分支），用 git commit-tree 建仓，同一 refset
 * （--branches --remotes --tags HEAD）+ --topo-order 分别取 git ASCII 图与
 * 插件 GRAPH_FORMAT，逐提交比较落位列号与图宽度（git 宽度按全部图字符
 * 计，含纯边列）。
 *
 * 用法：node test/manual/diff-graph.mjs   （需先 node build.mjs 出 testkit）
 * 结果会随 commit 时间戳（topo 平局排序）在轮次间轻微波动。
 *
 * 判定（对齐 PR #11 第三方评审结论）：提交集合/顺序漂移与「插件比 git
 * 宽」（issue #9 式幻影超宽）为 fatal；列号策略差异（汇聚目标车道先认
 * 领者保留 vs git 重编号）只计数——评审实测 135/200 轮列号分歧、连接
 * 关系等价非缺陷，宽度 0 轮插件更宽。
 *
 * 评审归档原版：docs/local/verify/diff-graph.mjs（2026-10-09）。
 */
import { execSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseGraphLog, layoutGraph, graphWidth } from '../../lib/testkit.mjs'

const GRAPH_FORMAT = '--format=%H%x1f%h%x1f%P%x1f%an%x1f%aI%x1f%D%x1f%s%x1e'
const REFS = ['--branches', '--remotes', '--tags', 'HEAD']


function sh(cmd, cwd) { return execSync(cmd, { cwd, encoding: 'utf8' }) }

function buildRepo(rng) {
  const dir = mkdtempSync(join(tmpdir(), 'gdiff-'))
  sh('git init -q', dir)
  sh('git config user.email t@t.co && git config user.name T', dir)
  const emptyTree = sh('git hash-object -t tree /dev/null', dir).trim()
  const commits = []
  const n = 8 + Math.floor(rng() * 14)
  for (let i = 0; i < n; i++) {
    const ps = []
    if (i > 0) {
      ps.push(commits[Math.floor(rng() * i)])
      if (i > 1 && rng() < 0.35) {
        const b = commits[Math.floor(rng() * i)]
        if (b !== ps[0]) ps.push(b)
      }
    }
    const args = ps.map((p) => `-p ${p}`).join(' ')
    commits.push(sh(`git commit-tree ${emptyTree} ${args} -m "c${i}"`, dir).trim())
  }
  let branches = 0
  for (let i = 0; i < commits.length; i++) {
    if (rng() < 0.3) { sh(`git branch b${i} ${commits[i]}`, dir); branches++ }
  }
  if (branches === 0) sh(`git branch main ${commits[commits.length - 1]}`, dir)
  else sh(`git branch -f main ${commits[commits.length - 1]}`, dir)
  return dir
}

// git 图列宽 2 字符；提交标记 `*` 落在偶数偏移。宽度按全部图字符
// （|/\*）计，覆盖不含提交的纯边列；hex 文本不含图字符，扫描安全。
function gitColumns(dir) {
  const out = sh(`git log --graph --format='%H' --topo-order ${REFS.join(' ')}`, dir)
  const map = new Map()
  let drawnMax = -1
  for (const line of out.split('\n')) {
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '|' || ch === '/' || ch === '\\' || ch === '*') {
        // 奇数偏移是对角线，跨列 (i-1)/2 → (i+1)/2
        drawnMax = Math.max(drawnMax, i % 2 === 0 ? i / 2 : (i + 1) / 2)
      }
    }
    if (!line.includes('*')) continue
    const hashMatch = line.match(/[0-9a-f]{40}/)
    if (!hashMatch) continue
    const hash = hashMatch[0]
    const idx = line.indexOf('*')
    if (idx % 2 !== 0) throw new Error(`odd graph offset: ${JSON.stringify(line)}`)
    if (map.has(hash)) throw new Error(`duplicate commit line for ${hash}`)
    map.set(hash, idx / 2)
  }
  return { cols: map, drawnWidth: drawnMax + 1 }
}

function pluginColumns(dir) {
  const out = sh(`git log --topo-order ${GRAPH_FORMAT} ${REFS.join(' ')}`, dir)
  const commits = parseGraphLog(out)
  const rows = layoutGraph(commits)
  return { commits, rows, width: graphWidth(rows), raw: out }
}

function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
}

let orderMismatch = 0   // fatal: commit set/order drift vs git
let pluginWider = 0     // fatal: wider than git (issue #9-style phantom width)
let laneDiffRounds = 0  // informational: lane renumbering strategy difference
let gitWiderRounds = 0  // informational: git drew an extra pure-edge column
const ROUNDS = 200
for (let round = 0; round < ROUNDS; round++) {
  const rng = mulberry32(round + 1)
  const dir = buildRepo(rng)
  try {
    const gitRaw = sh(`git log --graph --format='%H' --topo-order ${REFS.join(' ')}`, dir)
    const { cols: gitCols, drawnWidth: gitDrawnWidth } = gitColumns(dir)
    const { commits, rows, width, raw } = pluginColumns(dir)
    const gitOrder = [...gitCols.keys()]
    const pluginOrder = commits.map((c) => c.hash)
    if (JSON.stringify(gitOrder) !== JSON.stringify(pluginOrder)) {
      orderMismatch++
      console.log(`round ${round}: COMMIT SET/ORDER MISMATCH git=${gitOrder.length} plugin=${pluginOrder.length}`)
      if (orderMismatch === 1) {
        console.log('=== git graph raw ===')
        console.log(gitRaw.split('\n').map((l) => JSON.stringify(l)).join('\n'))
        console.log('=== plugin raw ===')
        console.log(raw.split('\x1e').map((l) => JSON.stringify(l.slice(0, 120))).join('\n'))
      }
      continue
    }
    let laneDiffs = 0
    for (const row of rows) {
      const expect = gitCols.get(row.commit.hash)
      if (expect !== undefined && expect !== row.lane) laneDiffs++
    }
    if (laneDiffs > 0) laneDiffRounds++
    if (width > gitDrawnWidth) {
      pluginWider++
      console.log(`round ${round}: PHANTOM WIDTH git=${gitDrawnWidth} plugin=${width}`)
    } else if (width < gitDrawnWidth) {
      gitWiderRounds++
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
console.log(`order mismatches: ${orderMismatch} (fatal)`)
console.log(`plugin wider than git: ${pluginWider} (fatal, issue #9 regression)`)
console.log(`lane-column strategy diffs: ${laneDiffRounds}/${ROUNDS} rounds (informational, equivalent renumbering)`)
console.log(`git wider (extra pure-edge column): ${gitWiderRounds}/${ROUNDS} rounds (informational)`)
const fatal = orderMismatch + pluginWider
console.log(fatal === 0 ? `PASS: ${ROUNDS} random DAGs — same commit order, no phantom width` : `FAIL: ${fatal} fatal findings`)
process.exit(fatal === 0 ? 0 : 1)
