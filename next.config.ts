import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      // Attachments and line-item workbooks are capped at 4 MB each
      // (MAX_ATTACHMENT_BYTES, MAX_LINE_FILE_BYTES); the rest is multipart
      // overhead. Vercel's own request limit is 4.5 MB, so raising this
      // further would only move the refusal somewhere with no message.
      bodySizeLimit: '4.5mb',
    },
  },
}

export default nextConfig
