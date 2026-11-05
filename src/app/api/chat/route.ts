import { NextRequest, NextResponse } from 'next/server'
import ZAI from 'z-ai-web-dev-sdk'
import { db } from '@/lib/db'
import { chatLocal, findLocalForRepo } from '@/lib/lumo/local-engine'

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

/**
 * Version streamée de Lumo Core : renvoie un flux texte brut (deltas).
 * Si le streaming échoue avant le premier token, repli automatique sur l’appel complet.
 */
function lumoCoreStream(fullSystem: string, history: Turn[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      let emitted = false
      const push = (s: string) => {
        emitted = true
        controller.enqueue(encoder.encode(s))
      }
      try {
        const zai = await ZAI.create()
        const completion = await zai.chat.completions.create({
          messages: [{ role: 'assistant', content: fullSystem }, ...history],
          thinking: { type: 'disabled' },
          stream: true,
        })
        for await (const chunk of completion) {
          const delta =
            (chunk as { choices?: { delta?: { content?: string } }[] }).choices?.[0]?.delta?.content ?? ''
          if (delta) push(delta)
        }
        if (!emitted) throw new Error('Réponse vide du moteur.')
      } catch {
        if (!emitted) {
          // Repli : appel complet sans streaming
          try {
            const zai = await ZAI.create()
            const completion = await zai.chat.completions.create({
              messages: [{ role: 'assistant', content: fullSystem }, ...history],
              thinking: { type: 'disabled' },
            })
            const content = completion.choices[0]?.message?.content ?? ''
            if (!content.trim()) throw new Error('Réponse vide du moteur.')
            push(content)
          } catch (e) {
            push(
              `\u0000ERROR:Lumo Core est indisponible (${e instanceof Error ? e.message.slice(0, 140) : 'erreur moteur'}).`,
            )
          }
        } else {
          push('\u0000ERROR:Le flux a été interrompu en cours de génération.')
        }
      } finally {
        controller.close()
      }
    },
  })
}

/* ------------- Chaîne de repli : local → bloc → lien général → clés API → Lumo Core ------------- */

interface ChainStep {
  source: string
  model?: string
  ok: boolean
  error?: string
}

/** Ordre de repli sur les clés API enregistrées */
const API_ORDER = ['mistral', 'agnes', 'openai', 'openrouter', 'groq', 'custom'] as const

async function runHfRouter(hfKey: string, model: string, fullSystem: string, history: Turn[]): Promise<string> {
  return callOpenAICompatible('https://router.huggingface.co/v1', hfKey, model, fullSystem, history)
}

