import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const maxDuration = 120

interface Turn {
  role: 'user' | 'assistant'
  content: string
}

/** Fournisseurs externes compatibles OpenAI (clés gérées dans Paramètres) */
const EXTERNAL_BASE: Record<string, { baseUrl?: string; model: string }> = {
  mistral: { baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-large-latest' },
  agnes: { baseUrl: 'https://apihub.agnes-ai.com/v1', model: 'agnes-2.5-flash' },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  openrouter: { baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/auto' },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  custom: { model: 'local-model' },
}

async function callOpenAICompatible(
  baseUrl: string,
  key: string,
  model: string,
  system: string,
  turns: Turn[],
): Promise<string> {
  const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: system }, ...turns.slice(-16)],
    }),
    signal: AbortSignal.timeout(100_000),
  })
  const json = await res.json().catch(() => ({}))
  const content = json?.choices?.[0]?.message?.content
  if (!res.ok || !content) {
    throw new Error(json?.error?.message || `Le fournisseur a répondu ${res.status}.`)
  }
  return String(content)
}

/* ---------------- Mémoire auto-apprentissage ---------------- */

async function loadMemories(): Promise<string> {
  const memories = await db.agentMemory.findMany({
    orderBy: [{ weight: 'desc' }, { updatedAt: 'desc' }],
    take: 8,
  })
  if (memories.length === 0) return ''
  return (
    '\n\n## MÉMOIRE APPRISE (auto-apprentissage des agents Lumo)\n' +
    'Prends en compte ces apprentissages issus des interactions précédentes :\n' +
    memories.map((m) => `- ${m.content}`).join('\n')
  )
}

async function recordMemory(kind: string, key: string, content: string, weight: number) {
  try {
    await db.agentMemory.upsert({
      where: { key },
      update: { weight: { increment: 0.2 }, hits: { increment: 1 }, lastUsedAt: new Date() },
      create: { kind, key, content, weight },
    })
  } catch {
    /* l'apprentissage ne doit jamais casser la conversation */
  }
}

/** Extraction légère de faits : Lumo « apprend » ce que l'utilisateur lui confie */
async function learnFromUserMessage(text: string) {
  const t = text.trim()
  if (t.length < 6) return
  const patterns: { re: RegExp; tpl: (m: RegExpMatchArray) => string }[] = [
    {
      re: /je m'?appelle\s+([A-ZÀ-Ÿa-zà-ÿ][\wÀ-ÿ'-]{1,29})/i,
      tpl: (m) => `L'utilisateur s'appelle ${m[1]}.`,
    },
    {
      re: /je (?:préfère|prefere|préfére)\s+(.{3,90}?)(?:[.!?;]|$)/i,
      tpl: (m) => `Préférence exprimée : l'utilisateur préfère ${m[1].trim()}.`,
    },
    {
      re: /retiens(?:-moi)? que\s+(.{3,140}?)(?:[.!?;]|$)/i,
      tpl: (m) => `À retenir (demande explicite) : ${m[1].trim()}.`,
    },
    {
      re: /à partir de (?:maintenant|aujourd'hui|demain),?\s+(.{3,140}?)(?:[.!?;]|$)/i,
      tpl: (m) => `Nouvelle consigne permanente : ${m[1].trim()}.`,
    },
    {
      re: /je (?:travaille|bosse)\s+(?:chez|pour|sur)\s+(.{2,90}?)(?:[.!?;]|$)/i,
      tpl: (m) => `Contexte professionnel : l'utilisateur travaille ${/chez|pour/.test(t) ? 'sur ' : ''}${m[1].trim()}.`,
    },
  ]
  for (const p of patterns) {
    const m = t.match(p.re)
    if (m) {
      await recordMemory('fact', `fact:${m[0].toLowerCase().slice(0, 90)}`, p.tpl(m), 2)
    }
  }
}

async function touchMemories() {
  try {
    const top = await db.agentMemory.findMany({ orderBy: { weight: 'desc' }, take: 8, select: { id: true } })
    await Promise.all(
      top.map((m) =>
        db.agentMemory.update({ where: { id: m.id }, data: { hits: { increment: 1 }, lastUsedAt: new Date() } }),
      ),
    )
  } catch {
    /* best effort */
  }
}

