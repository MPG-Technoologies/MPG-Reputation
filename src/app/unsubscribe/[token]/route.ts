import { NextRequest, NextResponse } from 'next/server'
import {
  isValidUnsubscribeTokenFormat,
  hashUnsubscribeToken,
  processCustomerUnsubscribe,
} from '@/domain/unsubscribe'
import { hashSuppressionContact } from '@/domain/suppression'
import { createAdminClient } from '@/lib/supabase/admin'
import { escapeHtml } from '@/domain/email/template-html'

function renderPageHtml({
  title,
  contentHtml,
}: {
  title: string
  contentHtml: string
}): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      background-color: #f8fafc;
      color: #0f172a;
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100vh;
      box-sizing: border-box;
    }
    .card {
      background-color: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.05);
      max-width: 480px;
      width: 100%;
      margin: 16px;
      padding: 32px;
      box-sizing: border-box;
    }
    h1 {
      margin: 0 0 12px 0;
      font-size: 20px;
      font-weight: 600;
      line-height: 1.3;
      color: #0f172a;
    }
    p {
      margin: 0 0 20px 0;
      font-size: 14px;
      line-height: 1.6;
      color: #475569;
    }
    .btn-stop {
      display: inline-block;
      width: 100%;
      background-color: #0f172a;
      color: #ffffff;
      padding: 12px 20px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      border: none;
      cursor: pointer;
      text-align: center;
      box-sizing: border-box;
    }
    .btn-stop:hover {
      background-color: #1e293b;
    }
    .badge {
      display: inline-block;
      font-size: 12px;
      font-weight: 500;
      color: #047857;
      background-color: #ecfdf5;
      border: 1px solid #a7f3d0;
      padding: 4px 10px;
      border-radius: 4px;
      margin-bottom: 16px;
    }
    .footer {
      margin-top: 24px;
      padding-top: 16px;
      border-top: 1px solid #f1f5f9;
      font-size: 12px;
      color: #94a3b8;
    }
  </style>
</head>
<body>
  <main class="card">
    ${contentHtml}
    <div class="footer">
      MPG Reputation messaging preferences. This action applies only to review requests sent through MPG Reputation.
    </div>
  </main>
</body>
</html>`.trim()
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params

  if (!isValidUnsubscribeTokenFormat(token)) {
    const html = renderPageHtml({
      title: 'Invalid or Expired Link',
      contentHtml: `
        <h1>Invalid or expired link</h1>
        <p>This unsubscribe link is invalid or has expired.</p>
      `,
    })
    return new NextResponse(html, {
      status: 404,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  }

  const tokenHash = hashUnsubscribeToken(token)
  const supabase = createAdminClient()

  // 1. Resolve review_request by unsubscribe_token_hash
  const { data: reqRecord } = await supabase
    .from('review_requests')
    .select('id, organization_id, customer_id')
    .eq('unsubscribe_token_hash', tokenHash)
    .maybeSingle()

  if (!reqRecord) {
    const html = renderPageHtml({
      title: 'Invalid or Expired Link',
      contentHtml: `
        <h1>Invalid or expired link</h1>
        <p>This unsubscribe link is invalid or has expired.</p>
      `,
    })
    return new NextResponse(html, {
      status: 404,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  }

  // 2. Fetch business name
  const { data: org } = await supabase
    .from('organizations')
    .select('name')
    .eq('id', reqRecord.organization_id)
    .single()

  const businessName = escapeHtml(org?.name || 'this business')

  // 3. Fetch customer email to check existing suppression state
  const { data: cust } = await supabase
    .from('customers')
    .select('email')
    .eq('id', reqRecord.customer_id)
    .single()

  const contactHash = cust?.email ? hashSuppressionContact('email', cust.email) : ''
  const { data: existingSupp } = await supabase
    .from('suppressions')
    .select('id')
    .eq('organization_id', reqRecord.organization_id)
    .eq('channel', 'email')
    .eq('contact_hash', contactHash)
    .maybeSingle()

  const isAlreadyUnsubscribed = !!existingSupp || request.nextUrl.searchParams.get('status') === 'unsubscribed'

  if (isAlreadyUnsubscribed) {
    const html = renderPageHtml({
      title: `Unsubscribed — ${businessName}`,
      contentHtml: `
        <div class="badge">Unsubscribed</div>
        <h1>Review requests stopped</h1>
        <p>You won't receive future review-request emails from <strong>${businessName}</strong> through MPG Reputation.</p>
      `,
    })
    return new NextResponse(html, {
      status: 200,
      headers: { 'content-type': 'text/html; charset=utf-8' },
    })
  }

  const html = renderPageHtml({
    title: `Stop review-request emails — ${businessName}`,
    contentHtml: `
      <h1>Stop review-request emails?</h1>
      <p>Stop future review-request emails from <strong>${businessName}</strong> sent via MPG Reputation.</p>
      <form method="POST" action="/unsubscribe/${encodeURIComponent(token)}">
        <button type="submit" class="btn-stop">Stop review-request emails</button>
      </form>
    `,
  })

  return new NextResponse(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  const { token } = await context.params

  if (!isValidUnsubscribeTokenFormat(token)) {
    return new NextResponse('Invalid or expired unsubscribe link.', { status: 404 })
  }

  const supabase = createAdminClient()
  const result = await processCustomerUnsubscribe({ token, supabase })

  if (!result.success) {
    return new NextResponse(result.error || 'Invalid or expired unsubscribe link.', { status: 404 })
  }

  // Check if RFC 8058 One-Click POST or API client
  const accept = request.headers.get('accept') || ''

  let bodyText = ''
  try {
    bodyText = await request.text()
  } catch {
    // Body reading failure is non-fatal
  }

  const isOneClickRfc =
    bodyText.includes('List-Unsubscribe=One-Click') ||
    accept.includes('application/json')

  if (isOneClickRfc && !accept.includes('text/html')) {
    return NextResponse.json({ unsubscribed: true }, { status: 200 })
  }

  // Browser form submission -> render confirmation page
  const businessName = escapeHtml(result.businessName || 'this business')
  const html = renderPageHtml({
    title: `Unsubscribed — ${businessName}`,
    contentHtml: `
      <div class="badge">Unsubscribed</div>
      <h1>Review requests stopped</h1>
      <p>You won't receive future review-request emails from <strong>${businessName}</strong> through MPG Reputation.</p>
    `,
  })

  return new NextResponse(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  })
}