async function runFallbackChain(
  fullSystem: string,
  history: Turn[],
  blockHf: string | undefined,
  globalHf: string | undefined,
  localModelHint: string | undefined,
): Promise<{ content: string; providerUsed: string; chain: ChainStep[]; note?: string }> {
  const chain: ChainStep[] = []
  const hfKey = (await db.apiKey.findUnique({ where: { provider: 'huggingface' } }).catch(() => null))?.secret

  const tryStep = async (source: string, model: string | undefined, run: () => Promise<string>): Promise<string | null> => {
    if (!model) return null
    try {
      const content = await run()
      chain.push({ source, model, ok: true })
      return content
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'erreur inconnue'
      chain.push({ source, model, ok: false, error: msg.slice(0, 180) })
      return null
    }
  }

  // 0) Moteur local (CPU, llama.cpp) — prioritaire quand installé : rapide, sans quota,
  //    les données ne quittent pas la machine. Choisi explicitement, ou retrouvé
  //    automatiquement quand un GGUF du modèle de bloc est installé.
  const localId = localModelHint || (blockHf ? (await findLocalForRepo(blockHf))?.id : undefined)
  if (localId) {
    const content = await tryStep('local', localId, () => chatLocal(localId, fullSystem, history))
    if (content !== null) {
      return {
        content,
        providerUsed: `local:${localId}`,
        chain,
        note: `Généré localement sur CPU par ${localId.split('::').pop()} — aucune donnée envoyée en ligne.`,
      }
    }
  }

  // 1) Modèle du bloc (lien HF spécifique)
  if (blockHf) {
    if (!hfKey) {
      chain.push({ source: 'bloc', model: blockHf, ok: false, error: 'aucune clé Hugging Face enregistrée' })
    } else {
      const content = await tryStep('bloc', blockHf, () => runHfRouter(hfKey, blockHf, fullSystem, history))
      if (content !== null) return { content, providerUsed: `hf:${blockHf}`, chain }
    }
  }

  // 2) Lien général HF (relais principal)
  if (globalHf && globalHf !== blockHf) {
    if (!hfKey) {
      chain.push({ source: 'général', model: globalHf, ok: false, error: 'aucune clé Hugging Face enregistrée' })
    } else {
      const content = await tryStep('général', globalHf, () => runHfRouter(hfKey, globalHf, fullSystem, history))
      if (content !== null) {
        const failedBloc = chain.find((s) => s.source === 'bloc' && !s.ok)
        const note = failedBloc
          ? `Lien du bloc indisponible (${failedBloc.error ?? 'erreur'}) → relais via le lien général (${globalHf}).`
          : undefined
        return { content, providerUsed: `hf:${globalHf}`, chain, note }
      }
    }
  }

  // 3) Clés API enregistrées (Mistral, Agnes, OpenAI…)
  const failedSoFar = () =>
    chain
      .filter((s) => !s.ok)
      .map((s) => `${s.source === 'bloc' ? 'lien du bloc' : s.source === 'général' ? 'lien général' : s.source} (${s.error?.slice(0, 70) ?? 'erreur'})`)
      .join(' ; ')
  for (const provider of API_ORDER) {
    const keyRow = await db.apiKey.findUnique({ where: { provider } }).catch(() => null)
    if (!keyRow) continue
    const cfg = EXTERNAL_BASE[provider]
    const base = provider === 'custom' && keyRow.baseUrl ? keyRow.baseUrl : cfg?.baseUrl
    if (!base) continue
    const content = await tryStep(`api:${provider}`, cfg?.model, () =>
      callOpenAICompatible(base, keyRow.secret, cfg?.model ?? 'local-model', fullSystem, history),
    )
    if (content !== null) {
      return {
        content,
        providerUsed: provider,
        chain,
        note: chain.some((s) => !s.ok) ? `Liens HF indisponibles — ${failedSoFar()} → relais via la clé API ${provider}.` : undefined,
      }
    }
  }

  // 4) Lumo Core (moteur intégré)
  try {
    const zai = await ZAI.create()
    const completion = await zai.chat.completions.create({
      messages: [{ role: 'assistant', content: fullSystem }, ...history],
      thinking: { type: 'disabled' },
    })
    const content = completion.choices[0]?.message?.content ?? ''
    if (!content.trim()) throw new Error('Réponse vide du moteur.')
    return {
      content,
      providerUsed: 'lumo-core',
      chain,
      note: chain.some((s) => !s.ok)
        ? `Liens HF indisponibles — ${failedSoFar()} → relais via le moteur intégré Lumo Core.`
        : 'Relais via le moteur intégré Lumo Core.',
    }
  } catch (e) {
    chain.push({ source: 'lumo-core', ok: false, error: e instanceof Error ? e.message.slice(0, 180) : 'erreur moteur' })
    const failed = chain.find((s) => !s.ok)
    return {
      content: '',
      providerUsed: 'aucun',
      chain,
      note: `Toute la chaîne a échoué (début : ${failed?.source ?? '?'} — ${failed?.error ?? 'erreur'}).`,
    }
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const messages: Turn[] = Array.isArray(body.messages) ? body.messages : []
    const system: string | undefined =
      typeof body.system === 'string' && body.system.trim() ? body.system : undefined
    const provider: string = typeof body.provider === 'string' ? body.provider : 'lumo-core'
    const hfModel: string | undefined = typeof body.hfModel === 'string' && body.hfModel.trim() ? body.hfModel.trim() : undefined
    const globalHf: string | undefined =
      typeof body.globalHf === 'string' && body.globalHf.trim() ? body.globalHf.trim() : undefined
    const localModel: string | undefined =
      typeof body.localModel === 'string' && body.localModel.trim() ? body.localModel.trim() : undefined
    const wantStream: boolean = body.stream === true

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

    /* ---- Chaîne de repli : local → modèle de bloc → lien général → clés API → Lumo Core ---- */
    if (hfModel || globalHf || localModel) {
      const r = await runFallbackChain(fullSystem, history, hfModel, globalHf, localModel)
      if (r.content) {
        return NextResponse.json({
          ok: true,
          content: r.content,
          providerUsed: r.providerUsed,
          chain: r.chain,
          note: r.note,
        })
      }
      return NextResponse.json(
        { ok: false, error: r.note ?? 'Tous les moteurs sont indisponibles.', chain: r.chain, fallback: true },
        { status: 503 },
      )
    }

    /* ---- Routage fournisseur explicite (bouton « Réessayer avec… ») ---- */
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
      if (wantStream) {
        return new Response(lumoCoreStream(fullSystem, history), {
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'no-cache, no-transform',
            'X-Accel-Buffering': 'no',
          },
        })
      }
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
