/**
 * Creates the first administrator on a database that has no accounts yet.
 *
 * The only other way to make a user is /admin/users, which needs an admin to sign in first — so a
 * fresh production database has no way in. Run this once, against whatever DATABASE_URL points at:
 *
 *   npm run admin:create
 *
 * It writes the same User row and AuditLog entry `createUser` would, so nothing downstream can tell
 * the difference. It deliberately does not check whether an admin exists: this is a bootstrap, and
 * an operator adding a second admin by hand is not a mistake worth blocking.
 */
import { createInterface } from 'node:readline/promises'
import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/server/auth/password'

const db = new PrismaClient()
const rl = createInterface({ input: process.stdin, output: process.stdout })

// Read a line without echoing it, so a password does not sit on screen during a screen share.
async function promptHidden(question: string): Promise<string> {
  process.stdout.write(question)
  const stdin = process.stdin
  stdin.setRawMode?.(true)
  stdin.resume()
  return new Promise((resolve) => {
    let value = ''
    const onData = (chunk: Buffer) => {
      const char = chunk.toString('utf8')
      if (char === '\r' || char === '\n') {
        stdin.setRawMode?.(false)
        stdin.pause()
        stdin.off('data', onData)
        process.stdout.write('\n')
        resolve(value)
      } else if (char === '\u0003') {
        process.exit(1)
      } else if (char === '\u007f' || char === '\b') {
        value = value.slice(0, -1)
      } else {
        value += char
      }
    }
    stdin.on('data', onData)
  })
}

async function main() {
  const email = (await rl.question('Email address: ')).trim().toLowerCase()
  const name = (await rl.question('Full name: ')).trim()
  rl.close()

  const password = await promptHidden('Password: ')

  if (!email || !name) throw new Error('Email and name are both required.')
  if (password.length < 12) throw new Error('Use at least 12 characters for an administrator password.')

  const existing = await db.user.findUnique({ where: { email }, select: { id: true } })
  if (existing) throw new Error(`${email} already exists. Use /admin/users or Change password instead.`)

  const user = await db.user.create({
    data: { email, name, role: 'ADMIN', passwordHash: await hashPassword(password) },
    select: { id: true, email: true, name: true, role: true },
  })

  await db.auditLog.create({
    data: {
      entity: 'User',
      entityId: user.id,
      action: 'CREATE',
      after: user,
      userId: null, // created by a CLI, not by a signed-in user
      userAgent: 'scripts/create-admin.ts',
    },
  })

  console.log(`\nCreated ${user.role} ${user.email} (${user.name}). Sign in, then use /account/password to change it.`)
}

main()
  .catch((error) => {
    console.error(String(error instanceof Error ? error.message : error))
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
