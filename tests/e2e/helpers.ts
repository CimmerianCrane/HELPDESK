import type { Page } from './fixtures'

/** The password every seeded demo account shares, unless `SEED_PASSWORD` overrides it. */
export const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? 'cimmerian-dev-2026'

/**
 * Opens the nav when it is folded away. It is a sidebar on a desktop and an off-canvas sheet below
 * `lg`, so a spec that runs in the phone project cannot click a nav link until this has run.
 */
export async function openNav(page: Page): Promise<void> {
  const menu = page.getByRole('button', { name: 'Menu' })
  if (await menu.isVisible()) await menu.click()
}

export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}
