import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export const runtime = 'nodejs'

/** Mémoire auto-apprentissage des agents Lumo : consultation et purge */

export async function GET() {
  try {
    const [memories, count] = await Promise.all([
      db.agentMemory.findMany({ orderBy: [{ weight: 'desc' }, { updatedAt: 'desc' }], take: 50 }),
      db.agentMemory.count(),
    ])
    return NextResponse.json({ ok: true, count, memories })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Erreur base de données.' },
      { status: 500 },
    )
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const id = new URL(req.url).searchParams.get('id')
    if (id) {
      await db.agentMemory.delete({ where: { id } })
    } else {
      await db.agentMemory.deleteMany({})
    }
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : 'Erreur serveur.' },
      { status: 500 },
    )
  }
}
