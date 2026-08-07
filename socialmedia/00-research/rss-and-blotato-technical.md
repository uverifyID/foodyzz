# RSS Generation + Blotato Publishing — Technical Reference

> Primary research, Aug 2026. This is the engineering spec behind the automation plan in ../06-automation/blotato-pipeline.md.

I'll load the web tools and start researching.

---

I'll research Blotato's capabilities first, then the four static site generators.

---

Good leads. Let me fetch the actual Blotato docs.

---

There's an LLM-optimized export. Let me grab it.

---

Let me dig into the RSS-related endpoints, the n8n node, and pricing.

---

Confirmed: Blotato's API has no RSS source type. Let me verify the app side and pricing.

---

Now let me verify the n8n side — the RSS trigger polling and the Blotato node listing.

---

Now let me research the RSS generation side, starting with Astro and Eleventy.

---

# Technical SEO Research Report: RSS Feed Generation for Blotato Consumption

---

## PART 1 — Blotato's actual RSS/automation capabilities

### 1.1 Does Blotato natively support RSS as a trigger/source?

**No. Verified.** Blotato has no native RSS ingestion — not in the API, and not in the web app.

The closest thing in Blotato's API is the **"source" resource** (`POST https://backend.blotato.com/v2/source-resolutions-v3`), which is a content-extraction endpoint. Its documented `sourceType` enum is:

`youtube` | `tiktok` | `article` | `pdf` | `audio` | `twitter` | `text` | `perplexity-query`

There is **no `rss` source type**. Docs: https://help.blotato.com/api/create-source

I also pulled Blotato's full LLM doc export (`https://help.blotato.com/llms-full.txt`) and searched it for "RSS", "feed", "trigger", "poll" — **zero hits** in any product/native-feature context. Blotato's own in-app content importers are: YouTube, TikTok, podcasts, audio, PDFs, articles/websites, Perplexity research, and pasted text.

**Therefore: RSS → Blotato requires an external orchestrator.** The canonical path is:

```
Your blog RSS feed
  → n8n "RSS Feed Trigger" node (polling)
  → [optional: AI transform / image gen]
  → Blotato node "Publish Post"
  → social platforms
```

This is not my inference — it is **Blotato's own documented pattern**. Their official automation template #8 (https://help.blotato.com/api/templates/8-repurpose-tiktoks-on-autopilot) literally says:

> "RSS Feed triggers when you post a new Tiktok video"
> "Make sure your RSS feed is configured to output only 1 item at a time"
> "if you post multiple Tiktok videos within an hour interval, you can set your refresh interval to 15 minutes in RSS.app but this requires a paid plan"

Note that even in their own template they use **RSS.app as an external feed generator** and n8n's RSS Feed Trigger as the poller. Blotato is strictly the *publishing sink*.

### 1.2 Polling frequency

Blotato itself defines **no polling frequency** because it never polls. Frequency is entirely a property of your orchestrator:

**n8n RSS Feed Trigger** (https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.rssfeedreadtrigger) — "Poll Times" parameter with modes:
- Every Hour (specify minute 0–59)
- Every Day (hour + minute)
- Every Week (hour + minute + weekday)
- Every Month (hour + minute + day-of-month)
- **Every X** — custom interval in minutes or hours ← this is the one you want
- **Custom** — full cron expression (seconds, minutes, hours, DOM, months, DOW)

**Critical implementation detail — how n8n decides an item is "new":** I read the node source at `packages/nodes-base/nodes/RssFeedRead/RssFeedReadTrigger.node.ts`. It uses the `rss-parser` library and compares **`item.isoDate`** against a stored `lastItemDate` in workflow static data:

```js
if (item.isoDate && Date.parse(item.isoDate) > dateToCheck)
```
and then:
```js
pollData.lastItemDate = feed.items.reduce((a, b) =>
  new Date(a.isoDate!) > new Date(b.isoDate!) ? a : b,
).isoDate;
```

**SEO/engineering consequence:** every `<item>` **must** carry a valid, parseable, monotonically-increasing `<pubDate>`. `rss-parser` maps `pubDate` (RSS) and `published`/`updated` (Atom) into `isoDate`. **If your generator omits `pubDate`, or emits a date in a non-RFC-822 format that `rss-parser` can't parse, the n8n trigger will either fire on everything every poll (duplicate spam) or never fire at all.** This is the single highest-risk failure mode in the whole pipeline.

Second consequence: if you backdate a post or republish with an older date, it will be silently skipped. Third: two posts published in the same second may collide — n8n's Outlook trigger has a documented same-minute collision bug of this shape, so the pattern is real.

