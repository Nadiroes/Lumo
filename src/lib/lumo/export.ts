/**
 * Export .zip versionné — la fonctionnalité signature de Lumo.
 * Structure :
 *  Lumo_Export_<titre>_vX.Y.Z/
 *    manifest.json          (clé du versioning)
 *    README.md
 *    conversation/transcript.json + transcript.md
 *    artifacts/images|audio|video|text/…
 *    metadata/providers.json + checksums.sha256 (+ brief.json si Livre)
 */

import JSZip from 'jszip'
import { getArtifactData } from './artifact-store'
import type { Artifact, Message, Session } from './types'

export function slugify(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .toLowerCase() || 'session'
  )
}

export function nextExportVersion(session: Session): string {
  return `1.${session.exports.length}.0`
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

async function sha256(data: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', data.buffer as ArrayBuffer)
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

function fmtBytes(n: number): string {
  if (n >= 1_048_576) return `${(n / 1_048_576).toFixed(1)} Mo`
  if (n >= 1024) return `${(n / 1024).toFixed(1)} Ko`
  return `${n} o`
}

function artifactFolder(kind: Artifact['kind']): string {
  switch (kind) {
    case 'image':
      return 'artifacts/images'
    case 'audio':
      return 'artifacts/audio'
    case 'video':
      return 'artifacts/video'
    case 'webcode':
      return 'artifacts/web'
    case 'design':
      return 'artifacts/design'
    default:
      return 'artifacts/text'
  }
}

function mimeFor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    html: 'text/html; charset=utf-8',
    css: 'text/css; charset=utf-8',
    js: 'text/javascript; charset=utf-8',
    mjs: 'text/javascript; charset=utf-8',
    ts: 'text/plain; charset=utf-8',
    tsx: 'text/plain; charset=utf-8',
    jsx: 'text/plain; charset=utf-8',
    json: 'application/json',
    php: 'application/x-httpd-php',
    dart: 'text/plain; charset=utf-8',
    md: 'text/markdown; charset=utf-8',
  }
  return map[ext] ?? 'text/plain; charset=utf-8'
}

function artifactExtension(a: Artifact): string {
  if (a.name && a.name.includes('.')) return a.name.split('.').pop() as string
  switch (a.kind) {
    case 'image':
      return 'png'
    case 'audio':
      return 'wav'
    case 'video':
      return 'mp4'
    default:
      return 'md'
  }
}

