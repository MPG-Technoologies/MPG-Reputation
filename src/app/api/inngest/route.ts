import { serve } from "inngest/next"
import { inngest } from "@/inngest/client"
import { processReviewRequestWorkflow } from "@/inngest/functions/review-request"
import { recoverPendingOutboxWorkflow } from "@/inngest/functions/outbox-recovery"

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    processReviewRequestWorkflow,
    recoverPendingOutboxWorkflow,
  ],
})
