// The Worker entry. OpenNext's generated worker only exports `fetch`; a cron trigger needs
// `scheduled()`, so this wraps it. Plain .mjs on purpose — `.open-next/worker.js` does not exist until
// the build has run, so a .ts file here would fail `tsc --noEmit`.
import handler from './.open-next/worker.js'

export default {
  fetch: handler.fetch,

  // Runs `/api/cron/daily` in-process, so the route's own CRON_SECRET check and its logic stay the
  // single source of truth. `env`/`ctx` are forwarded so `getCloudflareContext()` resolves inside.
  async scheduled(_event, env, ctx) {
    const response = await handler.fetch(
      new Request('https://cron.internal/api/cron/daily', {
        headers: { authorization: `Bearer ${env.CRON_SECRET ?? ''}` },
      }),
      env,
      ctx,
    )
    if (!response.ok) {
      console.error('cron.daily failed', response.status, await response.text())
    }
  },
}
