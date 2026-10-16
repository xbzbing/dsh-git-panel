import { useEffect, useState } from 'react'
import { pageVisibility } from './visibility.js'

export function usePageVisibility(): boolean {
  const [visible, setVisible] = useState(() => pageVisibility.isVisible())
  useEffect(() => {
    const sync = (): void => setVisible(pageVisibility.isVisible())
    const unsubscribe = pageVisibility.subscribe(sync)
    sync()
    return unsubscribe
  }, [])
  return visible
}
