import { PrismaClient } from '@prisma/client'
import { expect, test, type Page } from './fixtures'
import { DEMO_PASSWORD, signIn } from './helpers'

/**
 * The inbox in a browser (slice 38).
 *
 * The integration suite proves the scoping. This proves the part only a browser can: that an alert
 * raised by the app against the demo accounts actually appears on the screen, that the nav badge
 * counts it, and that "Mark read" clears both.
 *
 * The rows are created directly rather than by raising a P1 through triage. A P1 writes a ticket, a
 * job and four notification rows, and this spec is about the reading of a notification, not the
 * raising of one — `tests/integration/tickets.test.ts` owns that half.
 */

const db = new PrismaClient()
const DISPATCHER = 'dispatch@cimmeriancrane.example'
const ADMIN = 'admin@cimmeriancrane.example'

const TITLE = `Inbox spec alert ${Date.now()}`

async function clearInbox(): Promise<void> {
  await db.notification.deleteMany({
    where: { user: { email: { in: [DISPATCHER, ADMIN] } } },
  })
}

test.describe('the inbox', () => {
  test.beforeEach(async () => {
    await clearInbox()
  })

  test.afterAll(async () => {
    await clearInbox()
    await db.$disconnect()
  })

  test('an in-app alert appears for its recipient, and only for them', async ({ page }) => {
    const dispatcher = await db.user.findUniqueOrThrow({
      where: { email: DISPATCHER },
      select: { id: true },
    })
    await db.notification.create({
      data: {
        userId: dispatcher.id,
        channel: 'IN_APP',
        title: TITLE,
        body: 'Crane down at Jurong Port.',
        link: '/tickets',
        sentAt: new Date(),
      },
    })

    await signIn(page, DISPATCHER, DEMO_PASSWORD)
    await expect(page).toHaveURL(/\/dashboard/)

    // The badge is the only reason anybody opens the screen.
    const inboxLink = page.getByRole('link', { name: /Inbox/ })
    await expect(inboxLink).toContainText('1')

    await inboxLink.click()
    await expect(page).toHaveURL(/\/inbox$/)
    await expect(page.getByText(TITLE)).toBeVisible()
    await expect(page.getByText('Crane down at Jurong Port.')).toBeVisible()

    // The other account does not see it.
    await page.getByRole('button', { name: 'Sign out' }).click()
    await page.waitForURL(/\/login/)

    await signIn(page, ADMIN, DEMO_PASSWORD)
    await expect(page).toHaveURL(/\/dashboard/)
    // The Admin's own badge is clear, because the row was addressed to the dispatcher.
    const adminLink = page.getByRole('link', { name: /Inbox/ })
    await expect(adminLink).not.toContainText('1')

    await adminLink.click()
    await expect(page.getByText(TITLE)).not.toBeVisible()
  })

  test('marking an alert read clears the badge and the unread filter', async ({ page }) => {
    const dispatcher = await db.user.findUniqueOrThrow({
      where: { email: DISPATCHER },
      select: { id: true },
    })
    await db.notification.create({
      data: {
        userId: dispatcher.id,
        channel: 'IN_APP',
        title: TITLE,
        body: 'A weekly service is nearly due.',
        sentAt: new Date(),
      },
    })

    await signIn(page, DISPATCHER, DEMO_PASSWORD)
    await expect(page).toHaveURL(/\/dashboard/)
    await page.getByRole('link', { name: /Inbox/ }).click()
    await expect(page).toHaveURL(/\/inbox$/)

    await page.getByRole('button', { name: 'Mark read' }).first().click()

    await expect(page.getByText('Nothing unread.')).toBeVisible()
    await expect(page.getByRole('link', { name: /Inbox/ })).not.toContainText('1')

    // The unread filter now shows the empty state rather than the row just read.
    await page.getByRole('link', { name: 'Unread' }).click()
    await expect(page).toHaveURL(/unread=1/)
    await expect(page.getByText(TITLE)).not.toBeVisible()
  })

  test('a failed delivery is shown with its reason rather than silently dropped', async ({
    page,
  }) => {
    const dispatcher = await db.user.findUniqueOrThrow({
      where: { email: DISPATCHER },
      select: { id: true },
    })
    await db.notification.create({
      data: {
        userId: dispatcher.id,
        channel: 'SMS',
        title: TITLE,
        body: 'P1 raised.',
        sentAt: null,
        failedAt: new Date(),
        error: 'gateway refused',
      },
    })

    await signIn(page, DISPATCHER, DEMO_PASSWORD)
    await expect(page).toHaveURL(/\/dashboard/)
    await page.getByRole('link', { name: /Inbox/ }).click()

    await expect(page.getByText(TITLE)).toBeVisible()
    await expect(page.getByText(/SMS failed/)).toBeVisible()
    await expect(page.getByText(/gateway refused/)).toBeVisible()
  })
})
