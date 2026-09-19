import React from 'react'

export interface PageShellProps {
  children: React.ReactNode
  className?: string
}

export function PageShell({ children, className = '' }: PageShellProps) {
  return (
    <div className={`w-full flex-1 flex flex-col min-w-0 min-h-0 px-4 sm:px-6 xl:px-8 py-5 xl:py-6 ${className}`}>
      {children}
    </div>
  )
}

export interface PageHeaderProps {
  title: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  badge?: React.ReactNode
  className?: string
}

export function PageHeader({
  title,
  subtitle,
  actions,
  badge,
  className = '',
}: PageHeaderProps) {
  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 mb-5 border-b border-[#17233F]/70 ${className}`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2.5">
          <h1 className="text-xl xl:text-2xl font-bold text-white tracking-tight truncate">
            {title}
          </h1>
          {badge && <div className="shrink-0">{badge}</div>}
        </div>
        {subtitle && (
          <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-2xl leading-relaxed">
            {subtitle}
          </p>
        )}
      </div>

      {actions && (
        <div className="flex items-center gap-3 shrink-0 self-start sm:self-center">
          {actions}
        </div>
      )}
    </div>
  )
}
