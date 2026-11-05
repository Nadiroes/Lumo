import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

/**
 * Apprentissage par feedback : le pouce ↑/↓ de l’utilisateur devient une
 * mémoire exploitable par les agents Lumo (injectée dans les prompts suivants).
 */

function truncate(s: string, n: number): string {
  const t = s.trim().replace(/\s+/g, ' ')
  return t.length <= n ? t : t.slice(0, n - 1) + '…'
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const verdict = body.verdict === 'up' ? 'up' : body.verdict === 'down' ? 'down' : null
    const userMessage = String(body.userMessage || '')
    const assistantContent = String(body.assistantContent || '')
    const hint = typeof body.hint === 'string' && body.hint.trim() ? body.hint.trim() : ''

    if (!verdict) {
      return NextResponse.json({ ok: false, error: 'verdict requis (up|down).' }, { status: 400 })
    }

    const key = `feedback:${truncate(userMessage || assistantContent, 80)}:${verdict}`

    const content =
      verdict === 'up'
        ? `Réponse appréciée 👍 — à la demande « ${truncate(userMessage, 120) || 'contexte similaire'} », l’utilisateur a aimé ce style de réponse. Reproduire ce ton, ce niveau de détail et cette structure.`
        : `Réponse jugée peu utile 👎 — à la demande « ${truncate(userMessage, 120) || 'contexte similaire'} ». Corriger le tir : être plus ${hint || 'concret, structuré et direct'}, éviter ce type de réponse.`

    const memory = await db.agentMemory.upsert({
      where: { key },
      update: { weight: { increment: 0.5 }, hits: { increment: 1 }, lastUsedAt: new Date() },
      create: { kind: 'feedback', key, content, weight: verdict === 'up' ? 1 : 1.2 },
    })

    return NextResponse.json({
      ok: true,
      memory: { id: memory.id, content: memory.content },
      message:
        verdict === 'up'
          ? 'Merci ! Lumo a appris de ce retour et mémorisé ce style.'
          : 'Retour noté : Lumo apprendra à mieux répondre sur ce point.',
    })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Erreur serveur.' },
      { status: 500 },
    )
  }
}
