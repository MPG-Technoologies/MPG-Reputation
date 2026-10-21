// Disposable local-only Chromium acceptance. No hosted database, provider or paid activation.
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const app = process.env.NEXT_PUBLIC_APP_URL ?? ''
const localDatabase = new Set(['http://127.0.0.1:54331', 'http://localhost:54331'])
const localApp = new Set(['http://127.0.0.1:3000', 'http://localhost:3000'])
assert(localDatabase.has(supabaseUrl), 'DISPOSABLE_DATABASE_REQUIRED')
assert(localApp.has(app), 'LOCAL_APPLICATION_REQUIRED')
assert.equal(process.env.ENABLE_LIVE_BILLING, 'false')
assert.equal(process.env.VERCEL_ENV, undefined)
assert.equal(process.env.NODE_ENV, undefined)
assert(process.env.SUPABASE_SERVICE_ROLE_KEY, 'MISSING_SYNTHETIC_SERVICE_KEY')
assert(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, 'MISSING_SYNTHETIC_ANON_KEY')
assert(process.env.RUNNER_TEMP, 'MISSING_EPHEMERAL_TOOL_ROOT')

const browserRequire = createRequire(
  path.join(process.env.RUNNER_TEMP, 'mpg-browser-tools', 'package.json')
)
const { chromium } = browserRequire('playwright')
const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, opts)
const token = randomUUID().replaceAll('-', '')
const made = { organizations: [], users: [] }

function checked(result, operation) {
  if (result.error || result.data === null) {
    throw new Error('SYNTHETIC_BROWSER_' + operation + '_FAILED')
  }
  return result.data
}
async function makeUser(label) {
  const email = 'mr5-browser-' + label + '-' + token + '@example.test'
  const password = randomUUID() + 'Aa1!'
  const created = checked(await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  }), 'CREATE_USER')
  assert(created.user?.id, 'MISSING_SYNTHETIC_USER')
  made.users.push(created.user.id)
  return { email, password, id: created.user.id }
}
async function makeOrg(name) {
  const row = checked(await admin.from('organizations').insert({
    name: 'Browser ' + name,
    slug: 'mr5-browser-' + name.toLowerCase() + '-' + token,
  }).select('id').single(), 'CREATE_ORGANIZATION')
  made.organizations.push(row.id)
  return row.id
}
async function auditCount(id) {
  const result = await admin.from('audit_events')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', id).eq('event_type', 'support.billing_recovery_inspection')
  if (result.error || result.count === null) throw new Error('AUDIT_COUNT_UNAVAILABLE')
  return result.count
}
async function login(page, actor) {
  await page.goto(app + '/login', { waitUntil: 'domcontentloaded' })
  await page.getByLabel('Email address').fill(actor.email)
  await page.getByLabel('Password').fill(actor.password)
  await Promise.all([
    page.waitForURL(/\/app(?:\/|$)/, { timeout: 60000 }),
    page.getByRole('button', { name: 'Sign In' }).click(),
  ])
}
async function visibleText(page, included, excluded = []) {
  // Next.js client navigation and streamed RSC updates can finish after a
  // link click settles. Wait on visible DOM truth instead of a fixed sleep.
  try {
    await page.waitForFunction(
      required => required.every(part => document.body.innerText.includes(part)),
      included, { timeout: 30000 },
    )
  } catch {
    throw new Error('BROWSER_VIEW_NOT_READY: ' + included.join(' | ') +
      ' PATH=' + new URL(page.url()).pathname)
  }
  const body = await page.locator('body').innerText()
  for (const part of excluded) assert(!body.includes(part), 'UNEXPECTED_TEXT: ' + part)
}

