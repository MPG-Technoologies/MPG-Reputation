import { inngest } from "../client"
import { createAdminClient } from "@/lib/supabase/admin"
import {
  executeMultiTenantRetentionMaintenance,
  DEFAULT_MAINTENANCE_CRON_CADENCE,
  MultiTenantRetentionMaintenanceResult,
  MultiTenantRetentionMaintenanceOptions,
} from "@/domain/privacy/retention-maintenance"

export async function executeRetentionMaintenanceHandler({
  step,
  adminClient,
  options,
}: {
  step: {
    run: <T>(name: string, fn: () => Promise<T>) => Promise<T>
  }
  adminClient?: ReturnType<typeof createAdminClient>
  options?: MultiTenantRetentionMaintenanceOptions
}): Promise<MultiTenantRetentionMaintenanceResult> {
  const result = await step.run("execute-multi-tenant-retention-maintenance", async () => {
    const supabase = adminClient || createAdminClient()
    return await executeMultiTenantRetentionMaintenance(supabase, options)
  })

  return result as unknown as MultiTenantRetentionMaintenanceResult
}

/**
 * Scheduled Inngest function for daily multi-tenant retention maintenance.
 *
 * MR-7C.4B2 Orchestration Rules:
 * - Production scheduling is DISABLED BY DEFAULT via ENABLE_RETENTION_MAINTENANCE=false.
 * - Concurrency limit 1 prevents multiple retention maintenance jobs from running concurrently.
 * - Low-frequency daily cadence: '0 3 * * *' (03:00 UTC daily).
 * - Cadence is an implementation default; frozen 30-day and 90-day retention policies remain authoritative.
 */
export const retentionMaintenanceWorkflow = inngest.createFunction(
  {
    id: "retention-maintenance",
    name: "Multi-Tenant Retention Maintenance Workflow",
    concurrency: 1,
    triggers: [{ cron: DEFAULT_MAINTENANCE_CRON_CADENCE }],
  },
  async ({ step }) => {
    return await executeRetentionMaintenanceHandler({
      step: {
        run: async <T>(name: string, fn: () => Promise<T>) => {
          const res = await step.run(name, fn)
          return res as unknown as T
        },
      },
    })
  }
)
