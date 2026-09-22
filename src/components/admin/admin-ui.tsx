import type { ReactNode } from 'react'
import styles from './admin-ui.module.css'

export { default as adminStyles } from './admin-ui.module.css'
export type AdminTone = 'neutral' | 'success' | 'warning' | 'danger'

export function AdminWorkspace({ children }: { children: ReactNode }) {
  return (
    <div className={styles.workspace}>
      <a className={styles.skipLink} href="#operations-content">Skip to content</a>
      <header className={styles.workspaceBar}>
        <div className={styles.workspaceIdentity}>
          <span className={styles.wordmark}>MPG <span>Reputation</span></span>
          <span className={styles.workspaceLabel}>Internal Operations</span>
        </div>
      </header>
      <main id="operations-content" tabIndex={-1} className={styles.content}>{children}</main>
    </div>
  )
}

export function OrganizationHeader({ organizationId, active, title, description, snapshotAt }: {
  organizationId: string
  active: 'inspection' | 'health' | 'exceptions'
  title: string
  description?: ReactNode
  snapshotAt: string
}) {
  const base = `/admin/organizations/${organizationId}`
  const views = [
    { key: 'inspection', label: 'Inspection', href: base },
    { key: 'health', label: 'Health', href: `${base}/health` },
    { key: 'exceptions', label: 'Exceptions', href: `${base}/exceptions` },
  ]
  return (
    <>
      <div className={styles.context}>
        <span className={styles.eyebrow}>Organization</span>
        <span className={styles.id}>{organizationId}</span>
      </div>
      <nav className={styles.navigation} aria-label="Organization support views">
        {views.map((view) => (
          // Plain anchors preserve explicit navigation without speculative reads/audits.
          <a key={view.key} href={view.href} aria-current={active === view.key ? 'page' : undefined}>
            {view.label}
          </a>
        ))}
      </nav>
      <div className={styles.pageHeader}>
        <div>
          <h1>{title}</h1>
          {description && <p className={styles.description}>{description}</p>}
        </div>
        <div className={styles.snapshot}>
          <span className={styles.eyebrow}>Snapshot (UTC)</span>
          <time dateTime={snapshotAt}>{snapshotAt}</time>
        </div>
      </div>
    </>
  )
}

export function AdminSection({ title, description, children }: {
  title: string; description?: ReactNode; children: ReactNode
}) {
  return (
    <section className={styles.section}>
      <div className={styles.sectionHeading}>
        <h2>{title}</h2>
        {description && <p className={styles.description}>{description}</p>}
      </div>
      {children}
    </section>
  )
}

export function AdminFacts({ items, metrics = false }: {
  items: { label: string; value: ReactNode }[]; metrics?: boolean
}) {
  return (
    <dl className={`${styles.facts} ${metrics ? styles.metrics : ''}`}>
      {items.map(({ label, value }) => (
        <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
      ))}
    </dl>
  )
}

export function AdminStatus({ children, tone = 'neutral' }: { children: ReactNode; tone?: AdminTone }) {
  return <span className={`${styles.status} ${styles[tone]}`}>{children}</span>
}

export function AdminNotice({ children, tone = 'neutral', title, role = 'status' }: {
  children: ReactNode; tone?: AdminTone; title?: string; role?: 'status' | 'alert'
}) {
  return (
    <div className={`${styles.notice} ${styles[tone]}`} role={role}>
      {title && <p className={styles.noticeTitle}>{title}</p>}
      {children}
    </div>
  )
}

export function AdminEmpty({ children }: { children: ReactNode }) {
  return <div className={styles.empty}>{children}</div>
}

export function AdminFailure({ unavailable = false, children }: {
  unavailable?: boolean; children: ReactNode
}) {
  return (
    <div className={styles.failure}>
      <p className={styles.eyebrow}>Internal Operations</p>
      <h1>{unavailable ? 'Snapshot unavailable' : 'Access unavailable'}</h1>
      <AdminNotice tone={unavailable ? 'warning' : 'neutral'} role="alert">{children}</AdminNotice>
    </div>
  )
}

export function AdminTable({ caption, headings, children, wide = false }: {
  caption: string; headings: string[]; children: ReactNode; wide?: boolean
}) {
  return (
    <div className={styles.tableContainer}>
      <div className={styles.tableScroll} role="region" aria-label={caption} tabIndex={0}>
        <table className={`${styles.table} ${wide ? styles.wideTable : ''}`}>
          <caption className="sr-only">{caption}</caption>
          <thead><tr>{headings.map((heading) => <th key={heading} scope="col">{heading}</th>)}</tr></thead>
          <tbody>{children}</tbody>
        </table>
      </div>
      <p className={styles.scrollHint}>Scroll horizontally to view all columns.</p>
    </div>
  )
}
