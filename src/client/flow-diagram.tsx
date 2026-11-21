import { createElement as h, useId } from 'react'
import type { JSX } from 'react'
import { DEVELOP_BRANCH, FLOW_PREFIX, flowPreviewChain, flowPreviewRemotes, type FlowPreview, type FlowPreviewNode, type FlowPreviewRoute } from './flow.js'
import type { OpT } from './ops-modals.js'

function BranchNode({ node, tag, remote = false, t }: {
  readonly node: FlowPreviewNode
  readonly tag?: string | undefined
  readonly remote?: boolean
  readonly t: OpT
}): JSX.Element {
  const state = node.state === 'created'
    ? ' gp-flow-map__node--new'
    : node.state === 'deleted' ? ' gp-flow-map__node--gone' : ''
  return h('div', {
    className: `gp-flow-map__node gp-flow-map__node--${node.lane}${state}${remote ? ' gp-flow-map__node--remote' : ''}`,
  }, [
    h('i', { key: 'dot', className: 'gp-flow-map__dot', 'aria-hidden': true }),
    h('span', { key: 'name', className: 'gp-flow-map__name' }, node.name),
    tag === undefined ? null : h('span', { key: 'tag', className: 'gp-flow-map__tag', title: t('flow.preview.keyTag') }, [
      h('span', { key: 'label', className: 'gp-flow-map__tag-label' }, `${t('flow.preview.keyTag')} `),
      h('span', { key: 'hash', 'aria-hidden': true }, '#'),
      tag,
    ]),
  ])
}

function Arrow({ vertical = false }: { readonly vertical?: boolean }): JSX.Element {
  return h('svg', {
    className: `gp-flow-arrow${vertical ? ' gp-flow-arrow--down' : ''}`,
    width: 22, height: 12, viewBox: '0 0 22 12', 'aria-hidden': true, focusable: 'false',
  }, h('path', { d: 'M1 6h19m-5-4 5 4-5 4', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }))
}

function routeLabel(route: FlowPreviewRoute, t: OpT, mergeLabel: string | undefined): string {
  switch (route.action) {
    case 'checkout': return t('flow.preview.checkout')
    case 'merge': return mergeLabel ?? t('flow.preview.actionMerge')
    case 'squash': return t('flow.preview.actionSquash')
    case 'rebase': return t('flow.preview.actionRebase')
    case 'backMerge': return t('flow.preview.backMerge')
    case null: return t('flow.preview.keyCreated')
  }
}

export function FlowPreviewDiagram({ preview, errorText, remoteName = null, remoteBranches = [], mergeLabel, t }: {
  readonly preview: FlowPreview
  readonly errorText?: string | null
  readonly remoteName?: string | null
  readonly remoteBranches?: readonly string[]
  readonly mergeLabel?: string
  readonly t: OpT
}): JSX.Element {
  const nodes = flowPreviewChain(preview.routes)
  const remotes = flowPreviewRemotes(preview.ops, remoteName)
  const publishedTags = preview.ops.flatMap((op) => op.kind === 'push'
    ? (op.refs ?? []).filter((ref) => ref.startsWith('refs/tags/')).map((ref) => ref.slice('refs/tags/'.length))
    : [])
  const deleteLocal = preview.ops.find((op) => op.kind === 'delete')
  const remoteRefs = new Set(remoteBranches)
  const columns = nodes.flatMap((node, index) => {
    const step = preview.routes[index]
    const tag = preview.routes[index - 1]?.tag
    const column = h('div', { key: `node-${index}`, className: 'gp-flow-chain__col' }, [
      h(BranchNode, { key: 'local', node, tag, t }),
      node.state === 'deleted' ? h('span', { key: 'delete', className: 'gp-flow-map__delete' },
        t(deleteLocal?.force === true ? 'flow.preview.opDeleteForce' : 'flow.preview.opDelete')) : null,
      ...remotes.filter((remote) => remote.branch === node.name).map((remote) =>
        h('div', { key: `${remote.deleted}:${remote.ref}`, className: 'gp-flow-chain__remote' }, [
          h('div', { key: 'edge', className: `gp-flow-chain__v${remote.deleted ? ' gp-flow-chain__v--del' : ''}` }, [
            h(Arrow, { key: 'arrow', vertical: true }),
            h('span', { key: 'label' }, t(remote.deleted ? 'flow.preview.opDeleteRemote' : 'flow.preview.opPush')),
          ]),
          h(BranchNode, { key: 'remote', remote: true, t, node: {
            name: remote.ref, lane: 'other',
            state: remote.deleted ? 'deleted' : remoteRefs.has(remote.ref) ? 'existing' : 'created',
          } }),
        ])),
    ])
    if (step === undefined) return [column]
    return [column, h('div', { key: `edge-${index}`, className: 'gp-flow-chain__h', 'data-action': step.action ?? 'create' }, [
      h('span', { key: 'label' }, routeLabel(step, t, mergeLabel)),
      h(Arrow, { key: 'arrow' }),
    ])]
  })
  return h('div', { className: 'gp-flow-map', role: 'group', 'aria-label': t('flow.preview.title') }, [
    h('div', { key: 'head', className: 'gp-flow-map__head' }, t('flow.preview.title')),
    h('div', { key: 'chain', className: `gp-flow-chain gp-flow-chain--${nodes.length}` }, columns),
    publishedTags.length === 0 ? null : h('div', { key: 'tags', className: 'gp-flow-map__publish-tags' }, [
      h('span', { key: 'label' }, `${t('flow.preview.opPush')} · ${t('flow.preview.keyTag')}`),
      ...publishedTags.map((tag) => h('code', { key: tag }, tag)),
    ]),
    !errorText ? null : h('div', { key: 'error', className: 'gp-flow-map__note', role: 'alert' }, errorText),
  ])
}

