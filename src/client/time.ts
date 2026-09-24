import type { GitKey } from './locales'

/** Relative-time formatting bound to the locale dictionary. */
type T = (key: GitKey, params?: Record<string, string | number>) => string

export function timeAgo(iso: string | number | null, now: number, t: T): string {
  if (iso === null) return ''
  const ms = typeof iso === 'number' ? iso : Date.parse(iso)
  if (!Number.isFinite(ms)) return ''
  const diff = Math.max(0, now - ms)
  const min = Math.floor(diff / 60000)
  if (min < 1) return t('time.justNow')
  if (min < 60) return t('time.minutesAgo', { n: min })
  const hours = Math.floor(min / 60)
  if (hours < 24) return t('time.hoursAgo', { n: hours })
  const days = Math.floor(hours / 24)
  return t('time.daysAgo', { n: days })
}

/** Absolute local time (YYYY-MM-DD HH:mm) for hover titles. */
export function absoluteTime(iso: string | number | null): string {
  if (iso === null) return ''
  const d = new Date(typeof iso === 'number' ? iso : Date.parse(iso))
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}
