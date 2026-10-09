import type { InngestFunction } from 'inngest'
import { processReviewRequestWorkflow } from './review-request'
import { recoverPendingOutboxWorkflow } from './outbox-recovery'
import { retentionMaintenanceWorkflow } from './retention-maintenance'
import { isRetentionMaintenanceEnabled } from '@/domain/privacy/retention-maintenance'

/**
 * Builds the list of Inngest functions to expose via the serve handler.
 *
 * DEFENSE-IN-DEPTH SCHEDULING GUARD:
 * Retention maintenance workflow contains a cron trigger ('0 3 * * *').
 * To strictly prevent production retention cron synchronization or execution
 * when retention maintenance is disabled, the function is omitted from registration
 * unless ENABLE_RETENTION_MAINTENANCE === 'true'.
 *
 * Existing review request and outbox recovery functions remain registered in all cases.
 */
export function getInngestFunctions(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env
): InngestFunction.Like[] {
  const functions: InngestFunction.Like[] = [
    processReviewRequestWorkflow,
    recoverPendingOutboxWorkflow,
  ]

  if (isRetentionMaintenanceEnabled(env)) {
    functions.push(retentionMaintenanceWorkflow)
  }

  return functions
}

export {
  processReviewRequestWorkflow,
  recoverPendingOutboxWorkflow,
  retentionMaintenanceWorkflow,
}
