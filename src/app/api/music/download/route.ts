import { NextRequest } from 'next/server'

export const runtime = 'nodejs'

/**
 * Proxy de téléchargement du morceau généré par un Space DiffRhythm.
 * Utilisé par le navigateur (chemin « client-studio ») pour éviter tout blocage
 * CORS sur /gradio_api/file=. Liste d'hôtes strictement allowlistée (anti-SSRF).
 */
const ALLOWED_HOSTS = new Set(['aslp-lab-diffrhythm2.hf.space', 'aslp-lab-diffrhythm.hf.space'])

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get('url') ?? ''
  let target: URL
  try {
    target = new URL(raw)
  } catch {
    return new Response(JSON.stringify({ ok: false, error: 'URL invalide' }), { status: 400 })
  }
  if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname)) {
    return new Response(JSON.stringify({ ok: false, error: 'Hôte non autorisé' }), { status: 403 })
  }

  try {
    const upstream = await fetch(target.toString(), { signal: AbortSignal.timeout(90_000) })
    if (!upstream.ok || !upstream.body) {
      return new Response(JSON.stringify({ ok: false, error: `Téléchargement impossible (${upstream.status})` }), {
        status: 502,
      })
    }
    const mime = upstream.headers.get('content-type') ?? 'audio/mpeg'
    return new Response(upstream.body, {
      headers: {
        'Content-Type': mime,
        'Cache-Control': 'no-store',
      },
    })
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message.slice(0, 120) : 'erreur réseau' }),
      { status: 504 },
    )
  }
}
