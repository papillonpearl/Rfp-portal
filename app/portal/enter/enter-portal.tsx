'use client'

import { useEffect, useState } from 'react'

export function EnterPortal() {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const token = window.location.hash.slice(1)
    // Take the token out of the address bar and history straight away.
    window.history.replaceState(null, '', window.location.pathname)
    if (!token) {
      queueMicrotask(() => setFailed(true))
      return
    }
    fetch('/api/portal/enter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    })
      .then(async (r) => {
        const data = (await r.json()) as { ok: boolean; path?: string }
        if (data.ok && data.path) window.location.replace(data.path)
        else setFailed(true)
      })
      .catch(() => setFailed(true))
  }, [])

  return failed ? <NotValid /> : <p className="text-sm text-muted-foreground">Opening your response page…</p>
}

export function NotValid() {
  return (
    <div className="max-w-md rounded-lg border p-6 text-sm">
      <h1 className="mb-2 text-lg font-semibold">This link is not valid</h1>
      <p className="text-muted-foreground">
        It may have expired, been replaced by a newer link, or been withdrawn. Please contact the person who sent it
        and ask for a new one.
      </p>
    </div>
  )
}
