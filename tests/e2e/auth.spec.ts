import { expect, test } from './fixtures'
import { DEMO_PASSWORD as PASSWORD, signIn } from './helpers'

/**
 * Sign-in, and the two things that must be true once you are in: a technician cannot reach
 * administration, and a wrong password gets you nowhere.
 *
 * Needs the seed to have run (`npm run seed`), which creates one account per role.
 */

const ADMIN = 'admin@cimmeriancrane.example'
const TECHNICIAN = 'ahmad@cimmeriancrane.example'

test('a protected page redirects to the sign-in form when signed out', async ({ page }) => {
  await page.goto('/admin/users')
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible()
})

test('an administrator can sign in and reach the dashboard', async ({ page }) => {
  await signIn(page, ADMIN, PASSWORD)

  await expect(page).toHaveURL(/\/dashboard/)
  await expect(page.getByRole('heading', { name: /Hello, Alice/ })).toBeVisible()
  // The nav link only exists for a role that holds user.manage.
  await expect(page.getByRole('link', { name: 'Users' })).toBeVisible()
})

test('a wrong password is refused and says so', async ({ page }) => {
  await signIn(page, ADMIN, 'definitely-not-the-password')

  // Scoped to main: Next renders its own route announcer with role="alert" (#__next-route-announcer__),
  // so an unscoped getByRole('alert') is ambiguous.
  await expect(page.getByRole('main').getByRole('alert')).toContainText(
    'Email or password is incorrect',
  )
  await expect(page).toHaveURL(/\/login/)
})

// The attempted path is not carried through the redirect, so signing in from a deep link lands on
// the dashboard rather than the page that was asked for. That is deliberate for now — see the note
// in the office layout — and this test pins the current behaviour rather than implying otherwise.
test('signing in from a deep link lands on the dashboard', async ({ page }) => {
  await page.goto('/admin/users')
  await expect(page).toHaveURL(/\/login/)

  await page.getByLabel('Email').fill(ADMIN)
  await page.getByLabel('Password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()

  await expect(page).toHaveURL(/\/dashboard/)
})

test('a technician cannot see or reach user administration', async ({ page }) => {
  await signIn(page, TECHNICIAN, PASSWORD)
  await expect(page).toHaveURL(/\/dashboard/)

  // Not in the navigation, because the layout filters links by capability.
  await expect(page.getByRole('link', { name: 'Users' })).toHaveCount(0)

  // And not reachable by typing the address: the admin layout refuses server-side.
  await page.goto('/admin/users')
  await expect(page.getByRole('heading', { name: 'Not available for your role' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Users', exact: true })).toHaveCount(0)
})

test('signing out returns to the sign-in page', async ({ page }) => {
  await signIn(page, ADMIN, PASSWORD)
  await expect(page).toHaveURL(/\/dashboard/)

  await page.getByRole('button', { name: 'Sign out' }).click()

  await expect(page).toHaveURL(/\/login/)
  await page.goto('/dashboard')
  await expect(page).toHaveURL(/\/login/)
})
