'use client'

import { AudioLines, BookOpen, Clapperboard, FolderKanban, Image as ImageIcon, PenLine, Sparkles } from 'lucide-react'
import type { Mode } from '@/lib/lumo/types'

export function ModeIcon({ mode, className }: { mode: Mode; className?: string }) {
  switch (mode) {
    case 'text':
      return <PenLine className={className} aria-hidden="true" />
    case 'image':
      return <ImageIcon className={className} aria-hidden="true" />
    case 'video':
      return <Clapperboard className={className} aria-hidden="true" />
    case 'audio':
      return <AudioLines className={className} aria-hidden="true" />
    case 'book':
      return <BookOpen className={className} aria-hidden="true" />
    case 'project':
      return <FolderKanban className={className} aria-hidden="true" />
    default:
      return <Sparkles className={className} aria-hidden="true" />
  }
}
