/** Exercises ChangesTab's armed state through real controls and controller polls. */
window.runConfirmationStateScenarios = async (fixture, { waitFor, flushUI, click, releaseAndParkNext }) => {
  const messageBox = () => document.querySelector('.gp-commitbox__msg')
  const amend = () => document.querySelector('.gp-commitbox__amend input')
  const suggest = () => document.querySelector('.gp-commitbox button[title="commit.suggest"]')
  const row = () => [...document.querySelectorAll('.gp-file-row')].find((node) => (node.textContent || '').includes('a.txt'))
  const discard = () => row()?.querySelector('button[title="changes.discard"], button[title="changes.discardConfirm"]')
  const armedDiscard = () => discard()?.title === 'changes.discardConfirm'
  const notice = () => (document.querySelector('.gp-changes')?.textContent || '').includes('commit.suggestOverwrite')
  const before = { snapshot: fixture.snapshot, message: messageBox().value, amend: amend().checked }
  const setMessage = async (value) => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(messageBox(), value)
    messageBox().dispatchEvent(new Event('input', { bubbles: true }))
    await flushUI()
  }
  const armBoth = async () => {
    click(discard(), 'arm discard a.txt')
    click(suggest(), 'arm suggestion overwrite')
    await waitFor(() => armedDiscard() && notice(), 'both confirmations armed')
    await flushUI()
  }
  const result = {}
  try {
    await setMessage('keep this amend draft')
    if (!amend().checked) click(amend(), 'enable amend overwrite guard')
    await flushUI()
    const callsBefore = fixture.suggestCalls
    await armBoth()
    await releaseAndParkNext()
    result.sameFingerprint = {
      discardArmed: armedDiscard(),
      draftPreserved: messageBox().value === 'keep this amend draft',
      suggestCallsBeforeConfirmation: fixture.suggestCalls - callsBefore,
    }
    // The notice itself survives disarming, so prove the internal armedSuggest
    // survived by observing the second click actually reach the parked endpoint.
    click(suggest(), 'confirm suggestion after same-fingerprint poll')
    await waitFor(() => fixture.suggestCalls === callsBefore + 1 && typeof fixture.releaseSuggest === 'function', 'armed suggestion reaches RPC')
    result.sameFingerprint.suggestConfirmed = true
    fixture.releaseSuggest()
    await waitFor(() => !messageBox().readOnly && messageBox().value === 'feat: suggested', 'suggestion completed')

    // Re-arm from a fresh local draft. A business change keeps a.txt present,
    // so a reset cannot pass merely because the armed row was unmounted.
    await setMessage('keep draft across business change')
    // Discard is still armed; leave it armed rather than confirming a write.
    click(suggest(), 're-arm suggestion overwrite')
    await flushUI()
    fixture.snapshot = { ...fixture.snapshot, changes: fixture.snapshot.changes.filter((change) => change.path !== 'b.txt'), modified: fixture.snapshot.modified - 1 }
    const businessCallsBefore = fixture.suggestCalls
    const actionsBefore = fixture.actions.length
    await releaseAndParkNext()
    result.businessChanged = {
      rowRetained: row() !== undefined,
      discardReset: discard()?.title === 'changes.discard',
      draftPreserved: messageBox().value === 'keep draft across business change',
    }
    click(discard(), 'first discard click after business change')
    click(suggest(), 'first suggestion click after business change')
    await flushUI()
    result.businessChanged.firstClicksOnlyArm = armedDiscard() && notice() && fixture.actions.length === actionsBefore && fixture.suggestCalls === businessCallsBefore
  } finally {
    // Restoring the business snapshot disarms the probes before later scenarios.
    fixture.snapshot = before.snapshot
    const release = fixture.releaseSuggest
    release?.()
    await waitFor(() => !messageBox().readOnly, 'suggestion settled before restore')
    await releaseAndParkNext()
    if (amend().checked !== before.amend) click(amend(), 'restore amend')
    await setMessage(before.message)
  }
  return result
}
