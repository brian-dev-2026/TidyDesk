import type { Page } from '../components/Sidebar'

export function DashboardPage(_: { onNavigate: (p: Page) => void }): JSX.Element {
  return <h1 className="text-2xl font-semibold">Dashboard</h1>
}
