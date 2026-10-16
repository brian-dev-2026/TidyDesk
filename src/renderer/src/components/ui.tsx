import { forwardRef, useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { formatDuration } from '@shared/format'

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(' ')
}

// ---- Card ---------------------------------------------------------------

export function Card({
  title,
  subtitle,
  actions,
  children,
  className
}: {
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  className?: string
}): JSX.Element {
  return (
    <section
      className={cx(
        'rounded-2xl border border-line bg-surface/80 p-5 shadow-sm backdrop-blur animate-fade-in',
        className
      )}
    >
      {(title || actions) && (
        <header className="mb-4 flex items-start justify-between gap-4">
          <div>
            {title && <h2 className="text-[15px] font-semibold">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-sm text-muted">{subtitle}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

// ---- Button -------------------------------------------------------------

type Variant = 'primary' | 'ghost' | 'danger' | 'subtle'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant
  loading?: boolean
  icon?: ReactNode
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'subtle', loading, icon, className, children, disabled, ...rest },
  ref
) {
  const styles: Record<Variant, string> = {
    primary:
      'text-white bg-gradient-to-r from-indigo-500 to-violet-500 shadow-glow hover:brightness-110 active:brightness-95',
    subtle: 'bg-raised text-fg border border-line hover:bg-line/60',
    ghost: 'text-muted hover:text-fg hover:bg-raised',
    danger: 'text-white bg-rose-500 hover:bg-rose-600'
  }
  return (
    <button
      ref={ref}
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex h-9 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 text-sm font-medium transition',
        'disabled:cursor-not-allowed disabled:opacity-50',
        styles[variant],
        className
      )}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : icon}
      {children}
    </button>
  )
})

// ---- ProgressRing -------------------------------------------------------

export function ProgressRing({
  value,
  size = 120,
  stroke = 10,
  label,
  sublabel
}: {
  value: number
  size?: number
  stroke?: number
  label?: ReactNode
  sublabel?: ReactNode
}): JSX.Element {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = Math.min(1, Math.max(0, value))
  const id = `ring-${size}-${stroke}`
  return (
    <div className="relative" style={{ width: size, height: size }} role="img" aria-label={`${Math.round(v * 100)}%`}>
      <svg width={size} height={size} className="-rotate-90">
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#6366f1" />
            <stop offset="1" stopColor="#a855f7" />
          </linearGradient>
        </defs>
        <circle cx={size / 2} cy={size / 2} r={r} strokeWidth={stroke} fill="none" className="stroke-raised" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          strokeWidth={stroke}
          fill="none"
          stroke={`url(#${id})`}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v)}
          style={{ transition: 'stroke-dashoffset .8s cubic-bezier(.2,.8,.2,1)' }}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        {label && <div className="text-xl font-semibold leading-tight">{label}</div>}
        {sublabel && <div className="mt-0.5 text-xs text-muted">{sublabel}</div>}
      </div>
    </div>
  )
}

// ---- ProgressBar --------------------------------------------------------

export function ProgressBar({ value, indeterminate }: { value?: number; indeterminate?: boolean }): JSX.Element {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-raised">
      <div
        className={cx(
          'h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 transition-[width] duration-300',
          indeterminate && 'w-1/3 animate-[slide_1.2s_ease-in-out_infinite]'
        )}
        style={indeterminate ? undefined : { width: `${Math.round(Math.min(1, value ?? 0) * 100)}%` }}
      />
      <style>{'@keyframes slide{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}'}</style>
    </div>
  )
}

// ---- Badge --------------------------------------------------------------

export type Tone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger'

export function Badge({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }): JSX.Element {
  const tones: Record<Tone, string> = {
    neutral: 'bg-raised text-muted border-line',
    accent: 'bg-indigo-500/10 text-indigo-500 dark:text-indigo-300 border-indigo-500/25',
    success: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300 border-emerald-500/25',
    warning: 'bg-amber-500/10 text-amber-600 dark:text-amber-300 border-amber-500/30',
    danger: 'bg-rose-500/10 text-rose-600 dark:text-rose-300 border-rose-500/25'
  }
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium', tones[tone])}>
      {children}
    </span>
  )
}

// ---- Toggle -------------------------------------------------------------

export function Toggle({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}): JSX.Element {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition',
        checked ? 'bg-gradient-to-r from-indigo-500 to-violet-500' : 'bg-line'
      )}
    >
      <span
        className={cx(
          'inline-block h-5 w-5 rounded-full bg-white shadow transition-transform',
          checked ? 'translate-x-[22px]' : 'translate-x-0.5'
        )}
      />
    </button>
  )
}

// ---- Checkbox -----------------------------------------------------------

export function Checkbox({
  checked,
  onChange,
  label
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}): JSX.Element {
  return (
    <input
      type="checkbox"
      aria-label={label}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
      className="h-4 w-4 cursor-pointer rounded accent-indigo-500"
    />
  )
}

// ---- Countdown ----------------------------------------------------------

export function Countdown({ until }: { until: number }): JSX.Element {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30000)
    return () => clearInterval(t)
  }, [])
  return <span className="tabular-nums">{formatDuration(Math.max(0, until - now))}</span>
}

// ---- Empty state --------------------------------------------------------

export function Empty({ icon, title, children }: { icon: ReactNode; title: string; children?: ReactNode }): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-raised text-muted">{icon}</div>
      <div className="font-medium">{title}</div>
      {children && <div className="mt-1 max-w-sm text-sm text-muted">{children}</div>}
    </div>
  )
}

// ---- Page header --------------------------------------------------------

export function PageHeader({
  title,
  subtitle,
  actions
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
}): JSX.Element {
  return (
    <div className="mb-6 flex items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}
