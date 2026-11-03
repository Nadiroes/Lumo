'use client'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Separator } from '@/components/ui/separator'
import { useToast } from '@/hooks/use-toast'
import { clearArtifactStore } from '@/lib/lumo/artifact-store'
import { Settings } from 'lucide-react'
import { useTheme } from 'next-themes'
import { useHydrated } from '@/hooks/use-hydrated'

export function SettingsDialog({ trigger }: { trigger?: React.ReactNode }) {
  const { theme, setTheme } = useTheme()
  const mounted = useHydrated()

  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="icon" aria-label="Paramètres">
            <Settings className="h-4.5 w-4.5" />
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Paramètres</DialogTitle>
          <DialogDescription>
            Lumo v0.1 — démo locale. Toutes vos données (sessions, artefacts) restent sur votre machine.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 py-1">
          <div>
            <Label className="text-sm font-medium">Apparence</Label>
            <RadioGroup
              value={mounted ? theme : 'light'}
              onValueChange={setTheme}
              className="mt-2 grid grid-cols-3 gap-2"
            >
              {[
                { value: 'light', label: 'Clair' },
                { value: 'dark', label: 'Sombre' },
                { value: 'system', label: 'Système' },
              ].map((opt) => (
                <Label
                  key={opt.value}
                  className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border p-2.5 text-sm hover:bg-accent has-[button[data-state=checked]]:border-primary has-[button[data-state=checked]]:bg-accent"
                >
                  <RadioGroupItem value={opt.value} className="sr-only" />
                  {opt.label}
                </Label>
              ))}
            </RadioGroup>
          </div>

          <Separator />

          <div>
            <Label className="text-sm font-medium">Données locales</Label>
            <p className="mt-1 text-xs text-muted-foreground">
              Supprime toutes les sessions, modèles importés et artefacts stockés sur cet appareil.
            </p>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" size="sm" className="mt-2">
                  Réinitialiser toutes les données
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Tout réinitialiser ?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Cette action supprime définitivement vos sessions et artefacts locaux. Pensez à exporter
                    vos travaux importants en .zip avant de continuer.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Annuler</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={async () => {
                      try {
                        localStorage.removeItem('lumo-store-v1')
                        await clearArtifactStore()
                      } finally {
                        window.location.reload()
                      }
                    }}
                  >
                    Réinitialiser
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
