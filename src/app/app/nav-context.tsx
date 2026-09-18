'use client'

import React, { createContext, useContext, useState, useTransition } from 'react'
import { useRouter, usePathname } from 'next/navigation'

interface NavigationContextType {
  isNavigating: boolean
  pendingPath: string | null
  navigateTo: (href: string) => void
}

const NavigationContext = createContext<NavigationContextType>({
  isNavigating: false,
  pendingPath: null,
  navigateTo: () => {},
})

export function NavigationProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [isPending, startTransition] = useTransition()
  const [targetPath, setTargetPath] = useState<string | null>(null)

  // Derive pendingPath purely during render without triggering effect cascading re-renders
  const pendingPath = isPending && targetPath !== pathname ? targetPath : null
  const isNavigating = Boolean(pendingPath)

  const navigateTo = (href: string) => {
    if (href === pathname) {
      return
    }
    setTargetPath(href)
    startTransition(() => {
      router.push(href)
    })
  }

  return (
    <NavigationContext.Provider value={{ isNavigating, pendingPath, navigateTo }}>
      {children}
    </NavigationContext.Provider>
  )
}

export function useNavigation() {
  return useContext(NavigationContext)
}
