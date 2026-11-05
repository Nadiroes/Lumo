'use client'

import { Moon, Sun } from 'lucide-react'
import { useTheme } from 'next-themes'
import { Button } from '@/components/ui/button'
import { useHydrated } from '@/hooks/use-hydrated'

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()
  const mounted = useHydrated()

  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label={mounted && resolvedTheme === 'dark' ? 'Passer en thème clair' : 'Passer en thème sombre'}
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
    >
      {mounted && resolvedTheme === 'dark' ? <Sun className="h-4.5 w-4.5" /> : <Moon className="h-4.5 w-4.5" />}
    </Button>
  )
}