let browser
try {
  const owner = await makeUser('owner')
  const support = await makeUser('support')
  const orgA = await makeOrg('A')
  const orgB = await makeOrg('B')
  const orgC = await makeOrg('C')
  checked(await admin.from('organization_users').insert([
    { organization_id: orgA, user_id: owner.id, role: 'OWNER' },
    { organization_id: orgB, user_id: owner.id, role: 'VIEWER' },
    { organization_id: orgA, user_id: support.id, role: 'VIEWER' },
  ]).select('id'), 'CREATE_MEMBERSHIPS')
  for (const id of [orgA, orgB]) {
    const { error } = await admin.rpc('provision_organization_trial', { p_org_id: id })
    if (error) throw new Error('SYNTHETIC_TRIAL_SETUP_FAILED')
  }
  checked(await admin.from('organization_billing_accounts').insert({
    organization_id: orgA, provider: 'stripe', environment: 'TEST',
    provider_customer_id: 'cus_Browser' + token,
  }).select('id').single(), 'CREATE_TEST_ACCOUNT')
  const request = checked(await admin.from('stripe_test_billing_recovery_reviews')
    .insert({
      organization_id: orgA, kind: 'CHECKOUT',
      reason: 'EXPIRED_CHECKOUT_SESSION', requested_by: owner.id,
    }).select('id').single(), 'CREATE_REVIEW')
  checked(await admin.from('support_access_grants').insert({
    organization_id: orgA, user_id: support.id,
    support_role: 'MPG_ADMIN',
    expires_at: new Date(Date.now() + 3600000).toISOString(),
  }).select('id').single(), 'CREATE_SUPPORT_GRANT')

  browser = await chromium.launch({ headless: true })
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport })
    const page = await context.newPage()
    page.setDefaultTimeout(45000)
    await login(page, owner)

    await page.goto(app + '/app/settings/billing')
    await visibleText(page, ['Multiple businesses detected'], ['cus_Browser', request.id])
    await page.getByRole('link', { name: 'Choose a business' }).click()
    await visibleText(page, ['Browser A', 'Browser B'], ['Browser C', request.id])
    const explicitBilling = '/workspace/organizations/' + orgA + '/billing'
    await page.locator('a[href="' + explicitBilling + '"]').click()
    await visibleText(page, [
      'Billing & subscription', '30 Free Review Requests',
      'A TEST account is linked to this business', 'Read-only engineering view',
    ], ['Browser B', request.id])
    assert(await page.getByRole('navigation', { name: 'Selected business views' }).isVisible())

    await page.goto(app + '/workspace/organizations/' + orgB + '/usage')
    await visibleText(page, ['Browser B', 'VIEWER', '30 remaining of 30 review requests'], [
      'Browser A', request.id,
    ])
    await page.goto(app + '/workspace/organizations/' + orgB + '/billing')
    await visibleText(page, ['Owner or administrator access required'], [request.id])
    await page.goto(app + '/workspace/organizations/' + orgC + '/billing')
    await visibleText(page, ['Business access could not be verified'], [request.id])
    await page.goto(app + '/admin/organizations/' + orgA + '/billing-recovery')
    await visibleText(page, ['Access unavailable'], [request.id])
    assert.equal(await auditCount(orgA), 0, 'OWNER_MUST_NOT_TRIGGER_SUPPORT_AUDIT')
    await context.close()
  }

  const supportContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
  const supportPage = await supportContext.newPage()
  supportPage.setDefaultTimeout(45000)
  await login(supportPage, support)
  await supportPage.goto(app + '/workspace/organizations/' + orgA + '/billing')
  await visibleText(supportPage, ['Owner or administrator access required'], [request.id])
  await supportPage.goto(app + '/admin/organizations/' + orgA + '/billing-recovery')
  await visibleText(supportPage, [
    'Billing recovery reviews', request.id, 'Investigation only',
    'not payment confirmation',
  ], ['Approve payment', 'cus_Browser'])
  assert(await supportPage.getByRole('region', {
    name: 'Open TEST billing review requests',
  }).isVisible(), 'SCROLLABLE_SUPPORT_REVIEW_TABLE_MISSING')
  assert.equal(await auditCount(orgA), 1, 'AUTHORIZED_READ_REQUIRES_ONE_AUDIT')

  checked(await admin.from('support_access_grants').update({
    revoked_at: new Date().toISOString(),
  }).eq('organization_id', orgA).eq('user_id', support.id).select('id'), 'REVOKE_SUPPORT')
  await supportPage.reload()
  await visibleText(supportPage, ['Access unavailable'], [request.id])
  assert.equal(await auditCount(orgA), 1, 'REVOKED_VIEW_MUST_NOT_WRITE_AUDIT')
  await supportContext.close()

  const { data: trials, error: trialError } = await admin.from('organization_entitlements')
    .select('organization_id,allocated_requests,consumed_requests,status')
    .in('organization_id', [orgA, orgB])
  assert.equal(trialError, null)
  assert.equal(trials?.length, 2)
  for (const trial of trials) {
    assert.equal(trial.allocated_requests, 30)
    assert.equal(trial.consumed_requests, 0)
    assert.equal(trial.status, 'NOT_STARTED')
  }
  console.log('PASS: desktop and mobile real-Chromium synthetic billing/support acceptance')
} finally {
  if (browser) await browser.close()
  for (const orgId of made.organizations) {
    const { error } = await admin.from('organizations').delete().eq('id', orgId)
    if (error) throw new Error('SYNTHETIC_BROWSER_ORG_CLEANUP_FAILED')
  }
  for (const userId of made.users) {
    const { error } = await admin.auth.admin.deleteUser(userId)
    if (error) throw new Error('SYNTHETIC_BROWSER_USER_CLEANUP_FAILED')
  }
}