/* ---------------- Handler ---------------- */

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const messages: Turn[] = Array.isArray(body.messages) ? body.messages : []
    const system: string | undefined =
      typeof body.system === 'string' && body.system.trim() ? body.system : undefined
    const provider: string = typeof body.provider === 'string' ? body.provider : 'lumo-core'
    const hfModel: string | undefined = typeof body.hfModel === 'string' && body.hfModel.trim() ? body.hfModel.trim() : undefined

    if (!messages.length) {
      return NextResponse.json({ ok: false, error: 'Messages requis.' }, { status: 400 })
    }

    const history = messages
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-16)
      .map((m) => ({ role: m.role, content: m.content.slice(0, 8000) }))

    // Auto-apprentissage : mémoriser ce que l'utilisateur confie
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')
    if (lastUser) void learnFromUserMessage(lastUser.content)

    // Injecter la mémoire apprise dans le prompt système
    let fullSystem = system || 'Tu es Lumo, un agent conversationnel chaleureux et efficace. Réponds en Markdown, en français par défaut.'
    try {
      const memoryBlock = await loadMemories()
      if (memoryBlock) fullSystem += memoryBlock
      void touchMemories()
    } catch {
      /* la mémoire est optionnelle */
    }

    /* ---- Routage fournisseur ---- */
    if (provider !== 'lumo-core') {
      if (provider === 'hf') {
        const hfKey = (await db.apiKey.findUnique({ where: { provider: 'huggingface' } }))?.secret
        if (!hfKey) {
          return NextResponse.json({
            ok: false,
            error: 'Aucune clé Hugging Face enregistrée. Ajoutez-la dans Paramètres → Clés API.',
            fallback: true,
          })
        }
        if (!hfModel) {
          return NextResponse.json({
            ok: false,
            error: 'Modèle Hugging Face requis (ex. : meta-llama/Llama-3.2-3B-Instruct).',
            fallback: true,
          })
        }
        const content = await callOpenAICompatible(
          'https://router.huggingface.co/v1', hfKey, hfModel, fullSystem, history,
        )
        return NextResponse.json({ ok: true, content, providerUsed: `hf:${hfModel}` })
      }

      const cfg = EXTERNAL_BASE[provider]
      if (!cfg) {
        return NextResponse.json({ ok: false, error: 'Fournisseur inconnu.', fallback: true })
      }
      const keyRow = await db.apiKey.findUnique({ where: { provider } })
      if (!keyRow) {
        return NextResponse.json({
          ok: false,
          error: `Aucune clé ${provider} enregistrée. Ajoutez-la dans Paramètres → Clés API.`,
          fallback: true,
        })
      }
      const base = provider === 'custom' && keyRow.baseUrl ? keyRow.baseUrl : cfg.baseUrl
      if (!base) {
        return NextResponse.json({ ok: false, error: 'URL de base manquante.', fallback: true })
      }
      const content = await callOpenAICompatible(base, keyRow.secret, cfg.model, fullSystem, history)
      return NextResponse.json({ ok: true, content, providerUsed: provider })
    }

    /* ---- Lumo Core (moteur intégré) ---- */
    try {
      const zai = await ZAI.create()
      const completion = await zai.chat.completions.create({
        messages: [{ role: 'assistant', content: fullSystem }, ...history],
        thinking: { type: 'disabled' },
      })
      const content = completion.choices[0]?.message?.content ?? ''
      if (!content.trim()) {
        return NextResponse.json({ ok: false, error: 'Réponse vide du moteur.', fallback: true }, { status: 502 })
      }
      return NextResponse.json({ ok: true, content, providerUsed: 'lumo-core' })
    } catch (e) {
      // Lumo Core indisponible → proposer explicitement les alternatives
      return NextResponse.json(
        {
          ok: false,
          error: `Lumo Core est indisponible (${e instanceof Error ? e.message : 'erreur moteur'}).`,
          fallback: true,
          available: ['mistral', 'agnes', 'hf'],
        },
        { status: 503 },
      )
    }
  } catch (e) {
    return NextResponse.json(
      {
        ok: false,
        error: e instanceof Error ? e.message : 'Erreur du moteur Lumo.',
        fallback: true,
        available: ['mistral', 'agnes', 'hf'],
      },
      { status: 500 },
    )
  }
}
