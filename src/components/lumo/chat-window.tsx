'use client'

/**
 * Fenêtre principale de conversation — conforme au wireframe Lumo :
 * sidebar historique (gauche) · fil + saisie (centre) · artefacts (droite).
 */

import { useMemo, useState } from 'react'
import { formatDistanceToNow } from 'date-fns'
import { fr } from 'date-fns/locale'
import {
  AudioLines,
  Clapperboard,
  Code2,
  Cuboid,
  Download,
  FileText,
  Home,
  Image as ImageIcon,
  LayoutDashboard,
  Menu,
  MessageSquarePlus,
  PanelRightOpen,
  Pin,
  Search,
  SendHorizontal,
  Trash2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useToast } from '@/hooks/use-toast'
import { ArtifactViewDialog } from '@/components/lumo/artifacts'
import { DesignStudioDialog } from '@/components/lumo/app-studio'
import { ExportDialog } from '@/components/lumo/export-dialog'
import { InputBar } from '@/components/lumo/input-bar'
import { LumoWordmark } from '@/components/lumo/logo'
import { ChatMessages } from '@/components/lumo/messages'
import { ModeIcon } from '@/components/lumo/mode-icon'
import { ModelHubDialog, ModelPicker } from '@/components/lumo/model-picker'
import { SettingsDialog } from '@/components/lumo/settings-dialog'
import { CodePreviewDialog } from '@/components/lumo/web-preview'
import { useLumo } from '@/lib/lumo/store'
import { MODE_INFO, type Artifact, type Mode, type Session } from '@/lib/lumo/types'

const ALL_MODES: Mode[] = [
  'text',
  'image',
  'video',
  'audio',
  'webdev',
  'appdesign',
  'book',
  'project',
  'free',
]

function artifactIcon(a: Artifact) {
  switch (a.kind) {
    case 'image':
      return <ImageIcon className="h-4 w-4" aria-hidden="true" />
    case 'audio':
      return <AudioLines className="h-4 w-4" aria-hidden="true" />
    case 'video':
      return <Clapperboard className="h-4 w-4" aria-hidden="true" />
    case 'webcode':
      return <Code2 className="h-4 w-4" aria-hidden="true" />
    case 'design':
      return <LayoutDashboard className="h-4 w-4" aria-hidden="true" />
    default:
      return <FileText className="h-4 w-4" aria-hidden="true" />
  }
}

/* ------------------------------------------------------------------ */
/* Sidebar : historique                                                */
/* ------------------------------------------------------------------ */

