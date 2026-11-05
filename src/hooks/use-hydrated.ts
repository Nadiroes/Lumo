'use client'

import { useSyncExternalStore } from 'react'

const emptySubscribe = () => () => {}

/** Détecte l’hydratation sans setState dans un effet. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  )
}
