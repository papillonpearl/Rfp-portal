// Outbound email through Resend's HTTP API. No SDK: this is one POST.
//
// The sending address is EMAIL_FROM and nothing else. It must be a domain
// verified for THIS project — never the PPL practice domain, which would put
// DLR procurement mail under Charlotte's practice's name and reputation.

export type Mail = { to: string; subject: string; text: string; html: string }

export class EmailNotConfigured extends Error {}

export async function sendMail(mail: Mail): Promise<void> {
  const key = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM
  if (!key || !from) {
    // Development prints instead of sending, so the app runs without an
    // account. Production refuses: a sign-in link that silently went nowhere
    // looks exactly like one that went to spam.
    if (process.env.NODE_ENV !== 'production') {
      console.info(`\n[email:dev] to=${mail.to}\n[email:dev] subject=${mail.subject}\n${mail.text}\n`)
      return
    }
    throw new EmailNotConfigured('RESEND_API_KEY and EMAIL_FROM must both be set')
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, ...mail }),
  })
  if (!res.ok) {
    // Status only: the response body can echo the recipient.
    throw new Error(`Resend refused the message (HTTP ${res.status})`)
  }
}

export type BatchResult = { ok: boolean; mode: 'sent' | 'logged' | 'failed' }

/**
 * Several separate messages in one request, each to its own recipient. One
 * email per supplier, never a shared To or CC: suppliers must not learn who
 * else was invited. Resend's batch endpoint takes up to 100; larger lists are
 * chunked. A chunk that fails marks its messages failed rather than throwing,
 * so the caller can record exactly who did not get one.
 */
export async function sendMailBatch(mails: Mail[]): Promise<BatchResult[]> {
  const key = process.env.RESEND_API_KEY
  const from = process.env.EMAIL_FROM
  if (!key || !from) {
    if (process.env.NODE_ENV !== 'production') {
      for (const m of mails) {
        console.info(`\n[email:dev] to=${m.to}\n[email:dev] subject=${m.subject}\n${m.text}\n`)
      }
      return mails.map(() => ({ ok: true, mode: 'logged' as const }))
    }
    return mails.map(() => ({ ok: false, mode: 'failed' as const }))
  }
  const results: BatchResult[] = []
  for (let i = 0; i < mails.length; i += 100) {
    const chunk = mails.slice(i, i + 100)
    try {
      const res = await fetch('https://api.resend.com/emails/batch', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(chunk.map((m) => ({ from, ...m }))),
      })
      if (!res.ok) console.error(`[email] batch refused (HTTP ${res.status})`)
      results.push(...chunk.map(() => ({ ok: res.ok, mode: res.ok ? ('sent' as const) : ('failed' as const) })))
    } catch (e) {
      console.error('[email] batch request failed', e)
      results.push(...chunk.map(() => ({ ok: false, mode: 'failed' as const })))
    }
  }
  return results
}
