#!/usr/bin/env node
/**
 * MPG client browser acceptance — disposable local infrastructure only.
 *
 * Exercises UI controls; NOT an external-delivery, actual-Google, real-client
 * pilot or legal-compliance test. CI never supplies hosted account credentials.
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'

const LOCAL_APP = 'http://127.0.0.1:3000'
const LOCAL_SUPABASE = 'http://127.0.0.1:54331'
const artifactDir = process.env.MPG_BROWSER_ARTIFACT_DIR || 'test-artifacts/browser'
const packageRoot = process.env.MPG_PLAYWRIGHT_PACKAGE_ROOT

if (
  process.env.MPG_BROWSER_E2E !== 'disposable-only' ||
  process.env.NEXT_PUBLIC_APP_URL !== LOCAL_APP ||
  process.env.NEXT_PUBLIC_SUPABASE_URL !== LOCAL_SUPABASE ||
  process.env.EMAIL_PROVIDER !== 'console' ||
  process.env.ENABLE_LIVE_EMAIL !== 'false' ||
  process.env.ENABLE_RETENTION_MAINTENANCE !== 'false' ||
  !packageRoot
) {
  throw new Error('Browser acceptance refused: disposable Supabase, local app and disabled live providers are required')
}

const requireFromTempTools = createRequire(join(packageRoot, 'browser-entry.cjs'))
const { chromium } = requireFromTempTools('playwright')
const testedGoogleUrl = 'https://g.page/r/MPGSyntheticBrowserClinic/review'

async function clientJourney(browser, label, viewport) {
  const unique = randomUUID().slice(0, 12)
  const context = await browser.newContext({ viewport })
  // Browser traffic may only reach the two local services. No real Google
  // profile, email API, Stripe or external page can be contacted.
  await context.route('**/*', route => {
    const url = new URL(route.request().url())
    return ['localhost', '127.0.0.1'].includes(url.hostname)
      ? route.continue()
      : route.abort('blockedbyclient')
  })

  const page = await context.newPage()
  page.setDefaultTimeout(30_000)
  page.setDefaultNavigationTimeout(45_000)
  let stage = 'signup'

  try {
    await page.goto(`${LOCAL_APP}/login`)
    await page.getByLabel('Email address').fill(`browser-${label}-${unique}@example.test`)
    await page.getByLabel('Password').fill('Synthetic-Only-Password!123')
    await page.getByRole('button', { name: 'Create Development Account' }).click()
    await page.waitForURL(url => url.pathname === '/onboarding', { timeout: 45_000 })
    await page.getByText('Setup · Step 1 of 2').waitFor()

    stage = 'business-onboarding'
    await page.getByLabel('Organization / Business Name').fill(`Synthetic Browser Clinic ${label} ${unique}`)
    await page.getByLabel('Primary Location Name').fill('Main Location')
    await page.getByLabel('Business Mailing Address').fill('100 Example Avenue, Suite 1')
    await page.getByRole('button', { name: 'Continue to Review Setup' }).click()
    await page.waitForURL(url => url.pathname === '/app/settings/review-destination', { timeout: 45_000 })
    await page.getByText('Setup · Step 2 of 2').waitFor()

    stage = 'reject-non-google-link'
    await page.getByLabel('Google Review URL').fill('https://example.com/review')
    await page.getByRole('button', { name: 'Save Destination' }).click()
    await page.getByRole('status').getByText(/Invalid host: example\\.com/).waitFor()
    await page.getByText('No Google review destination has been saved for this location.').waitFor()

    stage = 'reject-unsaved-google-link'
    // Inspect attempted popup URLs without visiting any external service.
    await page.evaluate(() => {
      window.__mpgOpenedGoogleLink = null
      window.open = (url) => {
        window.__mpgOpenedGoogleLink = String(url)
        return null
      }
    })
    await page.getByLabel('Google Review URL').fill(testedGoogleUrl)
    await page.getByRole('button', { name: /Test Link/ }).click()
    await page.getByRole('status').getByText(/Save the entered Google review link before testing it/).waitFor()
    assert.equal(
      await page.evaluate(() => window.__mpgOpenedGoogleLink),
      null,
      'An unsaved Google review link must never be opened as the tested destination'
    )

    stage = 'save-google-link'
    await page.getByRole('button', { name: 'Save Destination' }).click()
    await page.getByText('Configured Destination:').waitFor()
    await page.getByText(testedGoogleUrl, { exact: true }).first().waitFor()

    stage = 'reject-different-location-draft'
    await page.getByLabel('Google Review URL').fill('https://g.page/r/OtherSyntheticLocation/review')
    await page.getByRole('button', { name: /Test Link/ }).click()
    await page.getByRole('status').getByText(/Save the entered Google review link before testing it/).waitFor()
    assert.equal(
      await page.evaluate(() => window.__mpgOpenedGoogleLink),
      null,
      'Editing the destination must not test a different business location'
    )
    assert.equal(
      await page.getByRole('checkbox', { name: /I tested this saved link and confirmed/ }).isDisabled(),
      true,
      'The confirmation assertion must remain disabled for an unsaved draft'
    )
    await page.getByLabel('Google Review URL').fill('')

    stage = 'test-google-link-locally'
    // Test the actual browser button, but intercept the external popup.
    // This verifies URL selection without asserting Google account ownership.
    await page.getByRole('button', { name: /Test Link/ }).click()
    const attemptedLink = await page.evaluate(() => window.__mpgOpenedGoogleLink)
    assert.equal(attemptedLink, testedGoogleUrl, 'Test Link must open the saved URL')
    await page.getByRole('checkbox', {
      name: /I tested this saved link and confirmed/,
    }).check()
    await page.getByRole('button', { name: 'Confirm Tested Destination' }).click()
    await page.getByText('Google review link confirmed').first().waitFor()

    stage = 'start-trial'
    await page.getByRole('link', { name: /View Usage.*Trial/ }).click()
    await page.waitForURL(url => url.pathname === '/app/settings/usage')
    await page.getByText('Trial Ready for Activation').first().waitFor()
    await page.getByRole('button', { name: 'Start Trial', exact: true }).click()
    await page.getByText('Active Trial').first().waitFor({ timeout: 45_000 })

    stage = 'record-completion'
    await page.goto(`${LOCAL_APP}/app/quick-complete`)
    await page.getByLabel(/First Name/).fill('Synthetic')
    await page.getByLabel(/Last Name/).fill('Recipient')
    await page.getByLabel(/Email Address/).fill(`recipient-${label}-${unique}@example.test`)
    assert.equal(
      await page.locator('input[name="permissionEmail"]:checked').inputValue(),
      'unknown',
      'Permission must default to unknown'
    )
    await page.getByRole('button', { name: 'Record Completion' }).click()
    await page.getByText('Completion recorded', { exact: true }).waitFor({ timeout: 60_000 })
    await page.getByText('Not confirmed by this receipt').waitFor()

    stage = 'dashboard'
    await page.getByRole('link', { name: 'View Recent Activity' }).click()
    await page.waitForURL(url => url.pathname === '/app/dashboard')
    await page.getByText('Recent Activity').first().waitFor({ timeout: 45_000 })
    console.log(`PASS ${label}: signup → onboarding → saved/tested/confirmed link → trial → completion receipt → dashboard`)
  } catch (err) {
    await mkdir(artifactDir, { recursive: true })
    await page.screenshot({ path: join(artifactDir, `${label}-${stage}.png`), fullPage: true }).catch(() => {})
    throw new Error(`${label} browser acceptance failed at ${stage}: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    await context.close()
  }
}

const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
try {
  await clientJourney(browser, 'desktop', { width: 1365, height: 850 })
  await clientJourney(browser, 'mobile', { width: 390, height: 844 })
} finally {
  await browser.close()
}
