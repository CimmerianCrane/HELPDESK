import type { Page } from './fixtures'

/** The password every seeded demo account shares, unless `SEED_PASSWORD` overrides it. */
export const DEMO_PASSWORD = process.env.SEED_PASSWORD ?? 'cimmerian-dev-2026'

export async function signIn(page: Page, email: string, password: string): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email').fill(email)
  await page.getByLabel('Password').fill(password)
  await page.getByRole('button', { name: 'Sign in' }).click()
}
