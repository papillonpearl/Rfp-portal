import type { Metadata } from 'next'
import { EnterPortal } from './enter-portal'

export const metadata: Metadata = { title: 'Opening your response page', referrer: 'no-referrer' }

// The emailed link lands here with its token after the #. Mail scanners that
// fetch the page receive this shell and nothing else; the token is read and
// redeemed only by script in a real browser.
export default function EnterPage() {
  return (
    <main className="flex flex-1 items-center justify-center p-4">
      <EnterPortal />
    </main>
  )
}
