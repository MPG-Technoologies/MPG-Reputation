import { handleCompletionApiRequest } from '@/domain/completion/api-handler'
import { PostgresCompletionApiStore } from '@/domain/completion/store'

export async function POST(req: Request): Promise<Response> {
  const store = new PostgresCompletionApiStore()
  return handleCompletionApiRequest(req, store)
}

export async function GET(): Promise<Response> {
  return Response.json(
    {
      error: 'METHOD_NOT_ALLOWED',
      message: 'Completions must be submitted via POST with valid HMAC authentication.',
    },
    {
      status: 405,
      headers: {
        Allow: 'POST',
      },
    }
  )
}
