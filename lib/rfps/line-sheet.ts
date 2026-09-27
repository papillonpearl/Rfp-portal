import ExcelJS from 'exceljs'
import Papa from 'papaparse'
import { lineInput, type LineInput } from './validation'

// Line-item upload: .xlsx or .csv, first sheet, first row is the header.
//
//   site | equipment | spec | qty | unit | visibility | internal_estimate
//
// Parsing is pure and runs again on the server at commit, so the lines
// written are never the browser's copy of the preview. All or nothing: a
// file with one bad row adds no lines.

export const MAX_LINE_FILE_BYTES = 4_000_000
export const MAX_LINE_ROWS = 2_000

export const LINE_COLUMNS = [
  'site',
  'equipment',
  'spec',
  'qty',
  'unit',
  'visibility',
  'internal_estimate',
] as const
type Column = (typeof LINE_COLUMNS)[number]
const REQUIRED: Column[] = ['equipment', 'qty', 'unit']

const ALIASES: Record<string, Column> = {
  quantity: 'qty',
  uom: 'unit',
  unit_of_measure: 'unit',
  estimate: 'internal_estimate',
  internal_estimate_unit_price: 'internal_estimate',
  specification: 'spec',
  description: 'spec',
}

/** A cell as the planner sees it: text, a number, or an Excel error. */
export type Cell = string | number | { error: string }
export type Sheet = { rows: Cell[][]; note?: string }

export type LinePlan = {
  fileErrors: string[]
  rowErrors: { line: number; messages: string[] }[]
  lines: (LineInput & { line: number })[]
  ignoredColumns: string[]
  notes: string[]
  ok: boolean
}

export class UnreadableFile extends Error {}

/** Read the first worksheet of an .xlsx, or a .csv, into cells. */
export async function readSheet(name: string, bytes: Uint8Array): Promise<Sheet> {
  const lower = name.toLowerCase()
  if (lower.endsWith('.csv')) {
    const text = new TextDecoder().decode(bytes).replace(/^﻿/, '')
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' })
    return { rows: parsed.data }
  }
  if (!lower.endsWith('.xlsx')) {
    throw new UnreadableFile('Upload an .xlsx or .csv file. Older .xls files: save as .xlsx first.')
  }
  const wb = new ExcelJS.Workbook()
  try {
    // exceljs's types predate Node's generic Buffer; the bytes are what it wants.
    await wb.xlsx.load(Buffer.from(bytes) as unknown as ArrayBuffer)
  } catch {
    throw new UnreadableFile('That file could not be read as an Excel workbook.')
  }
  const ws = wb.worksheets[0]
  if (!ws) throw new UnreadableFile('The workbook has no sheets.')
  const rows: Cell[][] = []
  ws.eachRow({ includeEmpty: false }, (row) => {
    const out: Cell[] = []
    const count = Math.max(row.cellCount, row.actualCellCount)
    for (let c = 1; c <= count; c++) out.push(cellValue(row.getCell(c).value))
    rows.push(out)
  })
  return {
    rows,
    note: wb.worksheets.length > 1 ? `Read the first sheet ("${ws.name}"); ${wb.worksheets.length - 1} other sheet(s) ignored.` : undefined,
  }
}

/** Every shape exceljs gives a cell, reduced to what a line needs. */
export function cellValue(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number' || typeof v === 'string') return v
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === 'object') {
    if ('error' in v) return { error: String(v.error) }
    // A formula carries its last computed result; that is what the person saw.
    if ('formula' in v || 'sharedFormula' in v) {
      const r = (v as { result?: ExcelJS.CellValue }).result
      return r === undefined ? { error: 'formula with no saved result' } : cellValue(r)
    }
    if ('richText' in v) return v.richText.map((t) => t.text).join('')
    if ('text' in v) return String((v as { text: unknown }).text)
  }
  return String(v)
}

function normalizeHeader(h: Cell): string {
  const s = typeof h === 'object' ? '' : String(h)
  const n = s.trim().toLowerCase().replace(/[\s\-/()]+/g, '_').replace(/_+$/, '')
  return ALIASES[n] ?? n
}

export function planLines(sheet: Sheet): LinePlan {
  const plan: LinePlan = { fileErrors: [], rowErrors: [], lines: [], ignoredColumns: [], notes: [], ok: false }
  if (sheet.note) plan.notes.push(sheet.note)

  const [header, ...rows] = sheet.rows
  if (!header) {
    plan.fileErrors.push('The file is empty')
    return plan
  }
  const index = new Map<Column, number>()
  header.forEach((h, i) => {
    const name = normalizeHeader(h)
    if ((LINE_COLUMNS as readonly string[]).includes(name)) {
      if (index.has(name as Column)) plan.fileErrors.push(`Column "${name}" appears twice`)
      index.set(name as Column, i)
    } else if (name) {
      plan.ignoredColumns.push(String(h).trim())
    }
  })
  const missing = REQUIRED.filter((c) => !index.has(c))
  if (missing.length) plan.fileErrors.push(`Missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`)
  if (rows.length === 0) plan.fileErrors.push('The file has a header but no rows')
  if (rows.length > MAX_LINE_ROWS) plan.fileErrors.push(`Too many rows (${rows.length}); the limit is ${MAX_LINE_ROWS}`)
  if (plan.fileErrors.length) return plan

  rows.forEach((row, i) => {
    const line = i + 2
    const messages: string[] = []
    const get = (col: Column): string | number | undefined => {
      const at = index.get(col)
      if (at === undefined) return undefined
      const c = row[at] ?? ''
      if (typeof c === 'object') {
        messages.push(`${col} is an Excel error (${c.error})`)
        return ''
      }
      return typeof c === 'string' ? c.trim() : c
    }
    const vis = String(get('visibility') ?? '').toLowerCase()
    if (vis !== '' && vis !== 'internal' && vis !== 'shared') {
      messages.push(`visibility "${vis}" must be internal or shared`)
    }
    const result = lineInput.safeParse({
      site: String(get('site') ?? ''),
      equipment: String(get('equipment') ?? ''),
      spec: String(get('spec') ?? ''),
      qty: get('qty'),
      unit: String(get('unit') ?? ''),
      visibility: vis === 'shared' ? 'shared' : 'internal',
      internalEstimate: get('internal_estimate'),
    })
    if (!result.success) messages.push(...result.error.issues.map((x) => x.message))
    if (messages.length) plan.rowErrors.push({ line, messages: [...new Set(messages)] })
    else if (result.success) plan.lines.push({ ...result.data, line })
  })

  if (!index.has('visibility')) {
    plan.notes.push('No visibility column, so every line is internal until you share it.')
  }
  plan.ok = plan.fileErrors.length === 0 && plan.rowErrors.length === 0 && plan.lines.length > 0
  return plan
}
