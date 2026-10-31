'use server'

import { signOut } from '@/server/auth/config'

/** Shared by both shells: the office header and the technician's bottom bar sign out the same way. */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: '/login' })
}

/**
 * The technician's sign-out lands on `/m/login`, not `/login`. Inside an installed app a redirect
 * out to the website leaves the app and opens Chrome — see the tablet plan's `/m/login` note.
 */
export async function techSignOutAction(): Promise<void> {
  await signOut({ redirectTo: '/m/login' })
}
