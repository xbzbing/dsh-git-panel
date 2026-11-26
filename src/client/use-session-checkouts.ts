/** Standard slot projection → the session's shared checkout lifecycle. */
import type { UseProjection } from './follow-checkout.js'
import { useCheckouts } from './registry.js'

const NO_PROJECTION: UseProjection = () => undefined

export function useSessionCheckouts(sessionId: string | undefined, active: boolean, useProjection?: UseProjection, discover = true): ReturnType<typeof useCheckouts> {
  const useWorkingDirectory = useProjection ?? NO_PROJECTION
  const projected = useWorkingDirectory('workingDirectory')
  const directory = typeof projected === 'string' && projected !== '' ? projected : null
  return useCheckouts(sessionId, active, directory, discover)
}
