import { describe, expect, it } from 'vitest'
import { renderToString } from 'react-dom/server'
import { LocalTime } from '@/components/local-time'

describe('LocalTime', () => {
  // A formatter option clash once threw a RangeError here and took every page
  // with a due date down. Rendering it is the test.
  it('renders a moment with its time zone named', () => {
    const html = renderToString(<LocalTime iso="2026-12-01T23:00:00.000Z" />)
    expect(html).toContain('Dec 1, 2026')
    expect(html).toContain('UTC')
    expect(html).toContain('dateTime="2026-12-01T23:00:00.000Z"')
  })
  it('renders the fallback when there is no date', () => {
    expect(renderToString(<LocalTime iso={null} fallback="Not set" />)).toBe('Not set')
  })
})
