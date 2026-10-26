'use server'

import { AuthError } from 'next-auth'
import { headers } from 'next/headers'
import { z } from 'zod'
import { signIn } from '@/server/auth/config'
import {
  LOGIN_LIMITS,
  clientIp,
  emailKey,
  ipKey,
  peekRateLimit,
} from '@/server/auth/rate-limit'

export interface LoginState {
  message: string | null
  fields?: Record<string, string[]>
}

const schema = z.object({
  email: z.string().trim().toLowerCase().min(1, 'Enter your email address.'),
  password: z.string().min(1, 'Enter your password.'),
})

/**
 * Where to go after signing in. Only same-origin absolute paths are accepted: `//evil.com` and
 * `https://evil.com` both pass a naive `startsWith('/')` check and would make this an open redirect.
 */
function safeNext(value: FormDataEntryValue | null): string {
  const raw = typeof value === 'string' ? value : ''
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/dashboard'
  return raw
}

export async function signInAction(_previous: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = schema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  })

  if (!parsed.success) {
    return {
      message: 'Please correct the highlighted fields.',
      fields: parsed.error.flatten().fieldErrors,
    }
  }

  // A peek only — `authorize` is the sole place that consumes an attempt. This exists so a locked-out
  // user is told to wait rather than being told their password is wrong.
  const ip = clientIp(await headers())
  const buckets = [
    [emailKey(parsed.data.email), LOGIN_LIMITS.perEmail],
    [ipKey(ip), LOGIN_LIMITS.perIp],
  ] as const

  for (const [key, policy] of buckets) {
    const peek = await peekRateLimit(key, policy.limit, policy.windowMs)
    if (!peek.allowed) {
      const minutes = Math.max(1, Math.ceil(peek.retryAfterSeconds / 60))
      return {
        message: `Too many sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
      }
    }
  }

  try {
    await signIn('credentials', {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: safeNext(formData.get('next')),
    })
    return { message: null }
  } catch (error) {
    // signIn redirects by throwing; only an AuthError means the credentials were rejected.
    if (error instanceof AuthError) {
      return { message: 'Email or password is incorrect.' }
    }
    throw error
  }
}
