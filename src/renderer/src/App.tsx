import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Settings } from '@shared/types'
import { call, SettingsContext, tidy } from './api'
import { Sidebar, type Page } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import { Toasts } from './components/Toasts'
import { FirstRunNotice } from './components/FirstRunNotice'
import { DashboardPage } from './pages/Dashboard'
import { JunkPage } from './pages/Junk'
import { OrganizerPage } from './pages/Organizer'
import { DuplicatesPage } from './pages/Duplicates'
import { SettingsPage } from './pages/Settings'
import { LargeFilesPage } from './pages/LargeFiles'
import { EmptyFoldersPage } from './pages/EmptyFolders'

function useTheme(theme: Settings['theme'] | undefined): void {
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = (): void => {
      const dark = theme === 'dark' || (theme !== 'light' && mq.matches)
      document.documentElement.classList.toggle('dark', dark)
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [theme])
}

export function App(): JSX.Element {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [page, setPage] = useState<Page>('dashboard')

  useEffect(() => {
    void call(tidy.getSettings()).then((s) => s && setSettings(s))
  }, [])
  useTheme(settings?.theme)

  const update = useCallback(async (p: Partial<Settings>) => {
    setSettings((s) => (s ? { ...s, ...p } : s))
    const next = await call(tidy.setSettings(p))
    if (next) setSettings(next)
  }, [])

  const ctx = useMemo(() => (settings ? { settings, update } : null), [settings, update])
  if (!ctx) return <div className="h-full bg-bg" />

  return (
    <SettingsContext.Provider value={ctx}>
      <div className="flex h-full flex-col">
        <TitleBar />
        <div className="flex min-h-0 flex-1">
          <Sidebar page={page} onNavigate={setPage} />
          <main className="relative min-w-0 flex-1 overflow-y-auto">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-indigo-500/[0.07] to-transparent" />
            <div className="relative mx-auto max-w-5xl px-8 py-7">
              {page === 'dashboard' && <DashboardPage onNavigate={setPage} />}
              {page === 'junk' && <JunkPage />}
              {page === 'organizer' && <OrganizerPage />}
              {page === 'duplicates' && <DuplicatesPage />}
              {page === 'large' && <LargeFilesPage />}
              {page === 'empty' && <EmptyFoldersPage />}
              {page === 'settings' && <SettingsPage />}
            </div>
          </main>
        </div>
      </div>
      <FirstRunNotice />
      <Toasts />
    </SettingsContext.Provider>
  )
}
