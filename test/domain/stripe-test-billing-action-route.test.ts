import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('server-only', () => ({}))
import { OPTIONS, POST } from '../../src/app/api/internal/billing/test/action/route'

const envKeys=[
  'ENABLE_STRIPE_TEST_BILLING_ACTIONS',
  'MPG_STRIPE_TEST_BILLING_ACTION_TARGET',
  'NEXT_PUBLIC_SUPABASE_URL',
  'ENABLE_LIVE_BILLING',
  'VERCEL_ENV',
  'SUPABASE_SERVICE_ROLE_KEY',
] as const
const saved=Object.fromEntries(envKeys.map(k=>[k,process.env[k]]))
const endpoint='http://localhost:3000/api/internal/billing/test/action'
const orgId='11111111-1111-4111-8111-111111111111'

function request(raw:string){
  return new NextRequest(endpoint,{
    method:'POST',
    headers:{
      'content-type':'application/json',
      'origin':'http://localhost:3000',
      'sec-fetch-site':'same-origin',
      'sec-fetch-mode':'cors',
      'x-mpg-billing-action':'1',
    },
    body:raw,
  })
}
describe('MR-5D3C2 Next.js billing route fail-closed boundary',()=>{
  beforeEach(()=>{
    for(const k of envKeys)delete process.env[k]
    process.env.ENABLE_LIVE_BILLING='false'
    process.env.NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:54331'
  })
  afterEach(()=>{
    for(const k of envKeys){
      if(saved[k]===undefined)delete process.env[k]
      else process.env[k]=saved[k]
    }
  })
  it('returns 404 before touching auth or Stripe when disabled by default',async()=>{
    const response=await POST(request(JSON.stringify({
      action:'CHECKOUT',organizationId:orgId,planId:'monthly',
    })))
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({outcome:'DISABLED'})
    expect(response.headers.get('cache-control')).toContain('no-store')
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })
  it('rejects oversized, malformed and foreign fields before credential construction',async()=>{
    process.env.ENABLE_STRIPE_TEST_BILLING_ACTIONS='true'
    process.env.MPG_STRIPE_TEST_BILLING_ACTION_TARGET='LOCAL_SYNTHETIC'
    for(const raw of [
      '{ malformed }',
      JSON.stringify({action:'PORTAL',organizationId:orgId,
        redirect:'https://attacker.example'}),
      JSON.stringify({action:'CHECKOUT',organizationId:orgId,planId:'invalid'}),
      ' '.repeat(1100),
    ]){
      const response=await POST(request(raw))
      expect(response.status).toBe(400)
      expect(await response.json()).toEqual({outcome:'INVALID_REQUEST'})
    }
  })
  it('denies valid requests when the server-only privileged credential is absent',async()=>{
    process.env.ENABLE_STRIPE_TEST_BILLING_ACTIONS='true'
    process.env.MPG_STRIPE_TEST_BILLING_ACTION_TARGET='LOCAL_SYNTHETIC'
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
    const response=await POST(request(JSON.stringify({
      action:'PORTAL',organizationId:orgId,
    })))
    expect(response.status).toBe(404)
    expect(await response.json()).toEqual({outcome:'DISABLED'})
  })
  it('does not enable CORS preflight or browser OPTIONS access',async()=>{
    const response=await OPTIONS()
    expect(response.status).toBe(405)
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })
})
