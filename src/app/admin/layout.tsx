import type { Metadata } from 'next'
import { AdminWorkspace } from '@/components/admin/admin-ui'

export const metadata: Metadata = {
  title: 'Internal Operations | MPG Reputation',
  robots: { index: false, follow: false },
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminWorkspace>{children}</AdminWorkspace>
}
