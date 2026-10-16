/** Real Overview controls against run.mjs's parked mock RPC, with no server. */
window.runOverviewFetchScenarios = async (fixture, { waitFor, flushUI, click, releaseAndParkNext }) => {
  const toolbar = () => document.querySelector('.gp-history .gp-toolbar button[title="overview.fetch"]')
  const statusbar = () => document.querySelector('.gp-statusbar button[aria-label="status.check"]')
  const alert = () => document.querySelector('.gp-statusbar [role="alert"]')
  const bothDisabled = () => toolbar()?.disabled === true && statusbar()?.disabled === true
  const bothEnabled = () => toolbar()?.disabled === false && statusbar()?.disabled === false
  const releaseFetch = () => {
    const release = fixture.releaseFetch
    fixture.releaseFetch = null
    release()
  }
  const results = []
  try {
    fixture.holdFetch = true
    for (const [entry, trigger, retry] of [['toolbar', toolbar, statusbar], ['statusbar', statusbar, toolbar]]) {
      fixture.fetchError = { code: entry === 'toolbar' ? 'auth-failed' : 'git-error', message: 'fetch refused: ' + entry }
      const actionsBefore = fixture.actions.length
      click(trigger(), entry + ' failing fetch')
      await waitFor(() => typeof fixture.releaseFetch === 'function' && bothDisabled(), entry + ' shared busy')
      // Disabled controls must not start a second fetch while the first is held.
      toolbar().click()
      statusbar().click()
      await flushUI()
      const singleFlight = fixture.actions.length === actionsBefore + 1
      releaseFetch()
      await waitFor(() => alert() !== null && bothEnabled(), entry + ' fetch error visible')
      const errorText = alert().textContent
      const rect = alert().getBoundingClientRect()
      const visible = rect.width > 0 && rect.height > 0 && getComputedStyle(alert()).visibility === 'visible'
      const detailAvailable = alert().title === errorText
      const failureActions = fixture.actions.slice(actionsBefore).map((action) => action.kind)

      const queriesBeforeRetry = fixture.queries.length
      click(retry(), entry + ' retry from other entry')
      await waitFor(() => typeof fixture.releaseFetch === 'function' && bothDisabled(), entry + ' retry busy')
      const clearedOnRetry = alert() === null
      releaseFetch()
      await waitFor(bothEnabled, entry + ' retry success')
      await flushUI()
      const restoredAfterSuccess = alert() === null && document.querySelector('.gp-statusbar__state')?.textContent === 'status.synced'
      const retryQueries = fixture.queries.slice(queriesBeforeRetry).sort()
      await releaseAndParkNext()
      results.push({ entry, singleFlight, failureActions, visible, errorText, detailAvailable, clearedOnRetry, restoredAfterSuccess, retryQueries })
    }
  } finally {
    fixture.fetchError = null
    fixture.holdFetch = false
    const release = fixture.releaseFetch
    fixture.releaseFetch = null
    release?.()
  }
  return results
}
