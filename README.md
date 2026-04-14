# Url-Shorten-Worker

A lightweight URL shortener running on Cloudflare Workers + KV.

## Features

- **Zero-server**: Runs entirely on Cloudflare's edge network, no backend needed
- **ES Modules**: Modern Cloudflare Workers format (no legacy Service Worker API)
- **Self-contained**: Homepage HTML is inline, no external dependencies
- **Unique links**: Same long URL always maps to the same short URL (configurable)
- **CAPTCHA protection**: Optional [CAP Worker](https://captcha.gurl.eu.org) integration for bot prevention
- **Google Safe Browsing**: Optional URL safety check before redirect
- **TTL support**: Configurable link expiration time
- **Referrer hiding**: Optional anonymous redirect (no HTTP Referer header)
- **CORS enabled**: API can be called from any frontend

## Quick Start (Dashboard)

### Step 1: Create a KV Namespace

1. Log in to [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Go to **Workers & Pages** → **KV** in the left sidebar
3. Click **Create a namespace**
4. Name it `URL_LINKS` (or any name you like), click **Add**

![Create KV Namespace](docs/kv_create_namespace.png)

### Step 2: Create a Worker

1. Go to **Workers & Pages** → **Overview**
2. Click **Create** → **Create Worker**
3. Give it a name (e.g., `url-shorten`), click **Deploy**
4. After creation, click **Edit Code**

### Step 3: Deploy the Code

1. Delete all the default code in the editor
2. Copy the entire content of `index.js` from this repo and paste it in
3. Click **Save and Deploy**

### Step 4: Bind KV Namespace

1. Go to your Worker → **Settings** → **Bindings**
2. Click **Add** → **KV Namespace**
3. Set **Variable name** to `LINKS` (must be exactly `LINKS`)
4. Select the namespace you created in Step 1
5. Click **Save**

![Bind KV](docs/worker_kv_binding.png)

### Step 5: Test

Visit your Worker URL (e.g., `https://url-shorten.your-account.workers.dev`). You should see the URL shortener homepage.

---

## Quick Start (Wrangler CLI)

For developers who prefer command-line deployment:

### Prerequisites

```bash
# Install Wrangler
npm install -g wrangler

# Login to Cloudflare
wrangler login
```

### Deploy

```bash
# Clone the repo
git clone https://github.com/maojoey/Url-Shorten-Worker.git
cd Url-Shorten-Worker

# Create KV namespace
wrangler kv namespace create LINKS
# Copy the output id and paste it into wrangler.toml

# Edit wrangler.toml — replace YOUR_KV_NAMESPACE_ID_HERE with the actual id

# Deploy
wrangler deploy
```

---

## Custom Domain Setup

If your domain is managed by Cloudflare (e.g., `example.com`), you can use a subdomain like `s.example.com` for your short links.

### Method A: Custom Domains (Recommended)

This is the simplest method. Cloudflare handles DNS automatically.

1. Go to your Worker → **Settings** → **Triggers**
2. Under **Custom Domains**, click **Add Custom Domain**
3. Enter your domain (e.g., `s.example.com`)
4. Click **Add Custom Domain**
5. Done! Cloudflare auto-creates the DNS record

### Method B: Workers Routes + DNS

Use this if you need more control.

**Step 1 — Add DNS record:**

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| `AAAA` | `s` | `100::` | Proxied (orange cloud ON) |

> The `100::` is a placeholder IP. Cloudflare intercepts the traffic before it reaches any origin, so the IP doesn't matter — but **Proxy must be ON** (orange cloud).

**Step 2 — Add Worker Route:**

1. Go to the domain's page → **Workers Routes**
2. Click **Add Route**
3. Route: `s.example.com/*`
4. Worker: select your `url-shorten` worker
5. Click **Save**

### Using Root Domain

To use `example.com` directly (instead of a subdomain):

- Custom Domains: enter `example.com`
- Workers Routes: use `example.com/*` as the route, with an `AAAA` record on `@`

---

## Configuration

Edit the `config` object at the top of `index.js`:

```javascript
const config = {
  no_ref: "off",         // "on" = hide Referer header on redirect
  theme: "default",      // homepage theme
  cors: "on",            // allow cross-origin API calls
  unique_link: true,     // same URL → same short link
  custom_link: false,    // allow users to choose custom short codes
  safe_browsing_api_key: "",  // Google Safe Browsing API key (optional)
  expiration_ttl: 0,     // link expiration in seconds (0 = never)

  captcha: {
    enabled: false,              // set to true to enable CAPTCHA
    api_endpoint: "https://captcha.gurl.eu.org/api",
    require_on_create: true,     // require CAPTCHA for link creation
    require_on_access: false,    // require CAPTCHA for link access
    timeout: 5000,               // API timeout in ms
    fallback_on_error: true,     // allow operations when CAPTCHA service is down
    max_retries: 2,              // retry attempts
  },
};
```

### Common Configurations

**Personal use (no CAPTCHA):**
```javascript
captcha: { enabled: false }
expiration_ttl: 0  // links never expire
```

**Public service (with CAPTCHA + expiration):**
```javascript
captcha: { enabled: true, require_on_create: true, require_on_access: false }
expiration_ttl: 86400  // 24 hours
```

**High security:**
```javascript
captcha: { enabled: true, require_on_create: true, require_on_access: true, fallback_on_error: false }
safe_browsing_api_key: "your-google-api-key"
```

---

## API

### Create Short Link

**POST** `https://your-worker-domain/`

**Request:**
```json
{
  "url": "https://example.com/very/long/url",
  "captcha_token": "optional-if-captcha-enabled"
}
```

**Success Response:**
```json
{
  "status": 200,
  "key": "/aBcDeF",
  "short_url": "https://your-worker-domain/aBcDeF"
}
```

**Error Response:**
```json
{
  "status": 400,
  "error": "Invalid URL format. Must start with http:// or https:// and be under 2048 characters."
}
```

### cURL Example

```bash
curl -X POST https://s.example.com/ \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/long/url"}'
```

### Access Short Link

**GET** `https://your-worker-domain/{key}`

Returns a `302` redirect to the original URL.

For full API documentation, see [docs/API.md](docs/API.md).

---

## CAPTCHA

For detailed CAPTCHA setup and configuration, see:
- [English](docs/CAPTCHA.md)
- [中文](docs/CAPTCHA_zh-hans.md)

---

## Changelog

### v2.1.0 (2026-04)
- Migrated to ES Modules format (Cloudflare recommended)
- Inline homepage HTML — removed external GitHub Pages dependency
- Added `wrangler.toml` for CLI deployment
- Improved URL validation (using `URL` constructor, length limit)
- Cryptographically secure random key generation (`crypto.getRandomValues`)
- Better error handling with structured JSON responses
- Added security headers (`X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`)
- Full `short_url` returned in API response (not just the key)
- Top-level error catch prevents Worker crashes

### v2.0.0 (2025-11)
- Added CAPTCHA integration with CAP Worker
- Added configurable link expiration (TTL)

### v1.x
- Initial release with KV-based URL shortening

---

## Credits

Forked from [xyTom/Url-Shorten-Worker](https://github.com/xyTom/Url-Shorten-Worker).

## License

[MIT](LICENSE)
