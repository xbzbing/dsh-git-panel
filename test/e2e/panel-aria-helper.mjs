/**
 * Injected by clean-states-scenario.mjs with addScriptTag (classic script, no module imports).
 *
 * Regression for the sub-tab ARIA panel relationship: EVERY visible tab must own
 * a resolvable `role="tabpanel"` in EVERY view state — ready, loading, no-cwd,
 * generic error, non-git files-only, git-unavailable files-only and no-session
 * alike — so a tab's `aria-controls` never dangles. It also pins the lazy-mount
 * contract: the panel node exists for every tab, but only the visited tab's pane
 * carries content.
 *
 * Each scenario mounts its own root, is audited, then settles any held snapshot,
 * unmounts and drops its host — so no extra root keeps subscriptions or
 * whole-page queries alive for the next scenario.
 *
 * Assertions are made on the rendered DOM only (never on plugin source).
 * Exposes `window.runPanelAriaScenarios({ snap, nonGitDir })` -> result.
 */
window.runPanelAriaScenarios = async ({ snap, nonGitDir }) => {
  const entry = window.__getLoaded()
  const ReactDOM = window.ReactDOM
  const registered = {}
  const result = {}

  const mkCtx = (conn) => {
    const ctx = {
      get: (k) => (k === 'connection' ? conn : undefined),
      effect: (cb) => { try { cb() } catch { /* ignore */ } },
      on: () => () => {},
      inject: (_d, cb) => cb(ctx),
      slots: { inject: (_n, p) => p(), register: (reg, component) => { registered[reg.name] = { reg, component }; return () => {} } },
      locale: { register: () => () => {}, bind: () => (k) => k },
    }
    return ctx
  }

  const okValue = (value) => ({ ok: true, value: { ok: true, value } })
  const bizError = (error) => ({ ok: true, value: { ok: false, error } })
  const branches = { kind: 'branches', current: 'main', defaultBranch: null, local: [], remote: [] }

  // Minimal, kind-correct answers so a mounted tab renders without failing.
  const answerQuery = (request) => {
    const q = (request && request.query) || {}
    switch (q.kind) {
      case 'branches': return okValue(branches)
      case 'tags': return okValue({ kind: 'tags', tags: [] })
      case 'authors': return okValue({ kind: 'authors', authors: [] })
      case 'history': return okValue({ kind: 'history', total: 0, commits: [] })
      case 'dir-list': return okValue({ kind: 'dir-list', path: q.path ?? '', truncated: false, entries: [] })
      case 'stash-list': return okValue({ kind: 'stash-list', entries: [] })
      case 'repo-list': return okValue({ kind: 'repo-list', cwd: '', repos: [] })
      default: return okValue({ kind: q.kind ?? 'branches' })
    }
  }

  // One connection per scenario: only the snapshot reply varies.
  const connection = (snapshotReply) => ({
    rpc: {
      call: async (_channel, endpoint, payload) => {
        const request = payload && payload.args && payload.args.request
        if (endpoint === 'dbGitPanel/snapshot') return snapshotReply()
        if (endpoint === 'dbGitPanel/query') return answerQuery(request)
        if (endpoint === 'dbGitPanel/version') return { ok: true, value: { current: '0.0.0', checkedRemote: false } }
        if (endpoint === 'dbGitPanel/suggest') return { ok: true, value: { ok: true, value: { message: '', truncated: false } } }
        return okValue(branches)
      },
    },
  })

  // One audit over a mounted panel host. Panes are resolved inside that host, so
  // a scenario root can never leak into another scenario's audit.
  const audit = (host) => {
    const tabs = [...host.querySelectorAll('[role="tab"]')]
    const paneOf = (tab) => {
      const controls = tab.getAttribute('aria-controls')
      return controls === null ? null : host.querySelector('#' + CSS.escape(controls))
    }
    const rows = tabs.map((tab) => {
      const pane = paneOf(tab)
      return {
        label: tab.querySelector('.gp-tab__label')?.textContent ?? null,
        resolves: pane !== null && pane.getAttribute('role') === 'tabpanel',
        labelledByTab: pane !== null && pane.getAttribute('aria-labelledby') === tab.id,
        selected: tab.getAttribute('aria-selected') === 'true',
        paneShown: pane !== null && pane.style.display === 'contents',
        paneHasContent: pane !== null && pane.children.length > 0,
      }
    })
    const contentByLabel = {}
    for (const row of rows) contentByLabel[row.label] = row.paneHasContent
    // The state placeholder is the shown pane's own DIRECT child; a mounted tab
    // renders its own (deeper) .gp-empty, so only direct children count here.
    const shownPane = tabs.map(paneOf).find((p) => p !== null && p.style.display === 'contents') ?? null
    const statePlaceholder = shownPane === null
      ? null
      : [...shownPane.children].find((el) => el.classList.contains('gp-empty')) ?? null
    return {
      tabCount: tabs.length,
      everyTabResolves: rows.length > 0 && rows.every((r) => r.resolves),
      everyPaneLabelledByOwnTab: rows.length > 0 && rows.every((r) => r.labelledByTab),
      exactlyOneSelected: rows.filter((r) => r.selected).length === 1,
      selectionMatchesShownPane: rows.every((r) => (r.selected ? r.paneShown : !r.paneShown)),
      statePlaceholderText: statePlaceholder?.textContent ?? null,
      noticeText: host.querySelector('.gp-notice')?.textContent ?? null,
      contentByLabel,
    }
  }

  // Mount one scenario, audit it, settle anything held, then unmount and drop the
  // host so the next scenario starts from a clean page.
  const scenario = async (key, makeReply, sessionId, settle) => {
    entry.apply(mkCtx(connection(makeReply)))
    const host = document.createElement('div')
    host.id = 'aria-scenario-' + key
    document.body.appendChild(host)
    const root = ReactDOM.createRoot(host)
    root.render(registered['conversation.view'].component({ sessionId }))
    await new Promise((r) => setTimeout(r, 350))
    const state = audit(host)
    if (settle !== undefined) { settle(); await new Promise((r) => setTimeout(r, 80)) }
    root.unmount()
    host.remove()
    return state
  }

  // ready: a clean repo resolves, defaults to Overview and mounts only its pane.
  result.ready = await scenario('ready', () => okValue(snap), 'aria-ready')

  // loading: the snapshot is held until after the audit, then released so the
  // controller has nothing in flight when the root unmounts.
  let releaseLoading = null
  result.loading = await scenario(
    'loading',
    () => new Promise((resolve) => { releaseLoading = resolve }),
    'aria-loading',
    () => { if (releaseLoading !== null) releaseLoading(okValue(snap)) },
  )

  // no-cwd: a terminal code maps to the no-cwd state.
  result.noCwd = await scenario('no-cwd', () => bizError({ code: 'cwd-unavailable' }), 'aria-no-cwd')

  // error: a non-files-only failure keeps the three git tabs and shows the
  // unavailable placeholder.
  result.error = await scenario('error', () => bizError({ code: 'git-error', detail: 'boom' }), 'aria-error')

  // filesOnly: a non-git directory exposes the Files tab alone, with no notice.
  result.filesOnly = await scenario('files-only', () => bizError({ code: 'not-a-git-repo', cwd: nonGitDir }), 'aria-files-only')

  // filesOnly + git-unavailable inside a repo: same single tab, plus the
  // "git not installed" notice stacked above the browser.
  result.gitUnavailable = await scenario('git-unavailable', () => bizError({ code: 'git-unavailable', isGitRepo: true }), 'aria-git-unavailable')

  // no session: the panel still renders its tab list and panels.
  result.noSession = await scenario('no-session', () => okValue(snap), undefined)

  return result
}
