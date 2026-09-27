'use client'

import { useSyncExternalStore } from 'react'

const noop = () => () => {}

const FORMAT: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
}

/**
 * A moment shown in the viewer's own time zone, with the zone named, so
 * "due 5:00 PM" is never ambiguous between colleagues in different places.
 * The server renders the UTC form, so the page never shows a time without
 * its zone.
 */
export function LocalTime({ iso, fallback = '—' }: { iso: string | null; fallback?: string }) {
  const local = useSyncExternalStore(noop, () => true, () => false)
  if (!iso) return <>{fallback}</>
  const d = new Date(iso)
  // Explicit parts: dateStyle/timeStyle cannot be combined with timeZoneName
  // and throw a RangeError that takes the whole page down.
  const text = local
    ? d.toLocaleString(undefined, FORMAT)
    : d.toLocaleString('en-US', { ...FORMAT, timeZone: 'UTC' })
  return <time dateTime={iso}>{text}</time>
}
