'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { retrySupportOutboxEvent } from '@/lib/support/recovery'

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function retryOutboxExceptionAction(
  organizationId: string,
  outboxId: string,
  formData: FormData
): Promise<void> {
  if (
    !UUID.test(organizationId) ||
    !UUID.test(outboxId)
  ) {
    return
  }

  const target =
    organizationId.toLowerCase()

  const path =
    `/admin/organizations/${target}/exceptions`

  const confirmation =
    formData.get('confirmation')

  if (confirmation !== 'retry') {
    redirect(
      `${path}?recovery=CONFIRMATION_REQUIRED`
    )
  }

  const result =
    await retrySupportOutboxEvent(
      target,
      outboxId
    )

  revalidatePath(path)

  const search =
    new URLSearchParams({
      recovery: result.status,
    })

  if ('actionId' in result) {
    search.set(
      'action',
      result.actionId
    )
  }

  redirect(
    `${path}?${search.toString()}`
  )
}
