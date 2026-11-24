import { useState, type ReactNode } from 'react'
import { AuthOverlay, useAuth } from 'deepspace'
import { Button } from '@/components/ui'

/** Renders children for signed-in users, otherwise a small sign-in call to action. */
export function SignedInOnly({ children, label }: { children: ReactNode; label: string }) {
  const { isSignedIn } = useAuth()
  const [open, setOpen] = useState(false)
  if (isSignedIn) return <>{children}</>
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Sign in to {label}
      </Button>
      {open && <AuthOverlay onClose={() => setOpen(false)} title="Sign in to Lorekeep" />}
    </>
  )
}
