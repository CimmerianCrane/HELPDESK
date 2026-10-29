import { PrismaClient } from '@prisma/client'
import { expect, test, type Page } from './fixtures'

/**
 * The parts book, the store's forms and the serial trace (slices 22–24).
 *
 * Builds its own part and two locations so it never has to reason about what the seed left behind,
 * and deletes them in `afterAll`. The part is created through the screen, because that is the path
 * with no other coverage.
 */

const PASSWORD = process.env.SEED_PASSWORD ?? 'cimmerian-dev-2026'
const STORE = 'store@cimmeriancrane.example'
const DISPATCHER = 'dispatch@cimmeriancrane.example'

const db = new PrismaClient()
const suffix = Math.random().toString(36).slice(2, 10)
const partNumber = `E2E-PT-${suffix.toUpperCase()}`
const batch = `BATCH-${suffix.toUpperCase()}`
const storeName = `E2E Store ${suffix}`
const vanName = `E2E Van ${suffix}`

const created = { warehouseId: '', vanId: '' }

test.beforeAll(async () => {
  const warehouse = await db.location.create({
    data: { name: storeName, type: 'WAREHOUSE' },
    select: { id: true },
  })
  const van = await db.location.create({
    data: { name: vanName, type: 'VAN' },
    select: { id: true },
  })
  created.warehouseId = warehouse.id
  created.vanId = van.id
})

test.afterAll(async () => {
  const part = await db.part.findUnique({ where: { partNumber }, select: { id: true } })
  if (part) {
    await db.auditLog.deleteMany({ where: { entityId: part.id } })
    await db.stockMovement.deleteMany({ where: { partId: part.id } })
    await db.stockLevel.deleteMany({ where: { partId: part.id } })
    await db.part.deleteMany({ where: { id: part.id } })
  }
  await db.location.deleteMany({ where: { id: { in: [created.warehouseId, created.vanId] } } })
  await db.$disconnect()
})

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await expect(page).toHaveURL(/\/dashboard/)
}

test('a traced part is created, received, transferred and read back from the trace', async ({
  page,
}) => {
  test.setTimeout(180_000)
  await signIn(page, STORE)

  // Add the part from the list screen.
  await page.goto('/parts')
  await page.getByText('Add a part to the catalogue').click()
  await page.locator('#new-partNumber').fill(partNumber)
  await page.locator('#new-uom').fill('pc')
  await page.locator('#new-description').fill(`E2E traced part ${suffix}`)
  await page.locator('#new-cost').fill('10')
  await page.locator('#new-sellPrice').fill('20')
  await page.locator('#new-track').check()
  await page.getByRole('button', { name: 'Add part' }).click()

  await expect(page.getByRole('heading', { name: partNumber })).toBeVisible()
  const partUrl = page.url()

  // Receive a batch into the warehouse.
  await page.locator('#stock-type').selectOption('RECEIVE')
  await page.locator('#stock-quantity').fill('5')
  await page.locator('#stock-location').selectOption(created.warehouseId)
  await page.locator('#stock-serial').fill(batch)
  await page.locator('#stock-reason').fill('E2E receipt')
  await page.getByRole('button', { name: 'Post movement' }).click()

  // The serial appears twice — in the trace and in the movement list — so read the trace section.
  const trace = page.getByRole('region', { name: 'Serial and batch trace' })
  await expect(trace.getByText(batch)).toBeVisible()
  await expect(trace.getByText('5 pc still held')).toBeVisible()
  await expect(trace.getByText(`${storeName} (5)`)).toBeVisible()

  // Move half of it to the van; the trace has to follow the serial, not the part.
  await page.locator('#transfer-from').selectOption(created.warehouseId)
  await page.locator('#transfer-to').selectOption(created.vanId)
  await page.locator('#transfer-quantity').fill('2')
  await page.locator('#transfer-serial').fill(batch)
  await page.getByRole('button', { name: 'Transfer stock' }).click()

  // A transfer moves the batch without changing how much of it is still held.
  await expect(page.getByText('Stock transferred.')).toBeVisible()
  await expect(trace.getByText('5 pc still held')).toBeVisible()
  await expect(trace.getByText(`${storeName} (3)`)).toBeVisible()
  await expect(trace.getByText(`${vanName} (2)`)).toBeVisible()

  // A dispatcher reads the book but is offered no way to move stock.
  await page.getByRole('button', { name: 'Sign out' }).click()
  await page.waitForURL(/\/login/)
  await signIn(page, DISPATCHER)
  await page.goto(partUrl)

  await expect(page.getByRole('heading', { name: partNumber })).toBeVisible()
  await expect(trace.getByText('5 pc still held')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Post movement' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Transfer stock' })).toHaveCount(0)
})
