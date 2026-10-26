import { redirect } from 'next/navigation'
import { getAuthContext } from '@/server/auth/context'
import { isCraneQrValue } from '@/server/cranes/qr'
import { findCraneByQrValue } from '@/server/cranes/cranes'

/**
 * Where a scanned crane sticker lands.
 *
 * A route handler rather than a page because there is nothing to render: it resolves the token and
 * forwards to the crane record. Signed-out scanning goes to the sign-in form, which is the correct
 * behaviour — a QR code on a machine in a plant room must not be a way to read the register without an
 * account.
 *
 * A token that does not resolve, or resolves to a crane this user may not see, is the same answer:
 * the register. Distinguishing them would turn the sticker into a probe for which asset tags exist.
 */
export const dynamic = 'force-dynamic'

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params

  const context = await getAuthContext()
  if (!context) redirect('/login')

  if (!isCraneQrValue(token)) redirect('/cranes')

  const crane = await findCraneByQrValue(context, token)
  if (!crane) redirect('/cranes')

  redirect(`/cranes/${crane.id}`)
}
