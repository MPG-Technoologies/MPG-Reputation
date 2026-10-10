import { describe, it, expect } from 'vitest'
import { execSync } from 'child_process'
import path from 'path'
import {
  assertAllowedLocalSupabaseUrl,
  ALLOWED_LOCAL_SUPABASE_ORIGINS,
} from '../../scripts/bootstrap-local-dev.mjs'

describe('Deterministic Local Dev Bootstrap URL Guard', () => {
  const SCRIPT_PATH = path.resolve(__dirname, '../../scripts/bootstrap-local-dev.mjs')

  describe('1. Direct Assertion Guard Validation', () => {
    it('approves exact http://127.0.0.1:54331 origin', () => {
      expect(assertAllowedLocalSupabaseUrl('http://127.0.0.1:54331')).toBe('http://127.0.0.1:54331')
      expect(assertAllowedLocalSupabaseUrl('http://127.0.0.1:54331/')).toBe('http://127.0.0.1:54331')
    })

    it('approves exact http://localhost:54331 origin', () => {
      expect(assertAllowedLocalSupabaseUrl('http://localhost:54331')).toBe('http://localhost:54331')
      expect(assertAllowedLocalSupabaseUrl('http://localhost:54331/')).toBe('http://localhost:54331')
    })

    it.each([
      'http://localhost:54321',
      'http://127.0.0.1:9999',
      'https://localhost:54331',
      'https://example.supabase.co',
      'http://localhost:3000',
      'http://127.0.0.1:8080',
      'http://attacker.com:54331',
      'https://127.0.0.1:54331',
      'ftp://localhost:54331',
    ])('rejects non-approved origin: %s', (disallowedUrl) => {
      expect(() => assertAllowedLocalSupabaseUrl(disallowedUrl)).toThrow(
        /\[BOOTSTRAP FATAL\] Refusing to run dev bootstrap against non-local Supabase URL/
      )
    })

    it('rejects empty or invalid URLs', () => {
      expect(() => assertAllowedLocalSupabaseUrl('')).toThrow(/Invalid Supabase URL/)
      expect(() => assertAllowedLocalSupabaseUrl(null as unknown as string)).toThrow(/Invalid Supabase URL/)
      expect(() => assertAllowedLocalSupabaseUrl('not-a-valid-url')).toThrow(/malformed Supabase URL/)
    })

    it('confirms ALLOWED_LOCAL_SUPABASE_ORIGINS contains exactly the two authorized local origins', () => {
      expect(Array.from(ALLOWED_LOCAL_SUPABASE_ORIGINS).sort()).toEqual([
        'http://127.0.0.1:54331',
        'http://localhost:54331',
      ])
    })
  })

  describe('2. Fail-Closed CLI Subprocess Invocation Verification', () => {
    it.each([
      'http://localhost:54321',
      'http://127.0.0.1:9999',
      'https://localhost:54331',
      'https://example.supabase.co',
    ])('terminates process with exit code 1 for disallowed URL: %s', (disallowedUrl) => {
      let exitCode: number | null = null
      let output = ''

      try {
        output = execSync(`node "${SCRIPT_PATH}"`, {
          env: {
            ...process.env,
            NEXT_PUBLIC_SUPABASE_URL: disallowedUrl,
          },
          encoding: 'utf8',
          stdio: ['pipe', 'pipe', 'pipe'],
        })
        exitCode = 0
      } catch (err: unknown) {
        const execErr = err as { status?: number; stdout?: string; stderr?: string }
        exitCode = execErr.status ?? null
        output = (execErr.stderr || '') + (execErr.stdout || '')
      }

      expect(exitCode).toBe(1)
      expect(output).toContain('[BOOTSTRAP FATAL] Refusing to run dev bootstrap against non-local Supabase URL')
      expect(output).toContain(disallowedUrl)
    })
  })
})
