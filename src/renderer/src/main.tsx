import { createRoot } from 'react-dom/client'
import './index.css'
import { App } from './App'

// send renderer errors to the main-process log file
window.addEventListener('error', (e) => {
  void window.tidy.logRenderer(`${e.message} @ ${e.filename}:${e.lineno}`)
})
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason
  void window.tidy.logRenderer(`Unhandled rejection: ${r instanceof Error ? (r.stack ?? r.message) : String(r)}`)
})

createRoot(document.getElementById('root')!).render(<App />)
