/**
 * The "check the remote" entry's run, shared by the repository rows and the
 * input-bar pill.
 *
 * Both surfaces can ask a checkout that is not the one they sample: a
 * repository row names its own root, and the pill names the checkout it shows.
 * The fetch therefore runs under that checkout's tag, and only a controller that
 * still shows the same tag may publish the reply — otherwise a late answer would
 * paint one repository's ahead/behind onto another. The report goes through the
 * platform toast, which outlives the dismissed popup; a page that has none
 * reports nothing rather than keeping the result to itself.
 */
import { controllerFor } from './registry.js'
import { gitPanelRemoteOf, type ClientCtx } from './rpc.js'
import { withRepo } from './repo-select.js'
import { contextMenusOf } from './menu-register.js'
import { opErrorText } from './ops-modals.js'
import type { GitKey } from './locales.js'

/**
 * Fetch one checkout and report the outcome.
 * @param ctx - client context (remote and toast).
 * @param t - translate.
 * @param sessionId - the session whose controller publishes the reply.
 * @param repoTag - the checkout to fetch (a repository tag, `''` for the root).
 * @param claims - checkouts with a fetch in flight; a repeat click is dropped.
 */
export function runRemoteFetch(
  ctx: ClientCtx,
  t: (key: GitKey, params?: Record<string, string | number>) => string,
  sessionId: string,
  repoTag: string,
  claims: Set<string>,
): void {
  if (claims.has(repoTag)) return
  claims.add(repoTag)
  const notify = (text: string, success: boolean): void => { contextMenusOf(ctx)?.notify(text, success) }
  void (async () => {
    try {
      const result = await withRepo(gitPanelRemoteOf(ctx), repoTag).run({ sessionId, action: { kind: 'fetch' } })
      if (!result.ok) {
        notify(opErrorText(result.error.code, result.error.message, t), false)
        return
      }
      // The reply carries the sample of the checkout the fetch ran in; only that
      // checkout's controller may publish it.
      const controller = controllerFor(sessionId)
      if (controller.getRepo() === repoTag) controller.accept(result.snapshot)
      const snap = result.snapshot
      if (snap.remote === null) notify(t('menu.fetchNoRemote'), true)
      else if (!snap.hasUpstream) notify(t('menu.fetchNoUpstream'), true)
      else notify(t('menu.fetchDone', { ahead: snap.ahead, behind: snap.behind }), true)
    } catch (error) {
      notify(error instanceof Error ? error.message : t('common.operationFailed'), false)
    } finally {
      claims.delete(repoTag)
    }
  })()
}