function transcriptMarkdown(session: Session, messages: Message[]): string {
  const lines: string[] = [
    `# Transcript — ${session.title}`,
    '',
    `- **Mode :** ${session.mode}`,
    `- **Créée le :** ${new Date(session.createdAt).toLocaleString('fr-FR')}`,
    `- **Exportée le :** ${new Date().toLocaleString('fr-FR')}`,
    '',
    '---',
    '',
  ]
  for (const m of messages) {
    const who = m.role === 'user' ? '🧑 Vous' : '☀️ Lumo'
    const time = new Date(m.createdAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    lines.push(`## ${who} — ${time}`)
    lines.push('')
    lines.push(m.content || '_(contenu vide)_')
    lines.push('')
    if (m.artifacts?.length) {
      lines.push('**Artefacts joints :**')
      for (const a of m.artifacts) {
        lines.push(`- \`${artifactFolder(a.kind)}/${a.id}.${artifactExtension(a)}\` (${a.kind}, via ${a.provider})`)
      }
      lines.push('')
    }
  }
  if (session.brief) {
    lines.push('---', '', '## Brief de direction artistique (Livre)', '', '```json')
    lines.push(JSON.stringify(session.brief, null, 2))
    lines.push('```')
  }
  return lines.join('\n')
}

export interface ExportResult {
  blob: Blob
  version: string
  filename: string
  files: number
  bytes: number
}

export async function buildExportZip(session: Session): Promise<ExportResult> {
  const version = nextExportVersion(session)
  const root = `Lumo_Export_${slugify(session.title)}_${version}`
  const zip = new JSZip()
  const dir = zip.folder(root)
  if (!dir) throw new Error('Impossible de créer l’archive.')

  const manifestFiles: { path: string; sha256: string; bytes: number; mime: string }[] = []
  const checksumLines: string[] = []
  const missing: string[] = []

  async function addTextFile(path: string, content: string, mime = 'text/markdown; charset=utf-8') {
    const bytes = new TextEncoder().encode(content)
    const hash = await sha256(bytes)
    dir!.file(path, content)
    manifestFiles.push({ path, sha256: hash, bytes: bytes.length, mime })
    checksumLines.push(`${hash}  ${path}`)
  }

  async function addBase64File(path: string, b64: string, mime: string, fallbackSize?: number) {
    try {
      const bytes = base64ToBytes(b64)
      const hash = await sha256(bytes)
      dir!.file(path, b64, { base64: true })
      manifestFiles.push({ path, sha256: hash, bytes: bytes.length, mime })
      checksumLines.push(`${hash}  ${path}`)
    } catch {
      missing.push(path)
      void fallbackSize
    }
  }

  // 1. Conversation
  const messages = session.messages.filter((m) => !m.pending && !m.error)
  await addTextFile('conversation/transcript.json', JSON.stringify({ session: { id: session.id, title: session.title, mode: session.mode, createdAt: session.createdAt }, messages }, null, 2), 'application/json')
  await addTextFile('conversation/transcript.md', transcriptMarkdown(session, messages))

  // 2. Artefacts
  const allArtifacts = messages.flatMap((m) => m.artifacts ?? [])
  for (const a of allArtifacts) {
    if (a.kind === 'webcode' && a.files?.length) {
      // Projet web : chaque fichier de code est exporté tel quel
      for (const f of a.files) {
        const safeName = f.name.replace(/[^\w.+-]/g, '_')
        await addTextFile(`artifacts/web/${a.id}/${safeName}`, f.content, mimeFor(f.name))
      }
      continue
    }
    const path = `${artifactFolder(a.kind)}/${a.id}.${artifactExtension(a)}`
    if (a.kind === 'image' || (a.kind === 'audio' && !a.demo)) {
      const data = a.data ?? (await getArtifactData(a.id))
      if (data) await addBase64File(path, data, a.mimeType, a.bytes)
      else missing.push(path)
    } else {
      const text =
        a.text ??
        (a.demo
          ? `# ${a.name}\n\nArtefact de démonstration Lumo (${a.kind}).\nBranchez le fournisseur « ${a.provider} » pour un rendu réel.`
          : '')
      await addTextFile(path, text, a.kind === 'design' ? 'application/json' : 'text/markdown; charset=utf-8')
    }
  }
  if (missing.length) {
    await addTextFile(
      'artifacts/_FICHIERS_MANQUANTS.md',
      `# Fichiers manquants\n\nCes artefacts étaient référencés dans la conversation mais leurs données\nbinaires ne sont plus disponibles localement :\n\n${missing.map((m) => `- ${m}`).join('\n')}\n`,
    )
  }

  // 3. Métadonnées
  const providersJson = {
    session_models: session.models,
    artifacts: allArtifacts.map((a) => ({ id: a.id, kind: a.kind, name: a.name, provider: a.provider, demo: !!a.demo })),
  }
  await addTextFile('metadata/providers.json', JSON.stringify(providersJson, null, 2), 'application/json')
  await addTextFile('metadata/checksums.sha256', checksumLines.join('\n') + '\n', 'text/plain')
  if (session.brief) {
    await addTextFile('metadata/brief.json', JSON.stringify(session.brief, null, 2), 'application/json')
  }

  // 4. manifest.json — la clé du versioning
  const manifest = {
    export_version: '1.0',
    lumo_version: '0.1.0',
    session_id: session.id,
    session_title: session.title,
    session_mode: session.mode,
    created_at: new Date(session.createdAt).toISOString(),
    exported_at: new Date().toISOString(),
    export_number: session.exports.length + 1,
    version,
    parent_export: session.exports.length ? session.exports[session.exports.length - 1].version : null,
    message_count: messages.length,
    files: manifestFiles,
  }
  await addTextFile('manifest.json', JSON.stringify(manifest, null, 2), 'application/json')

  // 5. README.md
  const readme = `# Export Lumo — ${session.title}

Archive générée automatiquement par **Lumo** le ${new Date().toLocaleString('fr-FR')}.

| | |
|---|---|
| Version | **${version}** |
| Export n° | ${session.exports.length + 1}${session.exports.length ? ` (précédent : ${session.exports[session.exports.length - 1].version})` : ''} |
| Mode | ${session.mode} |
| Messages | ${messages.length} |
| Artefacts | ${allArtifacts.length} |
| Fichiers | ${manifestFiles.length} (${fmtBytes(manifestFiles.reduce((s, f) => s + f.bytes, 0))}) |

## Contenu

\`\`\`
${root}/
├── manifest.json          ← intégrité + généalogie du versioning
├── README.md
├── conversation/
│   ├── transcript.json    ← structure complète (rôles, horodatages, IDs)
│   └── transcript.md      ← version lisible
├── artifacts/             ← images, audio, vidéo, textes générés
└── metadata/
    ├── providers.json     ← quel modèle a produit quoi
    └── checksums.sha256   ← empreintes SHA-256
\`\`\`

## Vérifier l’intégrité

\`\`\`bash
shasum -a 256 -c metadata/checksums.sha256
\`\`\`

> Archive autonome : elle ne dépend d’aucun serveur Lumo pour être relue.
`
  await addTextFile('README.md', readme)

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
  return {
    blob,
    version,
    filename: `${root}.zip`,
    files: manifestFiles.length,
    bytes: blob.size,
  }
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}

export function downloadText(content: string, filename: string, mime = 'text/markdown; charset=utf-8') {
  downloadBlob(new Blob([content], { type: mime }), filename)
}
