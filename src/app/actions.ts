'use server'

import { signOut } from '@/server/auth/config'

/** Shared by both shells: the office header and the technician's bottom bar sign out the same way. */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: '/login' })
}
