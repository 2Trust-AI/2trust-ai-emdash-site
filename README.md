# 2Trust.AI Website

Marketing and content site for [2Trust.AI](https://2trust.ai) — the enterprise control plane for LLMs. Built with [EmDash CMS](https://github.com/emdash-cms/emdash) on Cloudflare Workers + D1 + R2.

## Stack

- **Runtime:** Cloudflare Workers
- **Database:** D1 (`2trust-ai-emdash-site`)
- **Storage:** R2 (`2trust-ai-emdash-media`)
- **Framework:** Astro 6 + `@astrojs/cloudflare`
- **CMS:** EmDash 0.9 (admin at `/_emdash/admin`)

## Pages

| Page | Route | Type |
|---|---|---|
| Homepage | `/` | Static Astro |
| Platform | `/platform` | Static Astro |
| Solutions | `/solutions` | Static Astro |
| Governance | `/governance` | Static Astro |
| Developers | `/developers` | Static Astro |
| Pricing | `/pricing` | Static Astro |
| About | `/about` | Static Astro |
| Contact / Book demo | `/contact` | Static Astro |
| Privacy Policy | `/privacy-policy` | Static Astro |
| Terms | `/terms` | Static Astro |
| Blog posts | `/posts/:slug` | CMS collection |
| CMS pages | `/pages/:slug` | CMS collection |
| Search | `/search` | EmDash search |
| RSS | `/rss.xml` | Feed |

## Plugins

| Plugin | Purpose |
|---|---|
| `@emdash-cms/plugin-forms` | Demo request form with admin inbox |
| `emdash-plugin-resend` | Email delivery (magic links + form notifications) |
| `@emdash-cms/plugin-webhook-notifier` | Outbound webhooks on content events |

## Analytics

Google Tag Manager (`GTM-W8KTRGCX`) injected via `is:inline` script in `Base.astro`.

## Local Development

```bash
npm install
npx emdash dev
```

Admin UI at `http://localhost:4321/_emdash/admin`.

## Deploy

```bash
npm run deploy   # astro build && wrangler deploy
```

## Required Cloudflare Secrets

Set via `npx wrangler secret put <NAME>`:

| Secret | Purpose |
|---|---|
| `EMDASH_OAUTH_GOOGLE_CLIENT_ID` | Google OAuth login |
| `EMDASH_OAUTH_GOOGLE_CLIENT_SECRET` | Google OAuth login |
| `RESEND_API_KEY` | Email delivery via Resend |

## See Also

- [EmDash documentation](https://docs.emdashcms.com)
- [EmDash GitHub](https://github.com/emdash-cms/emdash)
