import { describe, it, expect } from 'vitest'
import {
  MICRO_USD_PER_USD,
  ESTIMATED_COSTS,
  microUsdToUsd,
  usdToMicroUsd,
  formatMicroUsd,
  aggregateEconomics,
  CostRecordItem,
} from '../../src/domain/entitlement'

describe('MR-4 Economics & Internal Cost Domain', () => {
  it('verifies integer conversion math', () => {
    expect(MICRO_USD_PER_USD).toBe(1_000_000)
    expect(microUsdToUsd(1_000_000)).toBe(1)
    expect(microUsdToUsd(1_000)).toBe(0.001)
    expect(usdToMicroUsd(0.001)).toBe(1_000)
    expect(usdToMicroUsd(1.234567)).toBe(1_234567)
  })

  it('formats micro-USD to currency strings with configurable precision', () => {
    expect(formatMicroUsd(1_000, 4)).toBe('$0.0010')
    expect(formatMicroUsd(100, 4)).toBe('$0.0001')
    expect(formatMicroUsd(1_500_000, 2)).toBe('$1.50')
    expect(formatMicroUsd(0, 2)).toBe('$0.00')
  })

  it('verifies standard cost constants', () => {
    expect(ESTIMATED_COSTS.EMAIL_DISPATCH_MICRO_USD).toBe(1_000)
    expect(ESTIMATED_COSTS.WORKFLOW_EXECUTION_MICRO_USD).toBe(100)
  })

  describe('aggregateEconomics', () => {
    it('aggregates an empty record set safely', () => {
      const summary = aggregateEconomics([], 0)
      expect(summary.totalCostMicroUsd).toBe(0)
      expect(summary.totalCostUsd).toBe(0)
      expect(summary.totalCostUsdFormatted).toBe('$0.0000')
      expect(summary.averageCostPerInitialRequestMicroUsd).toBe(0)
      expect(summary.averageCostPerInitialRequestUsdFormatted).toBe('$0.0000')
      expect(summary.byCategory.email_provider.count).toBe(0)
      expect(summary.byCategory.workflow_execution.count).toBe(0)
    })

    it('aggregates mixed cost categories and tracks provenance accurately', () => {
      const records: CostRecordItem[] = [
        {
          cost_category: 'workflow_execution',
          cost_status: 'CONFIGURED_ESTIMATE',
          amount_micro_usd: 100,
        },
        {
          cost_category: 'workflow_execution',
          cost_status: 'CONFIGURED_ESTIMATE',
          amount_micro_usd: 100,
        },
        {
          cost_category: 'email_provider',
          cost_status: 'CONFIGURED_ESTIMATE',
          amount_micro_usd: 1000,
        },
        {
          cost_category: 'email_provider',
          cost_status: 'MEASURED',
          amount_micro_usd: 1200,
        },
        {
          cost_category: 'database_storage',
          cost_status: 'CONFIGURED_ESTIMATE',
          amount_micro_usd: 500,
        },
      ]

      const summary = aggregateEconomics(records, 2)

      // Total = 100 + 100 + 1000 + 1200 + 500 = 2900 micro-USD ($0.0029)
      expect(summary.totalCostMicroUsd).toBe(2900)
      expect(summary.totalCostUsd).toBe(0.0029)
      expect(summary.totalCostUsdFormatted).toBe('$0.0029')

      // Workflow category
      expect(summary.byCategory.workflow_execution.totalMicroUsd).toBe(200)
      expect(summary.byCategory.workflow_execution.count).toBe(2)
      expect(summary.byCategory.workflow_execution.estimatedCount).toBe(2)
      expect(summary.byCategory.workflow_execution.measuredCount).toBe(0)

      // Email provider category
      expect(summary.byCategory.email_provider.totalMicroUsd).toBe(2200)
      expect(summary.byCategory.email_provider.count).toBe(2)
      expect(summary.byCategory.email_provider.estimatedCount).toBe(1)
      expect(summary.byCategory.email_provider.measuredCount).toBe(1)

      // Averages: 2900 / 2 = 1450 micro-USD ($0.0015)
      expect(summary.averageCostPerInitialRequestMicroUsd).toBe(1450)
      expect(summary.averageCostPerInitialRequestUsdFormatted).toBe('$0.0015')
    })
  })
})
