import React from 'react'

export interface PanelProps {
  children: React.ReactNode
  className?: string
  id?: string
}

export function Panel({ children, className = '', id }: PanelProps) {
  return (
    <div
      id={id}
      className={`bg-[#0E172B] border border-[#1C2846] rounded-xl overflow-hidden ${className}`}
    >
      {children}
    </div>
  )
}

export interface PanelHeaderProps {
  title: React.ReactNode
  subtitle?: React.ReactNode
  actions?: React.ReactNode
  badge?: React.ReactNode
  className?: string
}

export function PanelHeader({
  title,
  subtitle,
  actions,
  badge,
  className = '',
}: PanelHeaderProps) {
  return (
    <div
      className={`px-5 py-4 border-b border-[#1C2846]/80 flex items-center justify-between gap-3 ${className}`}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h2 className="text-sm sm:text-base font-semibold text-white tracking-tight truncate">
            {title}
          </h2>
          {badge}
        </div>
        {subtitle && (
          <p className="text-xs text-slate-400 mt-0.5 leading-relaxed truncate">
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="shrink-0 flex items-center gap-2">{actions}</div>}
    </div>
  )
}

export interface TablePanelProps {
  children: React.ReactNode
  header?: React.ReactNode
  footer?: React.ReactNode
  className?: string
}

export function TablePanel({
  children,
  header,
  footer,
  className = '',
}: TablePanelProps) {
  return (
    <div
      className={`bg-[#0E172B] border border-[#1C2846] rounded-xl overflow-hidden flex flex-col flex-1 min-h-0 ${className}`}
    >
      {header}
      <div className="flex-1 overflow-x-auto overflow-y-auto min-h-0">
        {children}
      </div>
      {footer && (
        <div className="px-5 py-3 border-t border-[#1C2846]/80 bg-[#0A1020]/40 flex items-center justify-between text-xs text-slate-400 shrink-0">
          {footer}
        </div>
      )}
    </div>
  )
}

export interface EmptyStateProps {
  icon?: React.ComponentType<{ className?: string }>
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className = '',
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center p-8 sm:p-12 text-center text-slate-400 ${className}`}
    >
      {Icon && (
        <div className="w-12 h-12 rounded-full bg-[#131E38] border border-[#1C2846] flex items-center justify-center text-slate-400 mb-3.5">
          <Icon className="w-6 h-6" />
        </div>
      )}
      <h3 className="text-sm sm:text-base font-semibold text-white tracking-tight">
        {title}
      </h3>
      {description && (
        <p className="text-xs sm:text-sm text-slate-400 mt-1 max-w-sm leading-relaxed">
          {description}
        </p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