const MAINLINE = 'main/master'
const LANES = [
  { kind: 'hotfix', label: `${FLOW_PREFIX.hotfix}*`, y: 29 },
  { kind: 'main', label: MAINLINE, y: 77 },
  { kind: 'release', label: `${FLOW_PREFIX.release}*`, y: 119 },
  { kind: 'develop', label: DEVELOP_BRANCH, y: 169 },
  { kind: 'feature', label: `${FLOW_PREFIX.feature}*`, y: 211 },
] as const

/** Canonical Git Flow reading order. Time runs left to right, with tags on the
 * release line and dashed return paths for the mainline back-merges. */
const EXAMPLE_EDGES = [
  { id: 'main', lane: 'main', path: 'M119 77H406' },
  { id: 'develop', lane: 'develop', path: 'M119 169H406' },
  { id: 'feature', lane: 'feature', path: 'M127 169L151 211H176L200 169' },
  { id: 'release', lane: 'release', path: 'M210 169L234 119H258L282 77' },
  { id: 'release-back', lane: 'release', path: 'M282 77L322 169' },
  { id: 'hotfix', lane: 'hotfix', path: 'M312 77L336 29H352L376 77' },
  { id: 'hotfix-back', lane: 'hotfix', path: 'M376 77L403 169' },
] as const

const EXAMPLE_NODES = [
  { lane: 'develop', x: 127, y: 169 }, { lane: 'feature', x: 159, y: 211 },
  { lane: 'develop', x: 200, y: 169 }, { lane: 'develop', x: 210, y: 169 },
  { lane: 'release', x: 248, y: 119 }, { lane: 'main', x: 282, y: 77, tag: 'v1.2.0' },
  { lane: 'develop', x: 322, y: 169 }, { lane: 'main', x: 312, y: 77 },
  { lane: 'hotfix', x: 346, y: 29 }, { lane: 'main', x: 376, y: 77, tag: 'v1.2.1' },
  { lane: 'develop', x: 403, y: 169 },
] as const

export function FlowAboutDiagram({ t }: { readonly t: OpT }): JSX.Element {
  const id = useId()
  const summary = [
    `${t('flow.about.feature')} · ${DEVELOP_BRANCH} → ${FLOW_PREFIX.feature}* → ${DEVELOP_BRANCH}`,
    `${t('flow.about.release')} · ${DEVELOP_BRANCH} → ${FLOW_PREFIX.release}* → ${MAINLINE} (${t('flow.about.tag')}) → ${DEVELOP_BRANCH}`,
    `${t('flow.about.hotfix')} · ${MAINLINE} → ${FLOW_PREFIX.hotfix}* → ${MAINLINE} (${t('flow.about.tag')}) → ${DEVELOP_BRANCH}`,
  ].join('. ')
  return h('figure', { className: 'gp-flow-about__diagram' }, [
    h('figcaption', { key: 'caption', id: `${id}-caption` }, t('flow.about.workflow')),
    h('svg', { key: 'graph', viewBox: '0 0 418 228', role: 'img', 'aria-labelledby': `${id}-caption`, 'aria-describedby': `${id}-desc` }, [
      h('desc', { key: 'desc', id: `${id}-desc` }, summary),
      ...LANES.map(({ kind, label, y }) => h('g', { key: kind, className: `gp-flow-about__lane--${kind}` }, [
        h('path', { key: 'guide', d: `M113 ${y}H406`, className: 'gp-flow-about__guide' }),
        h('text', { key: 'label', x: 4, y, className: 'gp-flow-about__lane-label', dominantBaseline: 'central' }, label),
      ])),
      ...EXAMPLE_EDGES.map(({ id: edgeId, lane, path }) => h('path', {
        key: edgeId, d: path,
        className: `gp-flow-about__edge gp-flow-about__lane--${lane}${edgeId.endsWith('-back') ? ' gp-flow-about__edge--back' : ''}`,
      })),
      ...EXAMPLE_NODES.map((node) => h('g', { key: `${node.x},${node.y}`, className: `gp-flow-about__lane--${node.lane}` }, [
        h('circle', { key: 'dot', className: 'gp-flow-about__dot', cx: node.x, cy: node.y, r: 3.5 }),
        'tag' in node ? h('text', { key: 'tag', className: 'gp-flow-about__version', x: node.x, y: node.y - 10, textAnchor: 'middle' }, node.tag) : null,
      ])),
    ]),
    h('div', { key: 'legend', className: 'gp-flow-about__legend', 'aria-hidden': true }, [
      h('span', { key: 'tag', className: 'gp-flow-about__legend-tag' }, t('flow.preview.keyTag')),
      h('span', { key: 'back', className: 'gp-flow-about__legend-back' }, t('flow.preview.backMerge')),
    ]),
  ])
}
