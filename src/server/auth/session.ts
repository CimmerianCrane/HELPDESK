/**
 * Is a session issued at `signedInAt` still allowed to be used?
 *
 * A password reset has to end the sessions that were open when it happened. A JWT cannot be revoked
 * on its own, and the person clicking "Reset password" is usually doing it because a laptop or a
 * phone is gone. So the sign-in time travels inside the token and is compared here against the last
 * password change.
 *
 * A function of its own rather than two lines inside `getAuthContext`, because that only runs inside
 * a request and nothing can call it from a test — and this is the decision most worth pinning down.
 */
export function sessionIsCurrent(
  signedInAt: number | undefined,
  passwordChangedAt: Date | null,
): boolean {
  // No sign-in time means a token issued before this check shipped, or one we cannot date. Ask for a
  // fresh sign-in rather than guess.
  if (typeof signedInAt !== 'number') return false
  if (!passwordChangedAt) return true

  // Both are milliseconds since the epoch. A token issued in the same millisecond as the change
  // survives, which is the right way round: a sign-in that happens after a reset must keep working.
  return passwordChangedAt.getTime() <= signedInAt
}
