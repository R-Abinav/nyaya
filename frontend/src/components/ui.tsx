import type {
  ButtonHTMLAttributes,
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
} from 'react';

// ─── Button ───────────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-white hover:opacity-90 active:opacity-80',
  secondary:
    'border border-line bg-panel text-ink hover:border-ink/20 active:bg-muted',
  ghost:
    'text-ink hover:bg-muted active:bg-muted/80',
  danger:
    'bg-incorrect text-white hover:opacity-90 active:opacity-80',
};

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      className={`inline-flex min-h-[2.375rem] items-center justify-center rounded-lg px-4 text-sm font-medium transition-opacity
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/70
        disabled:cursor-not-allowed disabled:opacity-40
        ${BUTTON_STYLES[variant]} ${className}`}
      {...props}
    />
  );
}

// ─── Badge ────────────────────────────────────────────────────────────────────

type BadgeTone = 'neutral' | 'upcoming' | 'active' | 'correct' | 'incorrect';

const BADGE_STYLES: Record<BadgeTone, string> = {
  neutral:   'bg-muted text-muted-fg',
  upcoming:  'bg-accent/10 text-accent',
  active:    'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400',
  correct:   'bg-correct/10 text-correct',
  incorrect: 'bg-incorrect/10 text-incorrect',
};

export function Badge({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${BADGE_STYLES[tone]} ${className}`}
    >
      {children}
    </span>
  );
}

// ─── StatusBadge ──────────────────────────────────────────────────────────────

import type { CaseStatus } from '../types';

const STATUS_LABEL: Record<CaseStatus, string> = {
  upcoming: 'Upcoming',
  active: 'Active',
  resolved: 'Resolved',
};

export function StatusBadge({ status }: { status: CaseStatus }) {
  const tone: BadgeTone =
    status === 'upcoming' ? 'upcoming' :
    status === 'active'   ? 'active'   : 'neutral';
  return (
    <Badge tone={tone}>
      {status === 'active' && (
        <span
          aria-hidden
          className="mr-1.5 h-1.5 w-1.5 rounded-full bg-amber-500 inline-block animate-pulse"
        />
      )}
      {STATUS_LABEL[status]}
    </Badge>
  );
}

// ─── OutcomeBadge ─────────────────────────────────────────────────────────────

export function OutcomeBadge({ outcome }: { outcome: 'correct' | 'incorrect' }) {
  return (
    <Badge tone={outcome}>
      {outcome === 'correct' ? '✓ Correct' : '✗ Incorrect'}
    </Badge>
  );
}

// ─── Input ────────────────────────────────────────────────────────────────────

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className="h-10 w-full rounded-lg border border-line bg-canvas px-3 text-sm text-ink
        placeholder:text-muted-fg transition
        focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/20
        disabled:opacity-40"
      {...props}
    />
  );
}

// ─── Field ────────────────────────────────────────────────────────────────────

export function Field({
  label,
  hint,
  children,
  className = '',
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1.5 text-sm font-medium text-ink ${className}`}>
      {label}
      {children}
      {hint && <span className="text-xs font-normal text-muted-fg">{hint}</span>}
    </label>
  );
}

// ─── Divider ─────────────────────────────────────────────────────────────────

export function Divider({ className = '' }: { className?: string }) {
  return <hr className={`border-t border-line ${className}`} aria-hidden />;
}

// ─── Spinner ─────────────────────────────────────────────────────────────────

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      style={{ width: size, height: size }}
      className="inline-block rounded-full border-2 border-line border-t-accent animate-spin"
    />
  );
}

// ─── EmptyState ───────────────────────────────────────────────────────────────

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {description && <p className="text-sm text-muted-fg max-w-xs">{description}</p>}
      {action}
    </div>
  );
}

// ─── ErrorState ───────────────────────────────────────────────────────────────

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-16 text-center">
      <p className="text-sm text-incorrect">{message}</p>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

// ─── Dialog / Modal ───────────────────────────────────────────────────────────

export function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-ink/40 p-4 backdrop-blur-sm"
      role="presentation"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal
        aria-labelledby="dialog-title"
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-line bg-panel shadow-soft"
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4 border-b border-line">
          <h2 id="dialog-title" className="text-base font-semibold text-ink">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded p-1 text-muted-fg hover:bg-muted hover:text-ink transition"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M2 2L14 14M14 2L2 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>
  );
}

// ─── Legacy compat (used by old App.tsx code) ─────────────────────────────────

export function Card({
  children,
  className = '',
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <section
      className={`rounded-2xl border border-line bg-panel p-5 shadow-soft ${className}`}
      {...props}
    >
      {children}
    </section>
  );
}

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && (
          <p className="mb-1.5 text-xs font-medium tracking-widest text-muted-fg uppercase">
            {eyebrow}
          </p>
        )}
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-3xl">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-2xl text-sm text-muted-fg">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

export function StateMessage({
  type,
  message,
  onRetry,
}: {
  type: 'loading' | 'empty' | 'error';
  message: string;
  onRetry?: () => void;
}) {
  if (type === 'loading') return <EmptyState title={message} action={<Spinner />} />;
  if (type === 'error') return <ErrorState message={message} onRetry={onRetry} />;
  return <EmptyState title={message} />;
}
