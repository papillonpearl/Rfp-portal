'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { uploadAttachment } from '@/app/(admin)/rfps/actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function AttachmentUpload({ rfpId, maxBytes, accept }: { rfpId: string; maxBytes: number; accept: string }) {
  const [state, action, pending] = useActionState(uploadAttachment, undefined)
  const [tooBig, setTooBig] = useState<string | null>(null)
  const form = useRef<HTMLFormElement>(null)
  useEffect(() => {
    if (state && state.errors.length === 0) form.current?.reset()
  }, [state])

  return (
    <form
      ref={form}
      action={action}
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        // Refused here, before sending: over Vercel's request limit the
        // platform rejects the upload itself, with no message to show.
        const file = (e.currentTarget.elements.namedItem('file') as HTMLInputElement).files?.[0]
        if (file && file.size > maxBytes) {
          e.preventDefault()
          setTooBig(`${file.name} is ${(file.size / 1e6).toFixed(1)} MB; the limit is ${maxBytes / 1e6} MB.`)
        } else setTooBig(null)
      }}
    >
      <input type="hidden" name="rfpId" value={rfpId} />
      <div className="flex flex-wrap items-center gap-2">
        <Input type="file" name="file" accept={accept} required className="max-w-sm" />
        <Button type="submit" size="sm" variant="secondary" disabled={pending}>{pending ? 'Uploading…' : 'Upload'}</Button>
      </div>
      <p className="text-xs text-muted-foreground">Up to {maxBytes / 1e6} MB. Uploaded files start internal.</p>
      {(tooBig || (state && state.errors.length > 0)) && (
        <p role="alert" className="text-sm text-destructive">{tooBig ?? state?.errors[0]}</p>
      )}
    </form>
  )
}
