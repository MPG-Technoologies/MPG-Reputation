import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

describe('Dashboard realtime topic contract', () => {
  it('client subscription matches the authorized database broadcast topic', () => {
    const dashboardPath = path.resolve(
      process.cwd(),
      'src/app/app/dashboard/live-dashboard.tsx'
    )

    const migrationPath = path.resolve(
      process.cwd(),
      'supabase/migrations/20260919003000_dashboard_realtime_hardening.sql'
    )

    const dashboard = fs.readFileSync(dashboardPath, 'utf8')
    const migration = fs.readFileSync(migrationPath, 'utf8')

    expect(dashboard).toContain(
      'const topic = `organization:${orgId}:dashboard`'
    )

    expect(dashboard).not.toContain(
      'const topic = `tenant:${orgId}`'
    )

    expect(migration).toContain(
      "realtime.topic() LIKE 'organization:%:dashboard'"
    )

    expect(migration).toContain(
      "v_topic := 'organization:' || NEW.organization_id::text || ':dashboard'"
    )
  })
})