**Zapier**: has an "RSS by Zapier" trigger (https://help.zapier.com/hc/en-us/articles/8496279482125), polling 1–15 min depending on plan tier. But **Blotato has no listed Zapier app** — I could not find one in Zapier's directory. *(Unverified whether one exists unlisted.)* You'd need Zapier Webhooks → Blotato REST API manually.

**Make.com**: Blotato integration at https://www.make.com/en/integrations/blotato lists **9 modules, all actions, zero triggers**: Create a Post, Create a Source, Create a Visual, Delete a Visual, Get a Post, Get a Source, Get a Visual, Make an API Call, Upload a Media. So on Make you'd pair Make's own RSS "Watch RSS feed items" trigger with Blotato action modules. *(Make's minimum scheduling interval is plan-dependent — I did not verify the current figure.)*

**n8n Cloud minimum poll interval: unverified.** Community threads suggest 1 minute is the practical floor for polling triggers, but I found no authoritative n8n doc stating a cloud-wide minimum. Assume 5–15 min is safe and polite regardless.

### 1.3 Stated feed requirements

**Blotato states none** — it never reads feeds. The requirements are inherited from `rss-parser` (n8n's parser) and from practical experience. Explicitly marking this: **Blotato publishes no RSS spec requirements. Anything below is derived, not quoted from Blotato.**

What actually matters for the n8n path:

| Requirement | Why |
|---|---|
| **RSS 2.0 or Atom 1.0** both fine | `rss-parser` handles both; it normalizes to `isoDate`, `title`, `link`, `content`, `contentSnippet`, `guid` |
| **`<pubDate>` in RFC-822 on every item** | Load-bearing for new-item detection (see 1.2) |
| **Stable `<guid>`** | Not used by n8n's trigger, but essential if you add your own dedupe (recommended) |
| **Full content in `<content:encoded>`** | Gives the AI-rewrite step real material. `contentSnippet` from a 160-char `<description>` produces thin social copy |
| **Absolute URLs everywhere** | Blotato's `mediaUrls` requires *publicly accessible URLs* — relative `/images/x.jpg` will fail |
| **Image discoverable** | Blotato takes image URLs in `mediaUrls`; you need to get one out of the feed. Use `<enclosure>` or `<media:content>` rather than making n8n regex an `<img>` out of the HTML |
| **Limit items to ~10–20** | Blotato's own docs recommend `1` item for a hot-path trigger. On first run n8n has no `lastItemDate`, so a 50-item feed risks a mass fire-off |

The Blotato doc quote — *"Make sure your RSS feed is configured to output only 1 item at a time"* — is worth taking seriously if the feed drives immediate publishing. If you want a fuller feed for humans, generate **two feeds**: `/rss.xml` (20 items, full content, for readers) and `/rss-latest.xml` (1–3 items, for the automation trigger).

### 1.4 Blotato pricing and whether API is gated

From https://www.blotato.com/pricing:

| Plan | Monthly | Social accounts | AI credits/mo |
|---|---|---|---|
| Starter | **$29** | 20 | 1,250 |
| Creator | **$97** (marked "MOST POPULAR") | 40 | 5,000 |
| Agency | **$499** | not stated | 28,000 |

Annual plans "save ~17%" plus bonus credits (exact annual prices not published on that page).

**API gating — verified from https://help.blotato.com/settings/billing-and-credits:**

> "During your free trial, you can access ALL blotato features except the API - this is to prevent spam/abuse."
> "All paid plans (Starter, Creator, Agency) include full API access."
> "The free trial is the only state where API is restricted."

**So: API/automation is NOT tier-gated among paid plans. $29/mo Starter is enough for the full RSS→n8n→Blotato pipeline.** This is unusually generous — most competitors gate API to top tiers. Budget accordingly; the cost driver will be n8n (self-host free, or n8n Cloud ~$24+/mo) and any AI-rewrite tokens, not Blotato tiering.

### 1.5 API docs URL and how publish works

**Docs root:** https://help.blotato.com/api/ · Quickstart: https://help.blotato.com/api/start
**LLM-friendly full export:** https://help.blotato.com/llms-full.txt (genuinely useful — their docs site serves `.md` variants of every page and supports `?ask=` queries)
**API dashboard/debugger:** https://my.blotato.com/api-dashboard

**Base URLs:**
- REST: `https://backend.blotato.com/v2` (for n8n, Make, direct HTTP)
- MCP server: `https://mcp.blotato.com/mcp` (for Claude, Cursor)

**Auth header:** `blotato-api-key: YOUR_API_KEY`
Gotcha from their docs: *"API keys may end with `=` characters (base64 padding)—these are part of the key and should be preserved."*

**Step 1 — get account IDs (required before you can post):**
```
GET https://backend.blotato.com/v2/users/me/accounts
blotato-api-key: YOUR_API_KEY
```

**Step 2 — publish:**
```http
POST https://backend.blotato.com/v2/posts
Content-Type: application/json
blotato-api-key: YOUR_API_KEY

{
  "post": {
    "accountId": "98432",
    "content": {
      "text": "Hello, world!",
      "mediaUrls": [],
      "platform": "twitter"
    },
    "target": {
      "targetType": "twitter"
    }
  }
}
```

**Scheduling** — `scheduledTime` and `useNextFreeSlot` go at the **root level, alongside `post`, never nested inside it**:
```json
{
  "post": { "...same as above..." },
  "scheduledTime": "2025-03-10T15:30:00Z"
}
```
Documented precedence: *"If `scheduledTime` is set: the post is scheduled for that time. `useNextFreeSlot` is ignored. If `useNextFreeSlot` is `true` (and no `scheduledTime`): the post is scheduled at the next available calendar slot for that platform. If neither...is provided: the post publishes immediately."*

**Async model:** all create operations are async. You get a `201` with an ID (`postSubmissionId` for posts), then poll the GET endpoint every 2–5s while `status` is `processing`. Terminal states for posts: `published` or `failed`.

**Media:** *"You can pass any publicly accessible URL directly - no upload step required. Blotato handles the media transfer automatically."* There's also a presigned upload endpoint for local files.

**Rate limit:** *"Post creation has a user-level rate limit of 30 requests / minute."*

**Supported targets:** `twitter | linkedin | facebook | instagram | pinterest | tiktok | threads | bluesky | youtube | webhook | other`

**Per-platform required fields** (from https://help.blotato.com/api/publish-post) — this is where integrations break:

| Platform | Required | Notable optional |
|---|---|---|
| Twitter | — | — |
| LinkedIn | — | `pageId` |
| Facebook | `pageId` | `mediaType`, `link`, `firstComment` |
| Instagram | — | `mediaType`, `altText`, `collaborators`, `firstComment` |
| **TikTok** | `privacyLevel`, `disabledComments`, `disabledDuet`, `disabledStitch`, `isBrandedContent`, `isYourBrand`, `isAiGenerated` (all six+ mandatory) | `title`, `isDraft` |
| Pinterest | `boardId` | `title`, `altText`, `link` |
| Threads | — | `replyControl` |
| Bluesky | — | — |
| YouTube | `title`, `privacyStatus`, `shouldNotifySubscribers` | `playlistIds`, `thumbnailUrl` |

Threaded posts use an `additionalPosts` array — **Twitter, Bluesky, and Threads only**.

### 1.6 n8n official Blotato node

**Yes, it exists and it is verified.** https://n8n.io/integrations/blotato/ states verbatim:

> "Blotato integration is built and maintained by our partners at Blotato and verified by n8n."

Repo: `Blotato-Inc/n8n-nodes-blotato`. It is a **verified community node**, not an n8n-core node.

**Resources/operations:**
- **Post** — publish to social platforms; get post status by `postSubmissionId`
- **Media** — upload images/videos
- **Visual** — create visuals (videos, carousels, infographics) from templates; get by ID; delete by ID
- **Source** — submit sources for content extraction; retrieve by source ID

**Install:**
- n8n Cloud: Admin Panel → Settings → enable **Verified Community Nodes** → search "Blotato" → install
- Self-hosted: set env `N8N_ENABLE_COMMUNITY_NODES=true`, restart, then Settings → Community Nodes → install

**Credentials:** n8n → new Credential → Blotato Settings → API → Copy API Key → paste → save/test → select on each Blotato node. Then open each Publish node and pick the social account.

**Confirmed again:** the n8n integration page lists **no RSS trigger from Blotato**. It does surface community workflow templates like *"Create AI-generated social media posts from RSS feeds with GPT-5"* — where RSS is an **upstream** source feeding Blotato downstream. That is the architecture.

**Known n8n+Blotato gotchas from their FAQ** (https://help.blotato.com/api/n8n/faqs):
- Binary Data upload limit is **15MB**; use presigned uploads or cloud storage URLs for larger
- Source flow is: Create Source → **Wait 5–10 seconds** → Get Source → Use Content
- *"My n8n workflow keeps generating the same content every run"* → unpin data from AI/Create Visual nodes

---

## PART 2 — How each platform emits RSS

### 2.1 Astro — `@astrojs/rss`

Docs: https://docs.astro.build/en/recipes/rss/ · Package reference: `packages/astro-rss/README.md` in withastro/astro

```bash
npm install @astrojs/rss
```
Prerequisite: `site` must be set in `astro.config.mjs`, otherwise absolute URLs can't be built.

**Full-content feed, current Astro 5 / Content Layer API** — `src/pages/rss.xml.js`:

```js
import rss from '@astrojs/rss';
import { getCollection } from 'astro:content';
import sanitizeHtml from 'sanitize-html';
import MarkdownIt from 'markdown-it';

const parser = new MarkdownIt();

export async function GET(context) {
  const blog = await getCollection('blog');
  return rss({
    title: 'Buzz's Blog',
    description: 'A humble Astronaut's guide to the stars',
    site: context.site,
    items: blog.map((post) => ({
      link: `/blog/${post.id}/`,
      content: sanitizeHtml(parser.render(post.body), {
        allowedTags: sanitizeHtml.defaults.allowedTags.concat(['img'])
      }),
      ...post.data,
    })),
  });
}
```

`npm install sanitize-html markdown-it` as well. **Note the `.concat(['img'])`** — `sanitize-html` strips `<img>` by default, which would silently kill every image in your feed. That matters directly for Blotato, since you need an image URL to populate `mediaUrls`.

**⚠️ Astro 5 Content Layer API changes — this breaks older RSS snippets.** From https://docs.astro.build/en/guides/upgrade-to/v5/:

| Astro 4 (legacy) | Astro 5 (Content Layer) |
|---|---|
| `post.slug` | **`post.id`** — *"Content layer collections do not have a reserved `slug` field."* |
| `await post.render()` | `import { render } from 'astro:content'; await render(post)` |
| `src/content/config.ts` | **`src/content.config.ts`** |
| `defineCollection({ type: 'content', schema })` | `defineCollection({ loader: glob({...}), schema })` — `type` removed |

New collection definition:
```js
import { glob } from 'astro/loaders';
const blog = defineCollection({
  loader: glob({ pattern: '**/[^_]*.{md,mdx}', base: "./src/data/blog" }),
  schema: z.object({ /* ... */ }),
});
```

Entries are now *"serializable plain objects"* — so the copy-pasted `post.render()` in most blog tutorials will throw on Astro 5. Note also that the docs' full-content example uses `post.body` (raw markdown) with `markdown-it`, **not** Astro's own renderer — meaning MDX components and Astro-specific markdown plugins won't render. For MDX you need the `render()` route instead.

**Enforce RSS-required frontmatter with the built-in schema:**
```ts
import { defineCollection } from 'astro:content';
import { rssSchema } from '@astrojs/rss';

const blog = defineCollection({ schema: rssSchema });
export const collections = { blog };
```

**Glob-import variant** (no Content Collections; `pagesGlobToRssItems` added in `@astrojs/rss@2.1.0`; Markdown only, **not MDX**):
```js
import rss from '@astrojs/rss';
import sanitizeHtml from 'sanitize-html';

export async function GET(context) {
  const postImportResult = import.meta.glob('../posts/**/*.md', { eager: true });
  const posts = Object.values(postImportResult);
  return rss({
    title: 'Buzz's Blog',
    description: 'A humble Astronaut's guide to the stars',
    site: context.site,
    items: await Promise.all(posts.map(async (post) => ({
      link: post.url,
      content: sanitizeHtml((await post.compiledContent())),
      ...post.frontmatter,
    }))),
  });
}
```

**Full API surface** (from the package README):

`rss()` options — `title: string` (req), `description: string` (req), `site: string` (req), `items: RSSFeedItem[]` (req), `stylesheet: string`, `customData: string`, `xmlns: Record<string,string>`, `trailingSlash: boolean`

`RSSFeedItem` fields — `title`, `link`, `pubDate: Date`, `description`, **`content`**, `categories: string[]`, `author`, `commentsUrl`, `source: {title, url}`, **`enclosure: { url: string, type: string, length: number }`** (either `title` or `description` is required)

**For Blotato specifically: use `enclosure`** to expose the hero image as a first-class field rather than making n8n regex it out of HTML:
```js
enclosure: {
  url: new URL(post.data.heroImage, context.site).href,
  type: 'image/jpeg',
  length: 0,
}
```
*(`length` is supposed to be bytes; many generators emit `0`. Unverified whether `@astrojs/rss` validates it.)*

**Auto-discovery** — add to `<head>`:
```html
<link rel="alternate" type="application/rss+xml" title="Your Site's Title" href={new URL("rss.xml", Astro.site)} />
```

Other options: `trailingSlash: false` to strip trailing slashes from links; `stylesheet: '/rss/styles.xsl'` for browser-rendered feeds; `customData: '<language>en-us</language>'`.

### 2.2 Eleventy / 11ty — `@11ty/eleventy-plugin-rss`

Docs: https://www.11ty.dev/docs/plugins/rss/

```bash
npm install @11ty/eleventy-plugin-rss
```

**Version matrix — this is the main upgrade trap:**
- **v3.0.0+** → **ESM**, requires **Eleventy v3+** and **Node 20.19+** for CJS configs using dynamic `import()`
- **v2** → requires Eleventy v3.0+
- **v1** → Eleventy 0.11+

**Two approaches now exist: "Virtual templates" (config-driven, new, recommended) and "Manual templates" (you write the XML).**

**Virtual template — `eleventy.config.js` (ESM):**
```js
import { feedPlugin } from "@11ty/eleventy-plugin-rss";

export default function (eleventyConfig) {
	eleventyConfig.addPlugin(feedPlugin, {
		type: "atom", // or "rss", "json"
		outputPath: "/feed.xml",
		collection: {
			name: "posts",
			limit: 10,
		},
		metadata: {
			language: "en",
			title: "Blog Title",
			subtitle: "Description",
			base: "https://example.com/",
			author: { name: "Your Name", email: "" }
		}
	});
};
```

**Full `feedPlugin` option list:**

| Option | Notes |
|---|---|
| `type` | required — `"atom"` \| `"rss"` \| `"json"` |
| `outputPath` | required, default `/feed.xml` — *"Where to write the template in the output directory"* |
| `inputPath` | *"Change where the virtual template pretends to live on the file system"* |
| `collection.name` | which collection to iterate |
| `collection.limit` | number of entries; **`0` = no limit** |
| `metadata.language` / `.title` / `.subtitle` / `.base` / `.author.name` / `.author.email` | feed-level metadata; `base` is the domain |
| `stylesheet` | *"URL to an XSL stylesheet to change how the feed is rendered in the browser"* |
| `templateData` | defaults to `{}` — extra data for the template |

For Blotato, **use `type: "rss"`** rather than the default `"atom"` — both parse fine in `rss-parser`, but RSS 2.0 has the widest compatibility across RSS.app/Zapier/Make if you ever swap orchestrators.

**Full content:** the plugin emits full post HTML. Docs state *"Existing project Transforms are applied to feed entries."* In a manual template that's:
```njk
{{ post.content | renderTransforms(post.data.page, metadata.base) }}
```
`renderTransforms` applies your project transforms **and** rewrites relative URLs to absolute — which is exactly what you need, since Blotato requires publicly accessible absolute URLs.

**CommonJS / manual template registration:**
```js
const pluginRss = require("@11ty/eleventy-plugin-rss");

module.exports = function (eleventyConfig) {
	eleventyConfig.addPlugin(pluginRss);
};
```
Manual template front matter needs `permalink: "feed.xml"` and `eleventyExcludeFromCollections: true` (otherwise the feed lists itself).

**Filters:**

| Filter | Purpose |
|---|---|
| `dateToRfc3339` | Atom `<updated>` |
| **`dateToRfc822`** | **RSS `<pubDate>`** — added in RSS 1.2.0. This is the one that keeps n8n's `isoDate` detection working |
| `getNewestCollectionItemDate` | most-recently-updated content (RSS 1.1.0) |
| `renderTransforms` | apply project transforms to feed content |
| `htmlBaseUrl` | convert URLs to absolute |

**Deprecated (v1 only):** `absoluteUrl` (perf concerns — use `renderTransforms`), `htmlToAbsoluteUrls` (async; superseded).
**Removed in v2.0.0:** `rssLastUpdatedDate`, `rssDate`. If you inherit an old 11ty site, these are the two that will hard-fail your build on upgrade.

### 2.3 Hugo — built-in RSS output format

Docs: https://gohugo.io/templates/rss/ (page last updated 2026-06-18, reflects Hugo v0.164.0)

**Deprecation status — correcting a common claim:** the embedded RSS template is **NOT deprecated**. The docs contain no deprecation or removal notice; it's presented as an active feature. What *did* change is the **template lookup path**, in **Hugo v0.146.0**, when Hugo overhauled its template system.

I verified this empirically: `tpl/tplimpl/embedded/templates/_default/rss.xml` returns **404**, while `tpl/tplimpl/embedded/templates/rss.xml` returns the live template. So: **the embedded template moved out of `_default/`. Overrides now go directly in `layouts/`, not `layouts/_default/`.** Any tutorial telling you to create `layouts/_default/rss.xml` is pre-0.146 and will silently do nothing on a modern Hugo.

**Enabling RSS** (on by default):
```yaml
outputs:
  home:
    - html
    - rss
```
Disable entirely: `disableKinds: ['rss']`
Limit items: `services.rss.limit` (docs state default is unlimited; historically it was 15 — set it explicitly)

**Override by creating any of these in `layouts/`:** `home.rss.xml`, `section.rss.xml`, `taxonomy.rss.xml`, `term.rss.xml`. Docs: *"Override Hugo's embedded RSS template by creating one or more of your own."*

**The embedded template, verbatim** (from `github.com/gohugoio/hugo/blob/master/tpl/tplimpl/embedded/templates/rss.xml`) — abridged to the item loop, which is what you'll edit:

```go-html-template
{{- $limit := .Site.Config.Services.RSS.Limit }}
{{- if ge $limit 1 }}
	{{- $pages = $pages | first $limit }}
{{- end }}
{{- printf "<?xml version=\"1.0\" encoding=\"utf-8\" standalone=\"yes\"?>" | safeHTML }}
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
	<channel>
		<title>{{ if eq .Title .Site.Title }}{{ .Site.Title }}{{ else }}{{ with .Title }}{{ . }} on {{ end }}{{ .Site.Title }}{{ end }}</title>
		<link>{{ .Permalink }}</link>
		<description>Recent content {{ if ne .Title .Site.Title }}{{ with .Title }}in {{ . }} {{ end }}{{ end }}on {{ .Site.Title }}</description>
		<generator>Hugo</generator>
		<language>{{ site.Language.Locale }}</language>
		{{ if not .Date.IsZero }}
			<lastBuildDate>{{ (index $pages.ByLastmod.Reverse 0).Lastmod.Format "Mon, 02 Jan 2006 15:04:05 -0700" | safeHTML }}</lastBuildDate>
		{{ end }}
		{{- with .OutputFormats.Get "RSS" }}
			{{ printf "<atom:link href=%q rel=\"self\" type=%q />" .Permalink .MediaType | safeHTML }}
		{{- end }}
		{{- range $pages }}
			<item>
				<title>{{ .Title }}</title>
				<link>{{ .Permalink }}</link>
				<pubDate>{{ .PublishDate.Format "Mon, 02 Jan 2006 15:04:05 -0700" | safeHTML }}</pubDate>
				<guid>{{ .Permalink }}</guid>
				<description>{{ .Summary | transform.XMLEscape | safeHTML }}</description>
			</item>
		{{- end }}
	</channel>
</rss>
```

**Full content instead of summary — the one-line change.** In your `layouts/rss.xml` (or `layouts/home.rss.xml`), replace:

```go-html-template
<description>{{ .Summary | transform.XMLEscape | safeHTML }}</description>
```
with:
```go-html-template
<description>{{ .Content | transform.XMLEscape | safeHTML }}</description>
```

Requires **Hugo ≥ v0.146.0 both locally AND in your build CI** — `transform.XMLEscape` and the new lookup path are version-sensitive, and a CI running an older Hugo will produce a different (or broken) feed than your laptop. This is a very common "works locally, wrong in prod" bug.

Better still for Blotato, add a proper full-content element and an image enclosure:
```go-html-template
<content:encoded>{{ .Content | transform.XMLEscape | safeHTML }}</content:encoded>
{{ with .Params.featured_image }}<enclosure url="{{ . | absURL }}" type="image/jpeg" length="0" />{{ end }}
```
…and declare the namespace on the root element: `xmlns:content="http://purl.org/rss/1.0/modules/content/"`.

Note the embedded template's `<pubDate>` uses `.PublishDate` while `<lastBuildDate>` uses `.Lastmod` — if you edit old posts, `Lastmod` moves but `PublishDate` doesn't, so n8n correctly won't re-fire. That's the desired behavior; don't "fix" it by switching `pubDate` to `Lastmod` or every edit will republish to social.

### 2.4 WordPress — built-in `/feed/` endpoints

Docs: https://developer.wordpress.org/advanced-administration/wordpress/feeds/ (the old `wordpress.org/documentation/article/wordpress-feeds/` now 301s here)

**Feed URLs — pretty permalinks and query-string equivalents:**

| Feed | Pretty permalink | Query string |
|---|---|---|
| Default (RSS2) | `/feed/` | `/?feed=rss2` |
| RSS 2.0 explicit | `/feed/rss2/` | `/?feed=rss2` |
| RSS 0.92 | `/feed/rss/` | `/?feed=rss` |
| Atom | `/feed/atom/` | `/?feed=atom` |
| RDF / RSS 1.0 | `/feed/rdf/` | `/?feed=rdf` |
| Comments | `/comments/feed/` | `/?feed=comments-rss2` |
| Category | `/category/{slug}/feed/` | `/?cat=123&feed=rss2` |
| Tag | `/tag/{slug}/feed/` | `/?tag=slug&feed=rss2` |
| Author | `/author/{name}/feed/` | `/?author=123&feed=rss2` |
| Search | — | `/?s=searchterm&feed=rss2` |
| Exclude a category | — | `/?cat=-123&feed=rss2` |

Also valid: `example.org/index.php?feed=rss2`.

Template tags for emitting these in a theme: `bloginfo('rss2_url')`, `bloginfo('atom_url')`, `bloginfo('rdf_url')`, `bloginfo('rss_url')`, `bloginfo('comments_rss2_url')`, `post_comments_feed_link('RSS 2.0')`. Programmatic: `get_category_feed_link()`.

**Category feeds are the single most useful WordPress feature for Blotato** — point one n8n workflow at `/category/announcements/feed/` and another at `/category/tutorials/feed/`, and you get different social copy/cadence per content type without any conditional logic in the workflow.

**Item count and full-text settings** — Settings → Reading (https://wordpress.org/documentation/article/settings-reading-screen/), verbatim:

> **Syndication feeds show the most recent**
> **[X] posts** – "Enter the number of posts people will see when they download one of your site's feeds."
>
> **For each article in a feed, show**
> **Full text** – "Click this radio button to include the full content of each post."
> **Excerpt** – "Click this radio button to include an excerpt of the post. This could save bandwidth."

Default is 10 posts. Underlying options: `posts_per_rss` and `rss_use_excerpt` (`0` = full text, `1` = excerpt).

**Set this to Full text.** With "Excerpt", WordPress emits only `<description>` with a truncated `<!--more-->`/55-word excerpt and **no `<content:encoded>`**, leaving your AI-rewrite step nothing to work with.

**Featured images in the feed — WordPress does NOT include them by default.** This is the #1 WordPress→Blotato gap: `mediaUrls` will be empty and every post publishes as text-only. Options:

*Plugins* (all from wordpress.org/plugins):
- **Featured Images in RSS for Mailchimp & More** — 20,000+ installs, tested to WP 6.8.6
- **Add Featured Image to RSS Feed** — 2,000+ installs, tested to WP 7.0.2 — *"Adds the featured image attached to posts to the beginning of the post content and excerpt in RSS feeds"*
- **RSS Chimp** — 400+ installs, tested to WP 7.0.2 — targets Mailchimp, Google News, Feedly

*(Unverified: whether any of these emit `<media:content>`/`<enclosure>` versus just prepending an `<img>` to the description. For Blotato, prepended `<img>` is workable — n8n can regex `src` out — but a real `<enclosure>` is cleaner.)*

*functions.php snippet* (no plugin, prepends the image to both content and excerpt feeds):
```php
function add_featured_image_to_feed( $content ) {
    global $post;
    if ( has_post_thumbnail( $post->ID ) ) {
        $img = get_the_post_thumbnail( $post->ID, 'large' );
        $content = '<p>' . $img . '</p>' . $content;
    }
    return $content;
}
add_filter( 'the_excerpt_rss',  'add_featured_image_to_feed' );
add_filter( 'the_content_feed', 'add_featured_image_to_feed' );
```

The two filters to know are **`the_content_feed`** (full-text mode) and **`the_excerpt_rss`** (excerpt mode) — hook both, since the Reading setting can change under you. Reference: https://developer.wordpress.org/advanced-administration/wordpress/customize-feeds/ *(note: that exact URL 404'd for me; the Codex equivalent at https://codex.wordpress.org/Customizing_Feeds is the surviving version — treat the developer.wordpress.org path as unverified.)*

To emit a true `<enclosure>` instead, hook `rss2_item` and print an `<enclosure url=... type=... length=... />` from the thumbnail — *(snippet not quoted from official docs; unverified.)*

---

## PART 3 — Feed validation

**W3C Feed Validation Service — https://validator.w3.org/feed/ — CONFIRMED LIVE as of August 2026.**

I didn't just load the homepage; I ran an actual validation against a real feed:
```
https://validator.w3.org/feed/check.cgi?url=<URL-ENCODED-FEED-URL>
```
It returned a real verdict — *"This is a valid Atom 1.0 feed"* — plus substantive interoperability warnings (dangerous `style` attributes, non-HTML `svg` tags, `iframe` security risk, invalid HTML nesting). **So it is genuinely operational, not a zombie page.** No deprecation or shutdown notice anywhere on it. It describes itself as *"a free service that checks the syntax of Atom or RSS feeds"* and points to the Feed Validator software on GitHub for issue reports.

That `check.cgi?url=` pattern is scriptable — worth wiring into CI as a post-deploy smoke test on the feed.

**Alternatives:**

| Validator | URL | Best for |
|---|---|---|
| **RSS Board Validator** | https://www.rssboard.org/rss-validator/ | RSS 2.0 (also Atom + RSS 1.0). Same lineage/codebase as the W3C one — good as a second opinion, not a truly independent check |
| **RSS.app Feed Validator** | https://rss.app/ | RSS + Atom, simple UI. Relevant since Blotato's own docs use RSS.app |
| **Cast Feed Validator** | https://www.castfeedvalidator.com/ | Podcast-specific; validates images and media files. Overkill for a blog feed |
| **PodBase** | — | Podcast feeds; formatting, SEO, URL conflicts, iTunes compat |
| **Livewire Podcast Validator** | — | Podcasting 2.0 tags |

**But note what none of these check:** validity ≠ Blotato-readiness. A feed can be perfectly valid RSS 2.0 and still break the pipeline — missing `pubDate`, relative image URLs, empty `content:encoded`. **The real validation is an end-to-end test:** point the n8n RSS Feed Trigger at your feed, hit "Fetch Test Event", and inspect that the output JSON has a parsed `isoDate`, a non-empty `content`, and an absolute image URL. Do that before you connect the Blotato node.

---

## Recommended architecture summary

```
Blog (Astro / 11ty / Hugo / WP)
  ├─ /rss.xml          → 15–20 items, full content, for humans + search
  └─ /rss-latest.xml   → 1–3 items, full content, absolute URLs, enclosure image
                              ↓
                   n8n RSS Feed Trigger  (Every X = 15 min)
                              ↓  (dedupe on guid — belt & braces)
                   [AI rewrite → per-platform copy]
                              ↓
                   Blotato Publish node ×N  (POST /v2/posts)
                              ↓
                   Twitter · LinkedIn · Facebook · Instagram · Threads · Bluesky …
```

**Non-negotiables for the feed:**
1. Valid RFC-822 `<pubDate>` on every item — n8n's entire new-item detection hinges on it
2. Full HTML in `<content:encoded>` (or Astro's `content` field) — not a 160-char excerpt
3. Absolute URLs for every link and image — Blotato requires publicly accessible URLs
4. An image exposed as `<enclosure>` or `<media:content>` — otherwise everything posts as text-only
5. Low item count on the trigger feed — first poll has no `lastItemDate` and can fire on everything

**Cost:** Blotato Starter $29/mo is sufficient — API is not gated above the free trial. Self-hosted n8n is free.

**Biggest risks, ranked:** (1) missing/unparseable `pubDate` causing duplicate-posting or silent no-fire; (2) WordPress featured images absent from the feed; (3) Hugo template-path change at v0.146.0 making overrides silently no-op; (4) Astro 5 `slug`→`id` / `render()` migration breaking copy-pasted recipes; (5) 11ty v2/v3 removed filters (`rssDate`, `rssLastUpdatedDate`) hard-failing builds on upgrade.

---

### Explicitly unverified
- Whether a Zapier Blotato app exists (none found in Zapier's directory)
- Make.com's current minimum scheduling interval
- n8n Cloud's platform-wide minimum polling interval (community suggests 1 min; no official doc found)
- Whether the WordPress featured-image plugins emit `<enclosure>`/`<media:content>` vs. a prepended `<img>`
- `https://developer.wordpress.org/advanced-administration/wordpress/customize-feeds/` 404'd; Codex version used instead
- Blotato annual pricing exact figures (only "~17% savings" stated)
- Whether `@astrojs/rss` validates the `enclosure.length` byte value

## Sources

- [Blotato Help — API Quickstart](https://help.blotato.com/api/start)
- [Blotato Help — Publish Post](https://help.blotato.com/api/publish-post)
- [Blotato Help — Create Source](https://help.blotato.com/api/create-source)
- [Blotato Help — n8n Blotato Node](https://help.blotato.com/api/n8n/n8n-blotato-node)
- [Blotato Help — n8n FAQs](https://help.blotato.com/api/n8n/faqs)
- [Blotato Help — Template 8: Repurpose TikToks on Autopilot](https://help.blotato.com/api/templates/8-repurpose-tiktoks-on-autopilot)
- [Blotato Help — Billing and Credits](https://help.blotato.com/settings/billing-and-credits)
- [Blotato Pricing](https://www.blotato.com/pricing)
- [n8n — Blotato Integration](https://n8n.io/integrations/blotato/)
- [n8n Docs — RSS Feed Trigger](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.rssfeedreadtrigger)
- [Make — Blotato Integration](https://www.make.com/en/integrations/blotato)
- [Zapier Help — Trigger Zaps from new RSS feed items](https://help.zapier.com/hc/en-us/articles/8496279482125-Trigger-Zap-workflows-from-new-RSS-feed-items)
- [Astro Docs — Add an RSS feed](https://docs.astro.build/en/recipes/rss/)
- [Astro Docs — Upgrade to v5](https://docs.astro.build/en/guides/upgrade-to/v5/)
- [Astro Docs — Content Collections](https://docs.astro.build/en/guides/content-collections/)
- [11ty Docs — RSS Plugin](https://www.11ty.dev/docs/plugins/rss/)
- [Hugo Docs — RSS Templates](https://gohugo.io/templates/rss/)
- [Hugo — embedded rss.xml source](https://github.com/gohugoio/hugo/blob/master/tpl/tplimpl/embedded/templates/rss.xml)
- [WordPress — Feeds (Advanced Administration)](https://developer.wordpress.org/advanced-administration/wordpress/feeds/)
- [WordPress — Settings Reading Screen](https://wordpress.org/documentation/article/settings-reading-screen/)
- [WordPress Codex — Customizing Feeds](https://codex.wordpress.org/Customizing_Feeds)
- [WordPress — get_category_feed_link()](https://developer.wordpress.org/reference/functions/get_category_feed_link/)
- [W3C Feed Validation Service](https://validator.w3.org/feed/)
- [RSS Board Validator](https://www.rssboard.org/rss-validator/)
- [Cast Feed Validator](https://www.castfeedvalidator.com/)