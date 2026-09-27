import 'server-only'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { del, get, put } from '@vercel/blob'

// Attachment bytes. Private Vercel Blob in production; a local folder in
// development. Either way nothing here hands out a URL anyone can open:
// files are streamed through routes that check who is asking first.

export const MAX_ATTACHMENT_BYTES = 4_000_000

// What can be attached: documents, drawings, spreadsheets, images, archives.
// Anything a browser would execute (HTML, SVG, JS) is refused outright, and
// every download is sent as an attachment with nosniff besides.
export const ALLOWED_EXTENSIONS = [
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'ppt', 'pptx',
  'dwg', 'dxf', 'png', 'jpg', 'jpeg', 'zip',
] as const

export function extensionOf(name: string): string {
  return path.extname(name).slice(1).toLowerCase()
}

export function isAllowedFile(name: string): boolean {
  return (ALLOWED_EXTENSIONS as readonly string[]).includes(extensionOf(name))
}

export interface FileStore {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>
  get(key: string): Promise<ReadableStream<Uint8Array> | null>
  delete(key: string): Promise<void>
}

class BlobStore implements FileStore {
  async put(key: string, data: Uint8Array, contentType: string) {
    await put(key, Buffer.from(data), { access: 'private', contentType, addRandomSuffix: false })
  }
  async get(key: string) {
    const r = await get(key, { access: 'private' })
    return r && r.statusCode === 200 ? r.stream : null
  }
  async delete(key: string) {
    await del(key)
  }
}

class LocalStore implements FileStore {
  constructor(private root: string) {}
  private file(key: string) {
    // Keys are generated here, but a path check costs nothing.
    const p = path.resolve(this.root, key)
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Bad storage key')
    return p
  }
  async put(key: string, data: Uint8Array) {
    const p = this.file(key)
    await fs.mkdir(path.dirname(p), { recursive: true })
    await fs.writeFile(p, data)
  }
  async get(key: string) {
    try {
      const data = await fs.readFile(this.file(key))
      return new Blob([data]).stream()
    } catch {
      return null
    }
  }
  async delete(key: string) {
    await fs.rm(this.file(key), { force: true })
  }
}

let store: FileStore | undefined

export function fileStore(): FileStore {
  if (store) return store
  if (process.env.BLOB_READ_WRITE_TOKEN) store = new BlobStore()
  else if (process.env.NODE_ENV !== 'production') {
    store = new LocalStore(process.env.LOCAL_UPLOAD_DIR ?? path.join(process.cwd(), '.uploads'))
  } else {
    // A production deploy that quietly wrote to its own ephemeral disk would
    // lose every file on the next deploy.
    throw new Error('BLOB_READ_WRITE_TOKEN is not set; attachments are unavailable')
  }
  return store
}

/** Unguessable, and carries nothing from the original name. */
export function newStorageKey(rfpId: string): string {
  return `rfps/${rfpId}/${randomUUID()}`
}
