import { escapeHtml } from './template-html'
import type { HtmlTemplateOptions } from './template-html'

/**
 * Renders a responsive, accessible, neutral review request REMINDER HTML email.
 * Adheres strictly to review solicitation neutrality: no star ratings, no sentiment gating,
 * no guilt language ("you haven't left a review"), no urgency pressure.
 * Zero external tracking pixels or remote images.
 */
export function renderReviewReminderHtml(options: HtmlTemplateOptions): string {
  const { businessName, customerFirstName, reviewUrl, unsubscribeUrl } = options

  const safeBusinessName = escapeHtml(businessName.trim() || 'our business')
  const safeReviewUrl = escapeHtml(reviewUrl.trim())
  const safeUnsubscribeUrl = escapeHtml(unsubscribeUrl.trim())

  const greeting = customerFirstName && customerFirstName.trim()
    ? `Hi ${escapeHtml(customerFirstName.trim())},`
    : 'Hello,'

  const previewText = `Reminder from ${safeBusinessName} regarding your recent service.`

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>Reminder: Share your experience with ${safeBusinessName}</title>
  <style>
    /* Client-specific resets */
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
    body { height: 100% !important; margin: 0 !important; padding: 0 !important; width: 100% !important; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; }

    /* Responsive styling */
    @media only screen and (max-width: 620px) {
      .email-container { width: 100% !important; max-width: 100% !important; }
      .content-padding { padding: 24px 20px !important; }
      .cta-button { display: block !important; width: 100% !important; text-align: center !important; }
    }

    /* Dark mode enhancements for supporting clients */
    @media (prefers-color-scheme: dark) {
      body, .email-bg { background-color: #0f172a !important; }
      .card-bg { background-color: #1e293b !important; border-color: #334155 !important; }
      .text-primary { color: #f8fafc !important; }
      .text-secondary { color: #94a3b8 !important; }
      .divider { border-color: #334155 !important; }
      .cta-button { background-color: #38bdf8 !important; color: #0f172a !important; }
      .footer-text { color: #64748b !important; }
      .footer-link { color: #94a3b8 !important; }
    }
  </style>
</head>
<body class="email-bg" style="margin: 0; padding: 0; background-color: #f8fafc; color: #334155;">
  <!-- Preheader text (hidden preview) -->
  <div style="display: none; font-size: 1px; line-height: 1px; max-height: 0px; max-width: 0px; opacity: 0; overflow: hidden; mso-hide: all;">
    ${previewText}
  </div>

  <table border="0" cellpadding="0" cellspacing="0" width="100%" class="email-bg" style="background-color: #f8fafc;" role="presentation">
    <tr>
      <td align="center" style="padding: 40px 16px;">
        <table border="0" cellpadding="0" cellspacing="0" width="100%" class="email-container card-bg" style="max-width: 580px; background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px 0 rgba(0, 0, 0, 0.05);" role="presentation">
          <tr>
            <td class="content-padding" style="padding: 36px 32px;">
              <!-- Greeting -->
              <h1 class="text-primary" style="margin: 0 0 16px 0; font-size: 20px; font-weight: 600; line-height: 1.4; color: #0f172a;">
                ${greeting}
              </h1>

              <!-- Message Body -->
              <p class="text-secondary" style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.6; color: #334155;">
                This is a reminder that ${safeBusinessName} invited you to share your experience following your recent service.
              </p>
              <p class="text-secondary" style="margin: 0 0 20px 0; font-size: 15px; line-height: 1.6; color: #334155;">
                If you&#39;d like to leave a review, use the link below.
              </p>

              <!-- Primary CTA Button (Min 44px height for touch target accessibility) -->
              <table border="0" cellpadding="0" cellspacing="0" style="margin: 28px 0 12px 0;" role="presentation">
                <tr>
                  <td align="center" style="border-radius: 6px; background-color: #0f172a;">
                    <a href="${safeReviewUrl}" target="_blank" rel="noopener noreferrer" class="cta-button" style="display: inline-block; padding: 14px 28px; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none; border-radius: 6px; line-height: 1.2; text-align: center; mso-padding-alt: 0;">
                      <!--[if mso]><i style="letter-spacing: 28px; mso-font-width: -100%; mso-text-raise: 30pt">&nbsp;</i><![endif]-->
                      <span style="mso-text-raise: 15pt;">Leave a review</span>
                      <!--[if mso]><i style="letter-spacing: 28px; mso-font-width: -100%">&nbsp;</i><![endif]-->
                    </a>
                  </td>
                </tr>
              </table>

              <!-- Destination Disclosure -->
              <p class="text-secondary" style="margin: 0 0 28px 0; font-size: 13px; line-height: 1.5; color: #64748b;">
                The button takes you to ${safeBusinessName}&#39;s review page.
              </p>

              <!-- Subtle Divider -->
              <hr class="divider" style="border: 0; border-top: 1px solid #e2e8f0; margin: 28px 0 20px 0;">

              <!-- Footer & Unsubscribe -->
              <p class="footer-text" style="margin: 0 0 8px 0; font-size: 12px; line-height: 1.5; color: #64748b;">
                This review request was sent on behalf of ${safeBusinessName} using MPG Reputation.
              </p>
              <p class="footer-text" style="margin: 0; font-size: 12px; line-height: 1.5; color: #64748b;">
                You can <a href="${safeUnsubscribeUrl}" class="footer-link" style="color: #475569; text-decoration: underline;">opt out of future review-request emails</a> from ${safeBusinessName}.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim()
}
