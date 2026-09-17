import { inngest } from "../client"
import { createAdminClient } from "@/lib/supabase/admin"
import { dispatchPendingOutboxEvents, OutboxDispatchResult } from "@/domain/outbox/dispatcher"

export async function executeOutboxRecoveryHandler({
  step,
  inngestClient,
  organizationId,
}: {
  step: {
    run: <T>(name: string, fn: () => Promise<T>) => Promise<T>
  }
  inngestClient?: typeof inngest
  organizationId?: string
}): Promise<OutboxDispatchResult> {
  const client = inngestClient || inngest
  const result = await step.run("dispatch-pending-outbox-batch", async () => {
    const supabase = createAdminClient()
    return await dispatchPendingOutboxEvents(supabase, client, { batchSize: 50, organizationId })
  })

  return result as unknown as OutboxDispatchResult
}

/**
 * Scheduled Inngest function for automatic outbox recovery.
 * Prompt Trust-Boundary Correction 3:
 * Periodically scans for PENDING outbox records, dispatches them with stable event IDs
 * and deduplication, and transitions them to DISPATCHED using a service-role client.
 * Concurrency limit 1 prevents multiple dispatchers from running concurrently.
 */
export const recoverPendingOutboxWorkflow = inngest.createFunction(
  {
    id: "recover-pending-outbox",
    name: "Recover Pending Domain Outbox Events",
    concurrency: 1,
    triggers: [{ cron: "*/5 * * * *" }],
  },
  async ({ step }) => {
    return await executeOutboxRecoveryHandler({
      step: {
        run: async <T>(name: string, fn: () => Promise<T>) => {
          const res = await step.run(name, fn)
          return res as unknown as T
        },
      },
    })
  }
)
