import { describe, expect, it } from 'vitest'
import ExcelJS from 'exceljs'
import { planLines, readSheet, UnreadableFile } from '@/lib/rfps/line-sheet'
import { parseDecimal } from '@/lib/rfps/validation'

async function xlsx(rows: ExcelJS.CellValue[][], extraSheet = false): Promise<Uint8Array> {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet('Lines')
  rows.forEach((r) => ws.addRow(r))
  if (extraSheet) wb.addWorksheet('Notes').addRow(['ignore me'])
  return new Uint8Array(await wb.xlsx.writeBuffer())
}

const HEADER = ['Site', 'Equipment', 'Spec', 'Qty', 'Unit', 'Visibility', 'Internal Estimate']

describe('parseDecimal', () => {
  it.each([
    ['1,200', 0, '1200'],
    ['$1,200.50', 2, '1200.5'],
    [' 3 ', 3, '3'],
    ['0.125', 3, '0.125'],
    [12.5, 2, '12.5'],
    ['007', 0, '7'],
  ])('reads %s', (input, dp, out) => expect(parseDecimal(input, dp)).toBe(out))

  it.each([['-1'], ['1e3'], ['12,00'], ['abc'], ['1.2345'], [''], [NaN], ['4 ea']])('refuses %s', (input) =>
    expect(parseDecimal(input, 3)).toBeUndefined(),
  )
})

describe('reading an Excel workbook', () => {
  it('reads plain cells, formula results, rich text and hyperlinks as the person saw them', async () => {
    const bytes = await xlsx([
      HEADER,
      [
        'Site A',
        { richText: [{ text: 'UPS ' }, { text: 'module', font: { bold: true } }] },
        { text: '500 kVA', hyperlink: 'https://example.com' },
        { formula: '2*2', result: 4 },
        'ea',
        'shared',
        '1,200.50',
      ],
    ])
    const plan = planLines(await readSheet('lines.xlsx', bytes))
    expect(plan.ok).toBe(true)
    expect(plan.lines[0]).toMatchObject({
      site: 'Site A',
      equipment: 'UPS module',
      spec: '500 kVA',
      qty: '4',
      unit: 'ea',
      visibility: 'shared',
      internalEstimate: '1200.5',
    })
  })

  it('names an Excel error cell by row rather than importing it as text', async () => {
    const bytes = await xlsx([HEADER, ['', 'Battery string', '', { error: '#REF!' } as ExcelJS.CellErrorValue, 'ea']])
    const plan = planLines(await readSheet('lines.xlsx', bytes))
    expect(plan.ok).toBe(false)
    expect(plan.rowErrors[0].line).toBe(2)
    expect(plan.rowErrors[0].messages.join(' ')).toMatch(/qty is an Excel error \(#REF!\)/)
  })

  it('reads only the first sheet, and says so', async () => {
    const plan = planLines(await readSheet('lines.xlsx', await xlsx([HEADER, ['', 'Chiller', '', 1, 'ea']], true)))
    expect(plan.notes.join(' ')).toMatch(/first sheet \("Lines"\); 1 other sheet/)
  })

  it('refuses something that is not a workbook, and an old .xls', async () => {
    await expect(readSheet('lines.xlsx', new TextEncoder().encode('not a zip'))).rejects.toBeInstanceOf(UnreadableFile)
    await expect(readSheet('lines.xls', new Uint8Array())).rejects.toThrow(/save as \.xlsx/)
  })
})

describe('planning lines', () => {
  const csv = (...rows: string[]) =>
    readSheet('lines.csv', new TextEncoder().encode(['site,equipment,spec,qty,unit,visibility,internal_estimate', ...rows].join('\n')))

  it('defaults every line to internal when the file does not say, and says so', async () => {
    const plan = planLines(await readSheet('l.csv', new TextEncoder().encode('equipment,qty,unit\nUPS,2,ea')))
    expect(plan.lines[0].visibility).toBe('internal')
    expect(plan.notes.join(' ')).toMatch(/every line is internal/)
  })

  it('names every problem on every bad row, and blocks the whole file', async () => {
    const plan = planLines(
      await csv(
        'A,UPS,,2,ea,shared,',
        'B,,,0,,public,abc',
        'C,Chiller,,1.2345,ea,,',
      ),
    )
    expect(plan.ok).toBe(false)
    expect(plan.lines).toHaveLength(1)
    const byLine = Object.fromEntries(plan.rowErrors.map((e) => [e.line, e.messages.join(' | ')]))
    expect(byLine[3]).toMatch(/Equipment is required/)
    expect(byLine[3]).toMatch(/Quantity must be more than zero/)
    expect(byLine[3]).toMatch(/Unit is required/)
    expect(byLine[3]).toMatch(/visibility "public"/)
    expect(byLine[3]).toMatch(/Internal estimate must be an amount/)
    expect(byLine[4]).toMatch(/at most 3 decimal places/)
  })

  it('accepts common header spellings', async () => {
    const plan = planLines(await readSheet('l.csv', new TextEncoder().encode('Equipment,Quantity,UOM,Estimate\nUPS,2,ea,100')))
    expect(plan.ok).toBe(true)
    expect(plan.lines[0]).toMatchObject({ qty: '2', unit: 'ea', internalEstimate: '100' })
  })

  it('names missing required columns', async () => {
    const plan = planLines(await readSheet('l.csv', new TextEncoder().encode('site,spec\nA,x')))
    expect(plan.fileErrors[0]).toMatch(/Missing required columns: equipment, qty, unit/)
  })
})
