This is an EmDash site -- a CMS built on Astro with a full admin UI.

## Commands

```bash
npx emdash dev        # Start dev server (runs migrations, seeds, generates types)
npx emdash types      # Regenerate TypeScript types from schema
npx emdash seed seed/seed.json --validate  # Validate seed file
```

The admin UI is at `http://localhost:4321/_emdash/admin`.

## Key Files

| File                     | Purpose                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------- |
| `astro.config.mjs`       | Astro config with `emdash()` integration, database, and storage                    |
| `src/live.config.ts`     | EmDash loader registration (boilerplate -- don't modify)                           |
| `seed/seed.json`         | Schema definition + demo content (collections, fields, taxonomies, menus, widgets) |
| `emdash-env.d.ts`        | Generated types for collections (auto-regenerated on dev server start)             |
| `src/layouts/Base.astro` | Base layout with EmDash wiring (menus, search, page contributions)                 |
| `src/pages/`             | Astro pages -- all server-rendered                                                 |

## Skills

Agent skills are in `.agents/skills/`. Load them when working on specific tasks:

- **building-emdash-site** -- Querying content, rendering Portable Text, schema design, seed files, site features (menus, widgets, search, SEO, comments, bylines). Start here.
- **creating-plugins** -- Building EmDash plugins with hooks, storage, admin UI, API routes, and Portable Text block types.
- **emdash-cli** -- CLI commands for content management, seeding, type generation, and visual editing flow.

## Rules

- All content pages must be server-rendered (`output: "server"`). No `getStaticPaths()` for CMS content.
- Image fields are objects (`{ src, alt }`), not strings. Use `<Image image={...} />` from `"emdash/ui"`.
- `entry.id` is the slug (for URLs). `entry.data.id` is the database ULID (for API calls like `getEntryTerms`).
- Always call `Astro.cache.set(cacheHint)` on pages that query content.
- Taxonomy names in queries must match the seed's `"name"` field exactly (e.g., `"category"` not `"categories"`).

## Navigation — Always use getMenu

Never hardcode nav links in `Base.astro` or any layout. Always fetch from EmDash:

```typescript
import { getMenu } from "emdash";
const primaryMenu = await getMenu("primary");
const navLinks = primaryMenu?.items.map(item => [item.url, item.label]) ?? [];
```

The `primary` menu is defined in `seed/seed.json` and editable from the admin. Hardcoding nav requires a redeploy to change a link.

## Site Settings — Always use getSiteSettings

Never hardcode the site name, tagline, or other settings. Use:

```typescript
import { getSiteSettings } from "emdash";
const settings = await getSiteSettings();
```

## Forms — Always use the EmDash Forms Plugin

Never build custom D1 handlers, raw fetch endpoints, or bypass `@emdash-cms/plugin-forms`. The forms plugin provides spam protection, an admin submissions inbox, email notifications, and CSV export.

**Correct pattern:**

1. Go to `/_emdash/admin` → Forms → create a new form with the required fields
2. Note the form slug (e.g. `demo-request`)
3. The plugin route only parses JSON — use `fetch` with `Content-Type: application/json`, NOT a plain HTML form POST:
   ```javascript
   fetch('/_emdash/api/plugins/emdash-forms/submit', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ formId: 'demo-request', data: { field1: value1, ... } }),
   });
   ```

The forms plugin is already registered in `astro.config.mjs`. All that's needed is the form definition in the admin. If admin access is unavailable, document the manual step in a TODO comment — do not build a parallel system.

## Content Pages — Use the CMS pages Collection

Simple content pages (legal docs, policy pages, informational pages) must be entries in the `pages` CMS collection, not static `.astro` files. This lets editors update them from the admin without a redeploy.

The `pages` collection is defined in `seed/seed.json`. The route template is at `src/pages/pages/[slug].astro`.

```typescript
// src/pages/pages/[slug].astro
const { entry: page, cacheHint } = await getEmDashEntry("pages", slug);
Astro.cache.set(cacheHint);
```

**Exception:** Marketing/product pages with complex custom layouts (platform, solutions, governance, pricing, etc.) may remain as static `.astro` files since they require component-level customisation not possible through a generic template.

## Analytics / Third-Party Scripts

Add site-level scripts (GTM, analytics, tracking pixels) directly to `Base.astro` inside `<head>` using Astro's `is:inline` directive — **before** `<EmDashHead>`:

```astro
<!-- Google Tag Manager -->
<script is:inline>(function(w,d,s,l,i){...})(window,document,'script','dataLayer','GTM-XXXXXX');</script>
<!-- End Google Tag Manager -->
<EmDashHead page={pageCtx} />
```

Add the GTM noscript iframe immediately after `<EmDashBodyStart>`:

```astro
<EmDashBodyStart page={pageCtx} />
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-XXXXXX" ...></iframe></noscript>
```

Do NOT try to use the `page:fragments` plugin hook for site-level analytics. That hook requires a distributable npm plugin with a resolvable module entrypoint — it cannot be registered inline from `astro.config.mjs`.

## Auth & Cloudflare Secrets

Google OAuth requires two Worker secrets (set via `npx wrangler secret put`):
- `EMDASH_OAUTH_GOOGLE_CLIENT_ID`
- `EMDASH_OAUTH_GOOGLE_CLIENT_SECRET`

EmDash on Astro v6 + `@astrojs/cloudflare` v13 uses `process.env` (via `nodejs_compat`) to read these — `locals.runtime.env` was removed in Astro v6. A patch in `patches/emdash+0.9.0.patch` fixes the OAuth routes to use `process.env`. Run `npm install` to re-apply it via the `postinstall` script.

The Resend email plugin also needs `RESEND_API_KEY` as a secret, but its value is configured via the admin UI at `/_emdash/admin/plugins/emdash-resend/settings`.

## Page Pattern Summary

| Page type                            | Where it lives                         |
| ------------------------------------ | -------------------------------------- |
| Marketing (platform, solutions, etc) | `src/pages/*.astro` (custom layout)    |
| Simple content (legal, info, etc)    | CMS `pages` collection → `/pages/slug` |
| Blog posts                           | CMS `posts` collection → `/posts/slug` |
| Contact / form pages                 | EmDash forms plugin via admin UI       |
