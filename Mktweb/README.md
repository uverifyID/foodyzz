# UniHamper — Marketing Website (Mktweb)

A standalone **Next.js (App Router)** marketing & sales site for UniHamper, built as
a **static export** — `npm run build` produces a self-contained `out/` folder of
plain HTML/CSS/JS that you drop straight into Hostinger's `public_html` (no Node
process, works on any plan).

It is **informational only** — no login, ordering, or payments. Sibling to
`scrubs/` and `scrubshq/` inside the `Laundry/` repo, but a fully independent
project (its own `package.json` / `node_modules`).

## Pages

| Route       | What it is                                                            |
| ----------- | -------------------------------------------------------------------- |
| `/`         | Hero, customer vs provider CTA cards (store badges + QR), how-it-works |
| `/faq`      | Accordion of common questions                                         |
| `/contact`  | Contact form (posts to Formspree) + direct email/social links        |

## Local development

```bash
cd Mktweb
npm install
npm run dev          # http://localhost:3000 (live reload)
```

Build the static site and preview the exact output that ships:

```bash
npm run build        # -> out/   (the folder you upload)
npm run serve        # serves out/ locally to double-check
```

## Configure before launch (all in one file)

Edit [`src/lib/siteConfig.ts`](src/lib/siteConfig.ts):

- `appStoreUrl` / `playStoreUrl` — real store listings (store buttons + QR codes
  follow automatically).
- `formspreeId` — create a free form at <https://formspree.io>, paste the ID (the
  part after `/f/`). Until set, the contact form shows a "not set up yet" notice
  and points visitors at your email.
- `email`, `social.*` — your real contact details.

Set the public URL in `.env.local` (used for QR + share tags):

```
NEXT_PUBLIC_SITE_URL=https://yourdomain.com
```

**Colors / theme** live in [`tailwind.config.ts`](tailwind.config.ts) — this is
the Phase-1 palette. See `PHASE2-NOTES.md`.

## Deploying to Hostinger (static / public_html)

1. **Build** locally:
   ```bash
   npm install
   npm run build
   ```
2. Upload the **contents of the `out/` folder** into your domain's `public_html`
   (via hPanel **File Manager** → Upload + extract a zip, or FTP/SFTP).
   - Upload what's *inside* `out/` (so `index.html` sits at the root of
     `public_html`), not the `out` folder itself.
3. Point your domain at that site in hPanel. Done — no Node app, no startup
   command, no env vars on the server.

> URLs use trailing slashes (`/faq/`, `/contact/`) because the export emits
> `faq/index.html` etc., which Apache serves cleanly. The included `404.html`
> handles unknown paths.

To update the site later: re-run `npm run build` and re-upload `out/`.

## What this site intentionally does NOT do

- No login, ordering, payments, or backend.
- Contact form delivery is handled entirely by Formspree (3rd-party).
