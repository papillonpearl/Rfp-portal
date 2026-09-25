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
