// @opennextjs/cloudflare build config. Defaults are correct here: every page is `force-dynamic`
// (no ISR/SSG to cache), so there is no incremental cache, no R2 bucket and no Durable Object to wire.
// `opennextjs-cloudflare build` runs the package.json `build` script, so `next build --webpack`
// (which @serwist/next requires) is preserved.
import { defineCloudflareConfig } from '@opennextjs/cloudflare'

export default defineCloudflareConfig({})
