import fsp from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'

const MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.html': 'text/html; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.json': 'application/json',
}

/**
 * GET /download/<fichier> — sert les artefacts livrés (dossier download/).
 * Permet aux liens de fichiers partagés dans la conversation (MP3, images,
 * exports…) de rester fonctionnels via le domaine de prévisualisation.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ file: string }> }) {
  const { file } = await ctx.params
  const name = decodeURIComponent(file).replace(/\\/g, '/')
  if (!name || name.includes('/') || name.includes('..') || name.startsWith('.')) {
    return NextResponse.json({ ok: false, error: 'Fichier invalide.' }, { status: 400 })
  }
  const downloadDir = path.resolve(process.cwd(), 'download')
  const abs = path.join(downloadDir, name)
  if (!path.resolve(abs).startsWith(downloadDir)) {
    return NextResponse.json({ ok: false, error: 'Fichier invalide.' }, { status: 400 })
  }
  try {
    const st = await fsp.stat(abs)
    if (!st.isFile()) throw new Error('not a file')
    const type = MIME[path.extname(name).toLowerCase()] ?? 'application/octet-stream'
    const stream = Readable.toWeb(createReadStream(abs)) as unknown as ReadableStream<Uint8Array>
    return new Response(stream, {
      headers: {
        'Content-Type': type,
        'Content-Length': String(st.size),
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch {
    return NextResponse.json({ ok: false, error: 'Fichier introuvable.' }, { status: 404 })
  }
}
