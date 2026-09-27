/** "4.000" → "4", "0.125" → "0.125", "1200.50" → "1,200.5". Exact: no float. */
export function formatQty(d: string): string {
  const [whole, frac = ''] = d.split('.')
  const f = frac.replace(/0+$/, '')
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${f ? `.${f}` : ''}`
}

/** "1200.5" → "$1,200.50". Exact: no float. */
export function formatMoney(d: string | null): string {
  if (d === null) return '—'
  const [whole, frac = ''] = d.split('.')
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${(frac + '00').slice(0, 2)}`
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
