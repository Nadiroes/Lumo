'use client'

/**
 * Lumo — studio de création multimodal.
 * Point d’entrée unique : Mode Hub ↔ Fenêtre de conversation.
 */

import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { BookWizard } from '@/components/lumo/book-wizard'
import { ChatWindow } from '@/components/lumo/chat-window'
import { LumoMark } from '@/components/lumo/logo'
import { ModeHub } from '@/components/lumo/mode-hub'
import { useHydrated } from '@/hooks/use-hydrated'
import { useLumo } from '@/lib/lumo/store'
import type { BookBrief } from '@/lib/lumo/types'

export default function Home() {
  const mounted = useHydrated()
  const [bookWizardOpen, setBookWizardOpen] = useState(false)
  const view = useLumo((s) => s.view)
  const startSession = useLumo((s) => s.startSession)
  const generateBible = useLumo((s) => s.generateBible)

  async function startBook(brief: BookBrief) {
    const id = startSession('book', brief)
    setBookWizardOpen(false)
    await generateBible(id, brief)
  }

  if (!mounted) {
    return (
      <main
        className="h-dvh bg-background flex flex-col items-center justify-center gap-4"
        aria-busy="true"
        aria-label="Chargement de Lumo"
      >
        <LumoMark className="h-14 w-14 animate-pulse" />
        <p className="text-sm text-muted-foreground animate-pulse">Lumo s’allume…</p>
      </main>
    )
  }

  return (
    <main className="h-dvh overflow-hidden bg-background">
      <AnimatePresence mode="wait">
        {view === 'hub' ? (
          <motion.div
            key="hub"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="h-dvh"
          >
            <ModeHub onBookWizard={() => setBookWizardOpen(true)} />
          </motion.div>
        ) : (
          <motion.div
            key="chat"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="h-dvh"
          >
            <ChatWindow onStartBook={() => setBookWizardOpen(true)} />
          </motion.div>
        )}
      </AnimatePresence>

      <BookWizard open={bookWizardOpen} onOpenChange={setBookWizardOpen} onFinish={startBook} />
    </main>
  )
}