function SessionList({ activeId, onNavigate }: { activeId: string | null; onNavigate?: () => void }) {
  const sessions = useLumo((s) => s.sessions)
  const openSession = useLumo((s) => s.openSession)
  const startSessionLocal = useLumo((s) => s.startSession)
  const deleteSession = useLumo((s) => s.deleteSession)
  const togglePin = useLumo((s) => s.togglePin)
  const [query, setQuery] = useState('')

  const groups = useMemo(() => {
    const filtered = sessions
      .filter((s) => s.title.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => b.updatedAt - a.updatedAt)
    const pinned = filtered.filter((s) => s.pinned)
    const rest = filtered.filter((s) => !s.pinned)
    const byDate: Record<string, Session[]> = {}
    const now = new Date()
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
    for (const s of rest) {
      const label =
        s.updatedAt >= startOfToday
          ? 'Aujourd’hui'
          : s.updatedAt >= startOfToday - 86400000
            ? 'Hier'
            : s.updatedAt >= startOfToday - 7 * 86400000
              ? 'Cette semaine'
              : 'Plus ancien'
      ;(byDate[label] ??= []).push(s)
    }
    const out: { label: string; items: Session[] }[] = []
    if (pinned.length) out.push({ label: 'Épinglés', items: pinned })
    ;['Aujourd’hui', 'Hier', 'Cette semaine', 'Plus ancien'].forEach((l) => {
      if (byDate[l]?.length) out.push({ label: l, items: byDate[l] })
    })
    return out
  }, [sessions, query])

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-3">
      <Button
        onClick={() => {
          startSessionLocal('text')
          onNavigate?.()
        }}
        className="w-full justify-start gap-2"
      >
        <MessageSquarePlus className="h-4 w-4" aria-hidden="true" /> Nouveau chat
      </Button>
      <div className="relative">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher…"
          aria-label="Rechercher dans les conversations"
          className="h-8 pl-8 text-sm"
        />
      </div>

      <nav className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-0.5 scrollbar-thin" aria-label="Historique des conversations">
        {groups.length === 0 && (
          <p className="px-1 pt-4 text-center text-xs text-muted-foreground">Aucune conversation trouvée.</p>
        )}
        {groups.map((g) => (
          <div key={g.label}>
            <p className="mb-1 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {g.label}
            </p>
            <ul className="space-y-0.5">
              {g.items.map((s) => (
                <li key={s.id} className="group relative">
                  <button
                    onClick={() => {
                      openSession(s.id)
                      onNavigate?.()
                    }}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors ${
                      s.id === activeId ? 'bg-accent font-medium' : 'hover:bg-accent/60'
                    }`}
                    aria-current={s.id === activeId ? 'page' : undefined}
                  >
                    <ModeIcon mode={s.mode} className={`h-3.5 w-3.5 shrink-0 ${s.id === activeId ? 'text-primary' : 'text-muted-foreground'}`} />
                    <span className="min-w-0 flex-1 truncate">{s.title}</span>
                    {s.exports.length > 0 && (
                      <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-muted-foreground">
                        <Download className="h-3 w-3" aria-hidden="true" />
                        {s.exports.length}
                      </span>
                    )}
                  </button>
                  <span className="absolute right-1 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded-md bg-background/90 p-0.5 group-hover:flex">
                    <button
                      onClick={() => togglePin(s.id)}
                      aria-label={s.pinned ? 'Désépingler' : 'Épingler'}
                      className="rounded p-1 text-muted-foreground hover:text-primary"
                    >
                      <Pin className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => deleteSession(s.id)}
                      aria-label="Supprimer la conversation"
                      className="rounded p-1 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      <div className="space-y-1 border-t pt-2">
        <ModelHubDialog
          trigger={
            <Button variant="ghost" size="sm" className="w-full justify-start gap-2 text-sm text-muted-foreground">
              <Cuboid className="h-4 w-4" aria-hidden="true" /> Hub de modèles
            </Button>
          }
        />
        <HomeButton />
      </div>
    </div>
  )
}

function HomeButton() {
  const openHub = useLumo((s) => s.openHub)
  return (
    <Button variant="ghost" size="sm" onClick={openHub} className="w-full justify-start gap-2 text-sm text-muted-foreground">
      <Home className="h-4 w-4" aria-hidden="true" /> Retour à l’accueil
    </Button>
  )
}

/* ------------------------------------------------------------------ */
/* Panneau artefacts                                                   */
/* ------------------------------------------------------------------ */

function ArtifactPanelContent({ session, onOpen }: { session: Session; onOpen: (a: Artifact) => void }) {
  const artifacts = useMemo(
    () => session.messages.flatMap((m) => m.artifacts ?? []).slice().reverse(),
    [session.messages],
  )
  return (
    <div className="flex min-h-0 flex-1 flex-col p-3">
      <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Artefacts de la session ({artifacts.length})
      </p>
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5 scrollbar-thin">
        {artifacts.length === 0 ? (
          <div className="rounded-xl border border-dashed p-4 text-center text-xs leading-relaxed text-muted-foreground">
            Les images, transcriptions, bibles et documents générés apparaîtront ici, prêts pour l’export.
          </div>
        ) : (
          artifacts.map((a) => (
            <button
              key={a.id}
              onClick={() => onOpen(a)}
              className="flex w-full items-center gap-2.5 rounded-lg border bg-card p-2.5 text-left transition-colors hover:border-primary/40 hover:bg-accent"
            >
              <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                {artifactIcon(a)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium">{a.name}</span>
                <span className="block truncate text-[10px] text-muted-foreground">
                  {a.kind} · {a.provider}
                  {a.demo ? ' · démo' : ''}
                </span>
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Fenêtre principale                                                  */
/* ------------------------------------------------------------------ */

export function ChatWindow({ onStartBook }: { onStartBook: () => void }) {
  const activeId = useLumo((s) => s.activeId)
  const sessions = useLumo((s) => s.sessions)
  const setSessionMode = useLumo((s) => s.setSessionMode)
  const renameSession = useLumo((s) => s.renameSession)
  const startSession = useLumo((s) => s.startSession)
  const stopGeneration = useLumo((s) => s.stopGeneration)
  const openHub = useLumo((s) => s.openHub)
  const { toast } = useToast()

  const session = sessions.find((s) => s.id === activeId)
  const [editingTitle, setEditingTitle] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [showPanel, setShowPanel] = useState(false)
  const [mobileNav, setMobileNav] = useState(false)
  const [viewing, setViewing] = useState<Artifact | null>(null)
  const isWebcodeView = viewing?.kind === 'webcode'
  const isDesignView = viewing?.kind === 'design'

  if (!session) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-background">
        <LumoWordmark />
        <p className="text-sm text-muted-foreground">Aucune session active.</p>
        <Button onClick={() => startSession('text')} className="gap-1.5">
          <SendHorizontal className="h-4 w-4" /> Démarrer une session
        </Button>
        <HomeButton />
      </div>
    )
  }

  const generating = session.messages.some((m) => m.pending)

  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      {/* Sidebar bureau */}
      <aside className="hidden w-72 shrink-0 flex-col border-r bg-sidebar md:flex">
        <div className="flex h-14 items-center border-b px-4">
          <button onClick={openHub} aria-label="Retour à l’accueil Lumo">
            <LumoWordmark compact />
          </button>
        </div>
        <SessionList activeId={session.id} />
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* En-tête */}
        <header className="flex h-14 shrink-0 items-center gap-1.5 border-b bg-background/90 px-2 backdrop-blur sm:px-4">
          {/* Menu mobile */}
          <Sheet open={mobileNav} onOpenChange={setMobileNav}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="Ouvrir l’historique">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-80 p-0">
              <SheetHeader className="border-b px-4 py-3">
                <SheetTitle>
                  <LumoWordmark compact />
                </SheetTitle>
              </SheetHeader>
              <SessionList activeId={session.id} onNavigate={() => setMobileNav(false)} />
            </SheetContent>
          </Sheet>

          {/* Titre + mode */}
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <div className="min-w-0">
              {editingTitle ? (
                <input
                  autoFocus
                  defaultValue={session.title}
                  onBlur={(e) => {
                    renameSession(session.id, e.target.value)
                    setEditingTitle(false)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                    if (e.key === 'Escape') setEditingTitle(false)
                  }}
                  className="w-full rounded-md border bg-card px-2 py-1 text-sm outline-none focus:border-primary"
                  aria-label="Titre de la conversation"
                />
              ) : (
                <button
                  onClick={() => setEditingTitle(true)}
                  className="max-w-[30vw] truncate rounded-md px-1.5 py-0.5 text-sm font-medium hover:bg-accent sm:max-w-64"
                  aria-label="Renommer la conversation"
                  title="Cliquer pour renommer"
                >
                  {session.title}
                </button>
              )}
            </div>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 shrink-0 gap-1.5 text-xs" aria-label={`Mode actuel : ${MODE_INFO[session.mode].label}. Changer de mode.`}>
                  <ModeIcon mode={session.mode} className="h-3.5 w-3.5 text-primary" />
                  <span className="hidden sm:inline">{MODE_INFO[session.mode].label}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuLabel>Le mode n’est pas une prison</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {ALL_MODES.map((m) => (
                  <DropdownMenuItem
                    key={m}
                    onClick={() => {
                      if (m === 'book') {
                        onStartBook()
                      } else {
                        setSessionMode(session.id, m)
                        toast({ title: `Mode ${MODE_INFO[m].label}`, description: 'Le fil reste le même.' })
                      }
                    }}
                  >
                    <ModeIcon mode={m} className="h-4 w-4" />
                    <span className="min-w-0">
                      <span className="block text-sm">{MODE_INFO[m].label}</span>
                      <span className="block truncate text-xs text-muted-foreground">{MODE_INFO[m].tagline}</span>
                    </span>
                    {m === session.mode && <span className="ml-auto text-primary">●</span>}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          {/* Modèle + statut + actions */}
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="hidden lg:inline">
              <ModelPicker session={session} />
            </span>
            <span
              className={`hidden items-center gap-1.5 rounded-full px-2 py-1 text-[11px] sm:inline-flex ${
                generating ? 'bg-primary/10 text-primary' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              }`}
              role="status"
            >
              <span className={`h-1.5 w-1.5 rounded-full ${generating ? 'animate-pulse bg-primary' : 'bg-emerald-500'}`} />
              {generating ? 'Lumo travaille…' : 'Prêt'}
            </span>

            <Button
              variant="outline"
              size="sm"
              className="h-8 gap-1.5 text-xs"
              onClick={() => setExportOpen(true)}
              aria-label="Exporter la session"
            >
              <Download className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Exporter</span>
              {session.exports.length > 0 && (
                <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">
                  v{session.exports[session.exports.length - 1].version}
                </span>
              )}
            </Button>

            <Button
              variant="ghost"
              size="icon"
              className="xl:hidden"
              onClick={() => setShowPanel((v) => !v)}
              aria-label="Afficher le panneau des artefacts"
            >
              <PanelRightOpen className="h-4.5 w-4.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                startSession(session.mode)
                toast({ title: 'Nouvelle session créée' })
              }}
              aria-label="Nouveau chat"
            >
              <MessageSquarePlus className="h-4.5 w-4.5" />
            </Button>
            <SettingsDialog />
          </div>
        </header>

        {/* Corps : fil + panneau */}
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <ChatMessages session={session} />
            <InputBar session={session} generating={generating} onStop={() => stopGeneration(session.id)} />
          </div>

          {/* Panneau artefacts — bureau */}
          <aside className="hidden w-80 shrink-0 flex-col border-l bg-sidebar xl:flex">
            <ArtifactPanelContent session={session} onOpen={setViewing} />
            <div className="border-t p-3">
              <Button variant="outline" className="w-full gap-1.5" onClick={() => setExportOpen(true)}>
                <Download className="h-4 w-4" /> Exporter la session (.zip)
              </Button>
              <p className="mt-2 text-center text-[11px] text-muted-foreground">
                {session.savedToProject ? 'Conservée dans le projet · ' : ''}
                {formatDistanceToNow(new Date(session.updatedAt), { addSuffix: true, locale: fr })}
              </p>
            </div>
          </aside>
        </div>
      </div>

      {/* Panneau artefacts — mobile / tablette */}
      {showPanel && (
        <Sheet open={showPanel} onOpenChange={setShowPanel}>
          <SheetContent side="right" className="flex w-80 flex-col p-0">
            <SheetHeader className="border-b px-4 py-3">
              <SheetTitle className="font-display text-base">Artefacts</SheetTitle>
            </SheetHeader>
            <ArtifactPanelContent
              session={session}
              onOpen={(a) => {
                setViewing(a)
                setShowPanel(false)
              }}
            />
            <div className="border-t p-3">
              <Button
                variant="outline"
                className="w-full gap-1.5"
                onClick={() => {
                  setExportOpen(true)
                  setShowPanel(false)
                }}
              >
                <Download className="h-4 w-4" /> Exporter la session (.zip)
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      )}

      <ExportDialog session={session} open={exportOpen} onOpenChange={setExportOpen} />
      <CodePreviewDialog artifact={viewing} open={!!viewing && isWebcodeView} onOpenChange={(v) => !v && setViewing(null)} />
      <DesignStudioDialog artifact={viewing} open={!!viewing && isDesignView} onOpenChange={(v) => !v && setViewing(null)} />
      <ArtifactViewDialog
        artifact={viewing}
        open={!!viewing && !isWebcodeView && !isDesignView}
        onOpenChange={(v) => !v && setViewing(null)}
      />
    </div>
  )
}
