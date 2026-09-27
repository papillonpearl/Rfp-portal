import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Download, Pencil, Trash2 } from 'lucide-react'
import { requireStaff } from '@/lib/authz'
import { ALLOWED_EXTENSIONS, MAX_ATTACHMENT_BYTES } from '@/lib/files/store'
import { formatBytes, formatMoney, formatQty } from '@/lib/format'
import { getRfp } from '@/lib/rfps/store'
import { changeAttachmentVisibility, changeLineVisibility, removeAttachment, removeLine } from '../actions'
import { LocalTime } from '@/components/local-time'
import { AttachmentUpload } from '@/components/rfps/attachment-upload'
import { LineForm } from '@/components/rfps/line-form'
import { VisibilityBadge } from '@/components/rfps/visibility'
import { Badge } from '@/components/ui/badge'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''

export default async function RfpBuilderPage(props: PageProps<'/rfps/[id]'>) {
  const staff = await requireStaff()
  const { id } = await props.params
  const sp = await props.searchParams
  const rfp = await getRfp(id)
  if (!rfp) notFound()
  const isAdmin = staff.role === 'admin'
  const editing = first(sp.edit)
  const shared = rfp.lines.filter((l) => l.visibility === 'shared').length
  const estimateTotal = rfp.lines.reduce(
    (sum, l) => (l.internalEstimate ? sum + Number(l.internalEstimate) * Number(l.qty) : sum),
    0,
  )

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start gap-3">
        <div className="mr-auto flex flex-col gap-1">
          <h1 className="text-xl font-semibold">{rfp.title}</h1>
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge variant="outline">{rfp.type}</Badge>
            <Badge variant="secondary">{rfp.status}</Badge>
            <span>Due <LocalTime iso={rfp.dueAt?.toISOString() ?? null} fallback="not set" /></span>
            <span>· {rfp.sealed ? 'Sealed bids' : 'Bids visible as they arrive'}</span>
          </div>
        </div>
        <Link href={`/rfps/${rfp.id}/preview`} className={buttonVariants({ variant: 'outline' })}>Preview as supplier</Link>
        {isAdmin && <Link href={`/rfps/${rfp.id}/edit`} className={buttonVariants({ variant: 'outline' })}>Edit details</Link>}
      </div>

      {first(sp.saved) && <p className="rounded-md border bg-muted p-3 text-sm">Details saved.</p>}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">Description <span className="font-normal text-muted-foreground">— shared</span></CardTitle></CardHeader>
          <CardContent className="whitespace-pre-wrap text-sm">{rfp.description || <span className="text-muted-foreground">None yet.</span>}</CardContent>
        </Card>
        <Card className="border-dashed">
          <CardHeader className="pb-2"><CardTitle className="text-sm">Internal notes <span className="font-normal text-muted-foreground">— team only</span></CardTitle></CardHeader>
          <CardContent className="whitespace-pre-wrap text-sm">{rfp.internalNotes || <span className="text-muted-foreground">None.</span>}</CardContent>
        </Card>
      </div>

      <section id="lines" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto text-lg font-semibold">Line items</h2>
          <span className="text-sm text-muted-foreground">
            {rfp.lines.length} line{rfp.lines.length === 1 ? '' : 's'}, {shared} shared
            {estimateTotal > 0 && <> · internal estimate {formatMoney(estimateTotal.toFixed(2))}</>}
          </span>
          {isAdmin && <Link href={`/rfps/${rfp.id}/lines/import`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>Upload from Excel</Link>}
        </div>

        {isAdmin && rfp.lines.length > 0 && (
          // Checkboxes in the table belong to this form through form="bulk".
          <form id="bulk" action={changeLineVisibility} className="flex flex-wrap items-center gap-2 text-sm">
            <input type="hidden" name="rfpId" value={rfp.id} />
            <span className="text-muted-foreground">Selected lines:</span>
            <Button type="submit" name="visibility" value="shared" size="sm" variant="outline">Share</Button>
            <Button type="submit" name="visibility" value="internal" size="sm" variant="outline">Make internal</Button>
          </form>
        )}

        <Table>
          <TableHeader>
            <TableRow>
              {isAdmin && <TableHead className="w-8"><span className="sr-only">Select</span></TableHead>}
              <TableHead className="w-8">#</TableHead>
              <TableHead>Site</TableHead>
              <TableHead>Equipment</TableHead>
              <TableHead>Spec</TableHead>
              <TableHead className="text-right">Qty</TableHead>
              <TableHead>Unit</TableHead>
              <TableHead className="text-right">Est. unit price<span className="block text-[10px] font-normal">team only</span></TableHead>
              <TableHead>Visibility</TableHead>
              {isAdmin && <TableHead><span className="sr-only">Actions</span></TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rfp.lines.length === 0 && (
              <TableRow>
                <TableCell colSpan={10} className="py-6 text-center text-muted-foreground">No lines yet. Add one below or upload from Excel.</TableCell>
              </TableRow>
            )}
            {rfp.lines.map((l) =>
              editing === l.id && isAdmin ? (
                <TableRow key={l.id} className="bg-muted/40">
                  <TableCell colSpan={10}>
                    <LineForm rfpId={rfp.id} initial={{ ...l, qty: formatQty(l.qty).replace(/,/g, '') }} />
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow key={l.id}>
                  {isAdmin && (
                    <TableCell>
                      <input type="checkbox" name="lineId" value={l.id} form="bulk" aria-label={`Select line ${l.position}`} />
                    </TableCell>
                  )}
                  <TableCell className="tabular-nums text-muted-foreground">{l.position}</TableCell>
                  <TableCell>{l.site ?? '—'}</TableCell>
                  <TableCell className="font-medium">{l.equipment}</TableCell>
                  <TableCell className="max-w-64 truncate" title={l.spec}>{l.spec}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatQty(l.qty)}</TableCell>
                  <TableCell>{l.unit}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatMoney(l.internalEstimate)}</TableCell>
                  <TableCell>
                    {isAdmin ? (
                      <form action={changeLineVisibility}>
                        <input type="hidden" name="rfpId" value={rfp.id} />
                        <input type="hidden" name="lineId" value={l.id} />
                        <input type="hidden" name="visibility" value={l.visibility === 'shared' ? 'internal' : 'shared'} />
                        <button type="submit" title={l.visibility === 'shared' ? 'Make internal' : 'Share with suppliers'} className="cursor-pointer">
                          <VisibilityBadge value={l.visibility} />
                        </button>
                      </form>
                    ) : (
                      <VisibilityBadge value={l.visibility} />
                    )}
                  </TableCell>
                  {isAdmin && (
                    <TableCell>
                      <div className="flex justify-end gap-1">
                        <Link href={`/rfps/${rfp.id}?edit=${l.id}#lines`} className={buttonVariants({ variant: 'ghost', size: 'icon' })} aria-label={`Edit line ${l.position}`}>
                          <Pencil className="size-4" />
                        </Link>
                        <form action={removeLine}>
                          <input type="hidden" name="rfpId" value={rfp.id} />
                          <input type="hidden" name="lineId" value={l.id} />
                          <Button type="submit" variant="ghost" size="icon" aria-label={`Delete line ${l.position}`}>
                            <Trash2 className="size-4" />
                          </Button>
                        </form>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              ),
            )}
          </TableBody>
        </Table>

        {isAdmin && (
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Add a line</CardTitle></CardHeader>
            <CardContent><LineForm key={rfp.lines.length} rfpId={rfp.id} /></CardContent>
          </Card>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Attachments</h2>
        {rfp.attachments.length === 0 ? (
          <p className="text-sm text-muted-foreground">No attachments yet.</p>
        ) : (
          <ul className="flex flex-col divide-y rounded-md border">
            {rfp.attachments.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 p-3 text-sm">
                <a href={`/api/rfps/${rfp.id}/attachments/${a.id}`} className="mr-auto flex items-center gap-2 font-medium hover:underline">
                  <Download className="size-4" /> {a.name}
                  <span className="font-normal text-muted-foreground">{formatBytes(a.size)}</span>
                </a>
                {isAdmin ? (
                  <form action={changeAttachmentVisibility}>
                    <input type="hidden" name="rfpId" value={rfp.id} />
                    <input type="hidden" name="attachmentId" value={a.id} />
                    <input type="hidden" name="visibility" value={a.visibility === 'shared' ? 'internal' : 'shared'} />
                    <button type="submit" title={a.visibility === 'shared' ? 'Make internal' : 'Share with suppliers'} className="cursor-pointer">
                      <VisibilityBadge value={a.visibility} />
                    </button>
                  </form>
                ) : (
                  <VisibilityBadge value={a.visibility} />
                )}
                {isAdmin && (
                  <form action={removeAttachment}>
                    <input type="hidden" name="rfpId" value={rfp.id} />
                    <input type="hidden" name="attachmentId" value={a.id} />
                    <Button type="submit" variant="ghost" size="icon" aria-label={`Delete ${a.name}`}><Trash2 className="size-4" /></Button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
        {isAdmin && (
          <AttachmentUpload
            rfpId={rfp.id}
            maxBytes={MAX_ATTACHMENT_BYTES}
            accept={ALLOWED_EXTENSIONS.map((e) => `.${e}`).join(',')}
          />
        )}
      </section>
    </div>
  )
}
