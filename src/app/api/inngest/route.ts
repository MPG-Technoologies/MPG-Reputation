import { serve } from 'inngest/next'
import { inngest } from '@/inngest/client'
import { processReviewRequestWorkflow } from '@/inngest/functions/review-request'

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [processReviewRequestWorkflow],
})
