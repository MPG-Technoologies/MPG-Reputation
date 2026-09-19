/**
 * Internal Economics and Cost Attribution (MR-4)
 *
 * Tracks internal costs in integer micro-USD (1 USD = 1,000,000 micro-USD)
 * to eliminate floating-point drift and ensure financial determinism.
 */

export const MICRO_USD_PER_USD = 1_000_000

/**
 * Standard baseline cost estimates for MR-4 economics accounting.
 */
export const ESTIMATED_COSTS = {
  EMAIL_DISPATCH_MICRO_USD: 1_000, // $0.001 per send attempt
  WORKFLOW_EXECUTION_MICRO_USD: 100, // $0.0001 per initial workflow execution
} as const

export type CostCategory =
  | 'email_provider'
  | 'workflow_execution'
  | 'database_storage'
  | 'hosting_allocation'
  | 'support_allocation'
  | 'other'

export type CostProvenance = 'MEASURED' | 'CONFIGURED_ESTIMATE' | 'UNKNOWN'

export interface CostRecordItem {
  cost_category: string
  cost_status: string
  amount_micro_usd: number
  recorded_at?: string
  description?: string | null
}

export interface CategoryBreakdown {
  category: CostCategory
  totalMicroUsd: number
  totalUsd: number
  count: number
  measuredCount: number
  estimatedCount: number
}

export interface EconomicsSummary {
  totalCostMicroUsd: number
  totalCostUsd: number
  totalCostUsdFormatted: string
  byCategory: Record<CostCategory, CategoryBreakdown>
  totalEmailAttemptsCostMicroUsd: number
  totalWorkflowCostMicroUsd: number
  averageCostPerInitialRequestMicroUsd: number
  averageCostPerInitialRequestUsdFormatted: string
}

export function microUsdToUsd(microUsd: number): number {
  return microUsd / MICRO_USD_PER_USD
}

export function usdToMicroUsd(usd: number): number {
  return Math.round(usd * MICRO_USD_PER_USD)
}

export function formatMicroUsd(microUsd: number, decimals: number = 4): string {
  if (decimals >= 6) {
    const usd = microUsd / MICRO_USD_PER_USD
    return `$${usd.toFixed(decimals)}`
  }
  const factor = Math.pow(10, 6 - decimals)
  const roundedMicro = Math.round(microUsd / factor) * factor
  const usd = roundedMicro / MICRO_USD_PER_USD
  return `$${usd.toFixed(decimals)}`
}

const ALL_CATEGORIES: CostCategory[] = [
  'email_provider',
  'workflow_execution',
  'database_storage',
  'hosting_allocation',
  'support_allocation',
  'other',
]

/**
 * Aggregates cost ledger records into structured economics metrics.
 */
export function aggregateEconomics(
  records: CostRecordItem[],
  totalInitialRequests: number = 0
): EconomicsSummary {
  const byCategory = ALL_CATEGORIES.reduce((acc, cat) => {
    acc[cat] = {
      category: cat,
      totalMicroUsd: 0,
      totalUsd: 0,
      count: 0,
      measuredCount: 0,
      estimatedCount: 0,
    }
    return acc
  }, {} as Record<CostCategory, CategoryBreakdown>)

  let totalCostMicroUsd = 0
  let totalEmailAttemptsCostMicroUsd = 0
  let totalWorkflowCostMicroUsd = 0

  for (const record of records) {
    const cat = (ALL_CATEGORIES.includes(record.cost_category as CostCategory)
      ? record.cost_category
      : 'other') as CostCategory

    const micro = Number(record.amount_micro_usd) || 0
    totalCostMicroUsd += micro

    byCategory[cat].totalMicroUsd += micro
    byCategory[cat].count += 1

    if (record.cost_status === 'MEASURED') {
      byCategory[cat].measuredCount += 1
    } else if (record.cost_status === 'CONFIGURED_ESTIMATE') {
      byCategory[cat].estimatedCount += 1
    }

    if (cat === 'email_provider') {
      totalEmailAttemptsCostMicroUsd += micro
    } else if (cat === 'workflow_execution') {
      totalWorkflowCostMicroUsd += micro
    }
  }

  // Calculate USD totals
  for (const cat of ALL_CATEGORIES) {
    byCategory[cat].totalUsd = microUsdToUsd(byCategory[cat].totalMicroUsd)
  }

  const totalCostUsd = microUsdToUsd(totalCostMicroUsd)
  const averageCostPerInitialRequestMicroUsd =
    totalInitialRequests > 0
      ? Math.round(totalCostMicroUsd / totalInitialRequests)
      : 0

  return {
    totalCostMicroUsd,
    totalCostUsd,
    totalCostUsdFormatted: formatMicroUsd(totalCostMicroUsd, 4),
    byCategory,
    totalEmailAttemptsCostMicroUsd,
    totalWorkflowCostMicroUsd,
    averageCostPerInitialRequestMicroUsd,
    averageCostPerInitialRequestUsdFormatted: formatMicroUsd(
      averageCostPerInitialRequestMicroUsd,
      4
    ),
  }
}
