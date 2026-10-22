import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, appendFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import {
  assertIsolatedSyntheticEnv, verifyIsolatedSources, assertFrozenBaselineCheckout,
} from '../../scripts/acceptance/mr5-isolated-rehearsal-preflight.mjs'
import { gitBlobSha1 } from '../../scripts/acceptance/mr5-verify-reviewed-migrations.mjs'

const accepted = [
'20260917000001','20260918235000','20260919003000','20260919010000',
'20260919020000','20260919030000','20260919031000','20260919040000',
'20260919040100','20260919050000','20260919060000','20260919170000',
'20260919180000','20260921174500','20260921203000','20260921212000',
'20260922071808','20261007000000','20261008000000','20261008010000',
'20261009000000','20261009120000','20261009140000','20261010000000',
'20261010010000','20261011120000',
]
const safe = {
  CI:'true', GITHUB_ACTIONS:'true', PGHOST:'127.0.0.1',
  PGPORT:'54332', PGUSER:'postgres', PGPASSWORD:'postgres',
  PGDATABASE:'postgres', EMAIL_PROVIDER:'console',
  ENABLE_LIVE_EMAIL:'false', ENABLE_LIVE_BILLING:'false',
  ENABLE_RETENTION_MAINTENANCE:'false',
}

function fixture(t) {
  const parent = mkdtempSync(path.join(os.tmpdir(),'mr5i19-synthetic-'))
  t.after(()=>rmSync(parent,{recursive:true,force:true}))
  const baseline = path.join(parent,'baseline')
  const candidate = path.join(parent,'candidate')
  for (const root of [baseline,candidate]) {
    mkdirSync(path.join(root,'supabase','migrations'),{recursive:true})
    writeFileSync(path.join(root,'supabase','config.toml'),'project_id = "MPG-Reputation"\n')
  }
  for (const version of accepted) {
    const filename=version+'_baseline_synthetic.sql'
    const contents='-- fixture '+filename+'\n'
    for (const root of [baseline,candidate]) writeFileSync(path.join(root,'supabase','migrations',filename),contents)
  }
  const items=[]
  for (let i=0;i<22;i++) {
    const filename=String(20261018150000+i)+'_synthetic_candidate_'+i+'.sql'
    const bytes=Buffer.from('-- synthetic-only fixture '+i+'\n')
    writeFileSync(path.join(candidate,'supabase','migrations',filename),bytes)
    items.push({file:filename,git_blob_sha1:gitBlobSha1(bytes)})
  }
  const manifest={
    schema_version:1,
    status:'REVIEWED_REPOSITORY_CANDIDATE_ONLY_NO_HOSTED_APPLY',
    parent_candidate_commit:'699c8a9ad8d6c356eeb0e29affa83feeeac2a227',
    accepted_hosted_migration_count:26,
    accepted_hosted_latest_version:'20261011120000',
    proposed_count:22,
    items,
  }
  return { baseline,candidate,manifest }
}

test('the only allowed environment is disposable CI loopback and provider-OFF',()=>{
  assert.deepEqual(assertIsolatedSyntheticEnv({...safe}), {
    isolated:true,providers:'DISABLED',kind:'DISPOSABLE_SYNTHETIC_ONLY',
  })
  for (const [key,bad] of Object.entries({
    CI:'false',GITHUB_ACTIONS:'false',PGHOST:'db.awvqtwkzprygsoyfspuz.supabase.co',
    PGPORT:'5432',PGUSER:'postgres.awvqtwkzprygsoyfspuz',
    PGPASSWORD:'real-secret',PGDATABASE:'other',
    EMAIL_PROVIDER:'resend',ENABLE_LIVE_EMAIL:'true',ENABLE_LIVE_BILLING:'true',
    ENABLE_RETENTION_MAINTENANCE:'true',DATABASE_URL:'postgres://hosted',
    SUPABASE_ACCESS_TOKEN:'secret',SUPABASE_DB_URL:'postgres://hosted',
    SUPABASE_SERVICE_ROLE_KEY:'secret',STRIPE_SECRET_KEY:'sk_test',
    STRIPE_WEBHOOK_SECRET:'whsec',RESEND_API_KEY:'secret',
    TWILIO_AUTH_TOKEN:'secret',PGHOSTADDR:'127.0.0.1',
    PGSERVICE:'prod',PGPASSFILE:'/tmp/hosted-pass',
    VERCEL_ENV:'production',NEXT_PUBLIC_SUPABASE_URL:'https://hosted.supabase.co',
  })) {
    assert.throws(()=>assertIsolatedSyntheticEnv({...safe,[key]:bad}),undefined,key)
  }
})

test('unchanged synthetic 26→48 schema chain and exact fingerprints pass preflight',t=>{
  const f=fixture(t)
  assert.deepEqual(verifyIsolatedSources(f.candidate,f.baseline,f.manifest),{
    mode:'SYNTHETIC_REHEARSAL_SOURCE_GUARD_PASS',
    baseline_versions:26,pending_versions:22,
    hosted_restore_verified:false,hosted_migrations_authorized:false,
  })
})

test('changing accepted baseline SQL bytes fails before any database exists',t=>{
  const f=fixture(t)
  const fpath=path.join(f.candidate,'supabase','migrations',accepted[8]+'_baseline_synthetic.sql')
  appendFileSync(fpath,'-- modified accepted baseline\n')
  assert.throws(()=>verifyIsolatedSources(f.candidate,f.baseline,f.manifest),/ACCEPTED_BASELINE_SQL_BYTES_CHANGED/)
})

test('missing or extra candidate files and altered held migration SQL fail closed',t=>{
  const f=fixture(t)
  const file=path.join(f.candidate,'supabase','migrations',f.manifest.items[0].file)
  appendFileSync(file,'-- mutation after source review\n')
  assert.throws(()=>verifyIsolatedSources(f.candidate,f.baseline,f.manifest),/REVIEWED_SQL_BLOB_CHANGED_AT_INDEX_1/)
})

test('an incorrectly configured Supabase checkout and same-path baseline are rejected',t=>{
  const f=fixture(t)
  assert.throws(()=>verifyIsolatedSources(f.candidate,f.candidate,f.manifest),/BASELINE_AND_CANDIDATE_MUST_BE_SEPARATE/)
  writeFileSync(path.join(f.baseline,'supabase','config.toml'),'project_id = "AnotherProject"\n')
  assert.throws(()=>verifyIsolatedSources(f.candidate,f.baseline,f.manifest),/UNEXPECTED_LOCAL_SUPABASE_PROJECT/)
})

test('a working directory without the frozen accepted baseline commit is rejected',t=>{
  const f=fixture(t)
  assert.throws(()=>assertFrozenBaselineCheckout(f.baseline),/FROZEN_MAIN_BASELINE_CHECKOUT_MISMATCH/)
})
