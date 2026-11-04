import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

/** Configuration des fournisseurs — endpoints officiels de validation */
const PROVIDER_CONFIG: Record<string, { name: string; baseUrl?: string; mode: 'openai' | 'hf' }> = {
  mistral: { name: 'Mistral AI', baseUrl: 'https://api.mistral.ai/v1', mode: 'openai' },
  agnes: { name: 'Agnes AI', baseUrl: 'https://apihub.agnes-ai.com/v1', mode: 'openai' },
  openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', mode: 'openai' },
  openrouter: { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', mode: 'openai' },
  groq: { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', mode: 'openai' },
  huggingface: { name: 'Hugging Face', mode: 'hf' },
  custom: { name: 'Endpoint personnalisé (llama.cpp, LM Studio…)', mode: 'openai' },
}

function mask(key: string): string {
  const k = key.trim()
  if (k.length <= 8) return `${k.slice(0, 2)}••••`
  return `${k.slice(0, 4)}••••••••${k.slice(-4)}`
}

async function validateKey(
  provider: string,
  key: string,
  baseUrl?: string,
): Promise<{ valid: boolean; detail: string }> {
  const cfg = PROVIDER_CONFIG[provider]
  if (!cfg) return { valid: false, detail: 'Fournisseur inconnu.' }
  if (provider === 'custom' && !baseUrl) {
    return { valid: false, detail: 'URL de base requise pour un endpoint personnalisé.' }
  }

  const base = (baseUrl?.replace(/\/+$/, '') || cfg.baseUrl) as string
  const url = cfg.mode === 'hf' ? 'https://huggingface.co/api/whoami-v2' : `${base}/models`

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(12_000),
    })
    if (res.ok) {
      return { valid: true, detail: 'Clé acceptée par le fournisseur.' }
    }
    if (res.status === 401 || res.status === 403) {
      return { valid: false, detail: `Clé refusée par ${cfg.name} (erreur ${res.status}).` }
    }
    return { valid: false, detail: `Réponse ${res.status} de ${cfg.name}.` }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Erreur réseau'
    return { valid: false, detail: `Impossible de joindre ${cfg.name} : ${msg}` }
  }
}

export async function GET() {
  try {
    const keys = await db.apiKey.findMany({
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        provider: true,
        maskedKey: true,
        baseUrl: true,
        status: true,
        lastCheckedAt: true,
        createdAt: true,
      },
    })
    return NextResponse.json({
      ok: true,
      keys: keys.map((k) => ({ ...k, name: PROVIDER_CONFIG[k.provider]?.name ?? k.provider })),
    })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Erreur base de données.' },
      { status: 500 },
    )
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const provider = String(body.provider || '')
    const key = String(body.key || '').trim()
    const baseUrl = typeof body.baseUrl === 'string' && body.baseUrl.trim() ? body.baseUrl.trim() : undefined

    if (!PROVIDER_CONFIG[provider]) {
      return NextResponse.json({ ok: false, error: 'Fournisseur inconnu.' }, { status: 400 })
    }
    if (key.length < 8) {
      return NextResponse.json({
        ok: false,
        status: 'invalid',
        detail: 'Clé trop courte — vérifiez qu’elle a été copiée en entier.',
      })
    }

    const check = await validateKey(provider, key, baseUrl)
    if (!check.valid) {
      return NextResponse.json({ ok: false, status: 'invalid', detail: check.detail })
    }

    const saved = await db.apiKey.upsert({
      where: { provider },
      update: { maskedKey: mask(key), secret: key, baseUrl, status: 'valid', lastCheckedAt: new Date() },
      create: { provider, maskedKey: mask(key), secret: key, baseUrl, status: 'valid' },
    })

    return NextResponse.json({
      ok: true,
      status: 'valid',
      detail: `Clé ${PROVIDER_CONFIG[provider].name} validée et sauvegardée.`,
      key: { id: saved.id, provider, maskedKey: saved.maskedKey, name: PROVIDER_CONFIG[provider].name },
    })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Erreur serveur.' },
      { status: 500 },
    )
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = new URL(req.url).searchParams.get('id')
    if (!id) return NextResponse.json({ ok: false, error: 'id requis.' }, { status: 400 })
    await db.apiKey.delete({ where: { id } })
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Erreur serveur.' },
      { status: 500 },
    )
  }
}
