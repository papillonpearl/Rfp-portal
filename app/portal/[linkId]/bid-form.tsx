'use client'

import { useActionState, useState } from 'react'
import type { SupplierSafeLine } from '@/lib/rfps/supplier-safe'
import { formatMoney, formatQty } from '@/lib/format'
import { submitKeepingInput } from '@/lib/forms'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { saveBidsAction } from './actions'

type Bid = { lineItemId: string; unitPrice: string | null; leadTimeDays: number | null; notes: string }

/** Display-only: cents as integers so the running total adds up exactly. */
function cents(price: string): number | null {
  const m = /^\$?\s*([\d,]+)(?:\.(\d{1,2}))?\s*$/.exec(price.trim())
  if (!m) return null
  return Number(m[1].replace(/,/g, '')) * 100 + Number((m[2] ?? '').padEnd(2, '0') || 0)
}

export function BidForm({ linkId, lines, bids, readOnly }: { linkId: string; lines: SupplierSafeLine[]; bids: Bid[]; readOnly: boolean }) {
  const [state, action, pending] = useActionState(saveBidsAction, undefined)
  const byLine = new Map(bids.map((b) => [b.lineItemId, b]))
  const [prices, setPrices] = useState<Record<string, string>>(
    Object.fromEntries(lines.map((l) => [l.id, byLine.get(l.id)?.unitPrice ?? ''])),
  )
  const total = lines.reduce((sum, l) => {
    const c = cents(prices[l.id] ?? '')
    // qty has at most 3 decimals: scale to an integer, multiply, scale back.
    return c === null ? sum : sum + Math.round((c * Math.round(Number(l.qty) * 1000)) / 1000)
  }, 0)

  return (
    <form
      onSubmit={(e) => {
        const intent = (e.nativeEvent as SubmitEvent).submitter?.getAttribute('value')
        if (intent === 'submit' && !window.confirm('Submit your response? It is final for this round.')) {
          e.preventDefault()
          return
        }
        submitKeepingInput(action)(e)
      }}
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="linkId" value={linkId} />
      <div className="overflow-x-auto">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="p-2 font-medium">#</th>
              <th className="p-2 font-medium">Item</th>
              <th className="p-2 text-right font-medium">Qty</th>
              <th className="p-2 font-medium">Unit price (USD)</th>
              <th className="p-2 font-medium">Lead time (days)</th>
              <th className="p-2 font-medium">Notes</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => {
              const b = byLine.get(l.id)
              return (
                <tr key={l.id} className="border-b align-top">
                  <td className="p-2 tabular-nums text-muted-foreground">
                    {i + 1}
                    <input type="hidden" name="lineId" value={l.id} />
                  </td>
                  <td className="p-2">
                    <div className="font-medium">{l.equipment}</div>
                    {l.site && <div className="text-xs text-muted-foreground">{l.site}</div>}
                  </td>
                  <td className="p-2 text-right tabular-nums whitespace-nowrap">{formatQty(l.qty)} {l.unit}</td>
                  <td className="p-2">
                    <Input name={`price:${l.id}`} inputMode="decimal" aria-label={`Unit price, line ${i + 1}`} disabled={readOnly}
                      value={prices[l.id] ?? ''} onChange={(e) => setPrices((p) => ({ ...p, [l.id]: e.target.value }))} className="w-32" />
                  </td>
                  <td className="p-2">
                    <Input name={`lead:${l.id}`} inputMode="numeric" aria-label={`Lead time, line ${i + 1}`} disabled={readOnly}
                      defaultValue={b?.leadTimeDays ?? ''} className="w-24" />
                  </td>
                  <td className="p-2">
                    <Input name={`notes:${l.id}`} aria-label={`Notes, line ${i + 1}`} disabled={readOnly} defaultValue={b?.notes ?? ''} maxLength={2000} />
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={3} className="p-2 text-right font-medium">Total</td>
              <td colSpan={3} className="p-2 font-semibold tabular-nums">{formatMoney((total / 100).toFixed(2))}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      {state && (
        <p role="status" className={state.ok ? 'text-sm' : 'text-sm text-destructive'}>{state.message}</p>
      )}
      {!readOnly && (
        <div className="flex flex-wrap gap-2">
          <Button type="submit" name="intent" value="draft" variant="outline" disabled={pending}>Save draft</Button>
          <Button type="submit" name="intent" value="submit" disabled={pending}>Submit response</Button>
        </div>
      )}
    </form>
  )
}
