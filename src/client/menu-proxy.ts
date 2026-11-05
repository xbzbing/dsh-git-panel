/**
 * Platform action proxy.
 *
 * The platform's own file, directory and image menus are exactly what the
 * requirement asks for — except that `file` also carries "open in sidebar",
 * which must not appear here. A contribution cannot subtract from another
 * contribution's list, so this module borrows the platform's *resolved* menu as
 * an embedded occurrence (`contextMenus.resolve`, no popup), keeps a whitelist
 * of action ids and drops the rest. Labels, icons (the application icon
 * included), disabled states and the desktop-availability probes are the
 * platform's; the click is forwarded to the platform by id.
 *
 * Why whitelist ids: the platform's action ids are its API for "run this same
 * action". A renamed id costs a missing item (checked by the unit tests, and by
 * the e2e stub), never a wrong one.
 *
 * Why the platform target carries an absolute path: the browser's relative path
 * hangs off the browse root, which is the session cwd only in the common case —
 * a nested checkout or a worktree would resolve against the wrong directory.
 * `workspaceFiles.stat` accepts absolute paths and reports the same path back,
 * so "reveal in Finder", the default application and the original bytes all
 * point at the file the row shows.
 */
import type { ContextMenusService, MenuAction, MenuActionView, MenuTrigger } from './menu-types.js'

/** Platform budget: the platform drops a contribution at 1000 ms and reports a
 * failure, so a slightly shorter budget returns what is ready instead. */
export const PLATFORM_BUDGET_MS = 800

/** Action ids kept from the platform's `file` menu (view id =
 * `<contribution>/<action>`, both percent-encoded by the platform). `sidebar`
 * is deliberately absent: the file browser opens its own preview. */
export const FILE_VIEWS: readonly string[] = [
  'open-in-app.file/float',
  'open-in-app.file/reveal',
  'open-in-app.file/open',
  'open-in-app.file/copyPath',
  'file-actions.file/copyImage',
  'file-actions.file/download',
  'file-actions.file/saveAs',
]

/** Action ids kept from the platform's `directory` menu. */
export const DIRECTORY_VIEWS: readonly string[] = [
  'open-in-app.directory/reveal',
  'open-in-app.directory/copyPath',
]

/** Action ids kept from the platform's `image` menu (the diff panes' pictures,
 * which are data URLs with no workspace file behind them). */
export const IMAGE_VIEWS: readonly string[] = [
  'file-actions.image/copy',
  'file-actions.image/download',
  'file-actions.image/saveAs',
]

/**
 * Read the platform's actions for one target and project the whitelisted ones.
 * @param menus - the `contextMenus` service.
 * @param target - platform target (`file` / `directory` / `image`).
 * @param allow - view ids to keep.
 * @param signal - the contribution's lifetime; aborted means return nothing.
 * @returns the kept actions, empty on any failure.
 */
export async function platformActions(
  menus: ContextMenusService, target: MenuTrigger, allow: readonly string[], signal: AbortSignal,
  budgetMs: number = PLATFORM_BUDGET_MS,
): Promise<MenuAction[]> {
  const occurrence = menus.resolve(target)
  let released = false
  const release = (): void => {
    if (released) return
    released = true
    try { occurrence.dispose() } catch { /* the platform may have dropped it */ }
  }
  // The occurrence lives as long as the menu that shows it: a click reuses it
  // instead of resolving the whole platform face again (another workspace stat
  // and another application probe, and a second budget it could miss).
  signal.addEventListener('abort', release, { once: true })
  try {
    await settle(occurrence.ready, budgetMs)
    if (signal.aborted) return []
    return project(occurrence.source.getSnapshot(), allow, {
      menus,
      target,
      select: (id) => {
        if (released) return false
        occurrence.select(id)
        // Dispatched; the occurrence has nothing left to do. A macrotask keeps
        // it alive through whatever the platform scheduled from `select`.
        setTimeout(release, 0)
        return true
      },
    })
  } catch {
    return []
  } finally {
    // A list nobody opened must not hold the occurrence; the list that is shown
    // keeps it through `select` above.
    if (!signal.aborted) setTimeout(release, OCCURRENCE_IDLE_MS)
    else release()
  }
}

/** How long an unused occurrence is kept. The menu it belongs to is dismissed
 * long before this, and the abort listener above is the normal path. */
const OCCURRENCE_IDLE_MS = 30_000

/** How one projected action reaches the platform: through the occurrence that
 * built the list while it is still alive, else by resolving again. */
interface RunFace {
  readonly menus: ContextMenusService
  readonly target: MenuTrigger
  /** Dispatches through the live occurrence; false once it was released. */
  readonly select?: (id: string) => boolean
}

/**
 * Forward one platform action id to the platform.
 *
 * The occurrence that built the list is reused when it is still alive, so a
 * click is one dispatch rather than a second full resolution (which could also
 * miss the platform's budget and report a failure for a menu that was built
 * fine). When it is gone — the menu outlived its signal — the id is resolved
 * again, so an action the platform has since withdrawn still reports a failure
 * instead of running something else.
 */
async function runPlatformAction(run: RunFace, id: string): Promise<void> {
  if (run.select !== undefined && run.select(id)) return
  const occurrence = run.menus.resolve(run.target)
  try {
    await settle(occurrence.ready, PLATFORM_BUDGET_MS)
    const view = findView(occurrence.source.getSnapshot(), id)
    if (view === undefined) throw new Error('menu action unavailable')
    if (view.disabled === true) return
    occurrence.select(id)
  } finally {
    occurrence.dispose()
  }
}

/** Resolve with either the promise or the budget, whichever comes first. */
async function settle(ready: Promise<void>, budgetMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const budget = new Promise<void>((resolve) => { timer = setTimeout(resolve, budgetMs) })
  try {
    await Promise.race([ready.catch(() => undefined), budget])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function findView(views: readonly MenuActionView[], id: string): MenuActionView | undefined {
  for (const view of views) {
    if (view.id === id) return view
    const found = view.children === undefined ? undefined : findView(view.children, id)
    if (found !== undefined) return found
  }
  return undefined
}

function project(
  views: readonly MenuActionView[], allow: readonly string[] | null, run: RunFace,
): MenuAction[] {
  const actions: MenuAction[] = []
  for (const view of views) {
    // The whitelist gates entry points only. A parent that is kept brings its
    // whole submenu: the platform grouped those entries itself, and filtering
    // inside one would leave a heading with entries missing.
    if (allow !== null && !allow.includes(view.id)) continue
    const children = view.children === undefined ? undefined : project(view.children, null, run)
    actions.push({
      ...presentation(view),
      ...(children === undefined ? {} : { children }),
      // A parent with a submenu opens it; only leaves execute.
      ...(children === undefined ? { run: () => runPlatformAction(run, view.id) } : {}),
    })
  }
  return actions
}

/** Copy the fields the popup draws; the platform's `commandId` is dropped on
 * purpose — these ids belong to the platform's own shortcuts. */
function presentation(view: MenuActionView): Omit<MenuAction, 'run'> {
  return {
    id: view.id,
    label: view.label,
    ...(view.disabled === undefined ? {} : { disabled: view.disabled }),
    ...(view.danger === undefined ? {} : { danger: view.danger }),
    ...(view.separatorBefore === undefined ? {} : { separatorBefore: view.separatorBefore }),
    ...(view.icon === undefined ? {} : { icon: view.icon }),
  }
}
