'use server'

import { signOut } from '@/server/auth/config'

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: '/login' })
}
