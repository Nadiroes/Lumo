import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'

export const runtime = 'nodejs'
export const maxDuration = 120

interface Turn {
  role: 'user' | 'assistant'
  content: string
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const messages: Turn[] = Array.isArray(body.messages) ? body.messages : []
    const system: string | undefined =
      typeof body.system === 'string' && body.system.trim() ? body.system : undefined

    if (!messages.length) {
      return NextResponse.json({ ok: false, error: 'Messages requis.' }, { status: 400 })
    }

    const zai = await ZAI.create()
    const history = messages
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-16)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }))

    const completion = await zai.chat.completions.create({
      messages: [
        {
          role: 'assistant',
          content:
            system ||
            'Tu es Lumo, un agent conversationnel chaleureux et efficace. Réponds en Markdown, en français par défaut.',
        },
        ...history,
      ],
      thinking: { type: 'disabled' },
    })

    const content = completion.choices[0]?.message?.content ?? ''
    if (!content.trim()) {
      return NextResponse.json({ ok: false, error: 'Réponse vide du moteur.' }, { status: 502 })
    }
    return NextResponse.json({ ok: true, content })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Erreur du moteur Lumo.' },
      { status: 500 },
    )
  }
}
