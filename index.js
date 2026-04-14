/**
 * Url-Shorten-Worker v2.1.0
 * ES Modules format for Cloudflare Workers
 */

const config = {
  no_ref: "off",
  theme: "default", // "default" | "captcha"
  cors: "on",
  unique_link: true,
  custom_link: false,
  safe_browsing_api_key: "",
  expiration_ttl: 0, // seconds, 86400 = 24h, 0 = no expiration

  captcha: {
    enabled: false,
    api_endpoint: "https://captcha.gurl.eu.org/api",
    require_on_create: true,
    require_on_access: false,
    timeout: 5000,
    fallback_on_error: true,
    max_retries: 2,
  },
};

// ============ Response Helpers ============

function buildCorsHeaders() {
  const headers = { "content-type": "text/html;charset=UTF-8" };
  if (config.cors === "on") {
    headers["Access-Control-Allow-Origin"] = "*";
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
  }
  return headers;
}

function jsonResponse(body, status = 200) {
  const headers = {
    "content-type": "application/json;charset=UTF-8",
  };
  if (config.cors === "on") {
    headers["Access-Control-Allow-Origin"] = "*";
    headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS";
    headers["Access-Control-Allow-Headers"] = "Content-Type";
  }
  return new Response(JSON.stringify(body), { headers, status });
}

function htmlResponse(html, status = 200) {
  return new Response(html, {
    headers: {
      "content-type": "text/html;charset=UTF-8",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
    },
    status,
  });
}

// ============ Utility Functions ============

const SAFE_CHARS = "ABCDEFGHJKMNPQRSTWXYZabcdefhijkmnprstwxyz2345678";

function randomString(len = 6) {
  const array = new Uint8Array(len);
  crypto.getRandomValues(array);
  let result = "";
  for (let i = 0; i < len; i++) {
    result += SAFE_CHARS[array[i] % SAFE_CHARS.length];
  }
  return result;
}

async function sha512(url) {
  const encoded = new TextEncoder().encode(url);
  const digest = await crypto.subtle.digest("SHA-512", encoded);
  const hashArray = Array.from(new Uint8Array(digest));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

function isValidUrl(str) {
  if (typeof str !== "string" || str.length > 2048) return false;
  try {
    const url = new URL(str);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function getKvPutOptions() {
  const MIN_TTL = 60;
  const rawTtl = Number(config.expiration_ttl);
  const hasValidTtl = Number.isFinite(rawTtl) && rawTtl >= MIN_TTL;
  return hasValidTtl ? { expirationTtl: Math.floor(rawTtl) } : {};
}

// ============ KV Operations ============

async function saveUrl(LINKS, url) {
  const maxAttempts = 5;
  for (let i = 0; i < maxAttempts; i++) {
    const key = randomString();
    const existing = await LINKS.get(key);
    if (existing === null) {
      await LINKS.put(key, url, getKvPutOptions());
      return key;
    }
  }
  return null;
}

async function getExistingKey(LINKS, url) {
  const hash = await sha512(url);
  return await LINKS.get(hash);
}

async function saveUniqueUrl(LINKS, url) {
  const hash = await sha512(url);
  const existingKey = await LINKS.get(hash);
  if (existingKey) return existingKey;

  const key = await saveUrl(LINKS, url);
  if (key) {
    await LINKS.put(hash, key, getKvPutOptions());
  }
  return key;
}

// ============ Safe Browsing ============

async function isUrlSafe(url) {
  if (!config.safe_browsing_api_key) return true;

  try {
    const body = {
      client: { clientId: "Url-Shorten-Worker", clientVersion: "2.1.0" },
      threatInfo: {
        threatTypes: [
          "MALWARE",
          "SOCIAL_ENGINEERING",
          "POTENTIALLY_HARMFUL_APPLICATION",
          "UNWANTED_SOFTWARE",
        ],
        platformTypes: ["ANY_PLATFORM"],
        threatEntryTypes: ["URL"],
        threatEntries: [{ url }],
      },
    };

    const resp = await fetch(
      `https://safebrowsing.googleapis.com/v4/threatMatches:find?key=${config.safe_browsing_api_key}`,
      {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
      }
    );
    const result = await resp.json();
    return Object.keys(result).length === 0;
  } catch (err) {
    console.error("Safe Browsing check failed:", err.message);
    return true; // fail-open
  }
}

// ============ CAPTCHA ============

async function validateCaptchaToken(token, keepToken = false) {
  if (!config.captcha.enabled) return { success: true, degraded: false };

  if (!token || typeof token !== "string" || token.length < 10) {
    return { success: false, error: "Invalid token format" };
  }

  let lastError = null;
  const maxRetries = config.captcha.max_retries || 2;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        config.captcha.timeout
      );

      const resp = await fetch(`${config.captcha.api_endpoint}/validate`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Url-Shorten-Worker/2.1.0",
        },
        body: JSON.stringify({ token, keepToken }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (resp.ok) {
        const result = await resp.json();
        return { success: result.success === true, degraded: false };
      }

      if ([400, 404, 409, 410].includes(resp.status)) {
        return { success: false, error: "Invalid or expired token" };
      }

      lastError = `HTTP ${resp.status}`;
    } catch (err) {
      lastError = err.name === "AbortError" ? "Timeout" : err.message;
      console.error(
        `CAPTCHA validation attempt ${attempt + 1} failed:`,
        lastError
      );
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 100));
      }
    }
  }

  if (config.captcha.fallback_on_error) {
    console.warn(
      `CAPTCHA service degraded: ${lastError}. Allowing operation due to fallback policy.`
    );
    return { success: true, degraded: true };
  }

  return { success: false, error: lastError || "CAPTCHA service unavailable" };
}

function isCaptchaRequired(operation) {
  if (!config.captcha.enabled) return false;
  if (operation === "create") return config.captcha.require_on_create;
  if (operation === "access") return config.captcha.require_on_access;
  return false;
}

// ============ HTML Templates ============

const HTML_404 = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>404 Not Found</title>
<style>body{font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f5f5f5}
.box{text-align:center;padding:2rem;background:#fff;border-radius:8px;box-shadow:0 2px 12px rgba(0,0,0,.08)}
h1{color:#333;font-size:3rem;margin:0}p{color:#666}a{color:#4a90d9;text-decoration:none}</style>
</head><body><div class="box"><h1>404</h1><p>The short link you requested was not found.</p>
<a href="/">Go Home</a></div></body></html>`;

const HTML_HOMEPAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>URL Shortener</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:system-ui,-apple-system,sans-serif;min-height:100vh;display:flex;justify-content:center;align-items:center;
  background:linear-gradient(135deg,#667eea 0%,#764ba2 100%)}
.container{background:#fff;padding:2.5rem;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.15);width:90%;max-width:500px}
h1{font-size:1.5rem;color:#333;margin-bottom:.5rem;text-align:center}
.subtitle{color:#888;text-align:center;margin-bottom:1.5rem;font-size:.9rem}
.input-group{display:flex;gap:.5rem;margin-bottom:1rem}
input[type="url"]{flex:1;padding:.75rem 1rem;border:2px solid #e0e0e0;border-radius:8px;font-size:1rem;outline:none;transition:border-color .2s}
input[type="url"]:focus{border-color:#667eea}
button{padding:.75rem 1.5rem;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff;border:none;border-radius:8px;
  font-size:1rem;cursor:pointer;transition:opacity .2s;white-space:nowrap}
button:hover{opacity:.9}button:disabled{opacity:.5;cursor:not-allowed}
.result{margin-top:1rem;padding:1rem;background:#f0f4ff;border-radius:8px;display:none;word-break:break-all}
.result a{color:#667eea;text-decoration:none;font-weight:600;font-size:1.1rem}
.result a:hover{text-decoration:underline}
.error{background:#fff0f0;color:#d32f2f}
.captcha-box{margin-bottom:1rem;display:flex;justify-content:center}
.footer{text-align:center;margin-top:1.5rem;font-size:.8rem;color:#aaa}
.footer a{color:#667eea;text-decoration:none}
</style>
</head>
<body>
<div class="container">
  <h1>URL Shortener</h1>
  <p class="subtitle">Paste a long URL to create a short link</p>
  <div class="input-group">
    <input type="url" id="urlInput" placeholder="https://example.com/very/long/url" autocomplete="off">
    <button id="submitBtn" onclick="shorten()">Shorten</button>
  </div>
  <div id="captchaBox" class="captcha-box" style="display:none"></div>
  <div id="result" class="result"></div>
  <div class="footer">Powered by <a href="https://github.com/xyTom/Url-Shorten-Worker" target="_blank">Url-Shorten-Worker</a></div>
</div>
<script>
CAPTCHA_ENABLED_PLACEHOLDER
async function shorten(){
  const urlInput=document.getElementById("urlInput");
  const result=document.getElementById("result");
  const btn=document.getElementById("submitBtn");
  const url=urlInput.value.trim();
  if(!url){urlInput.focus();return}
  if(!/^https?:\\/\\//i.test(url)){result.className="result error";result.style.display="block";result.textContent="Please enter a valid URL starting with http:// or https://";return}
  btn.disabled=true;btn.textContent="...";
  try{
    const body={url:url};
    if(window.__captchaToken)body.captcha_token=window.__captchaToken;
    const resp=await fetch(location.origin+"/",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});
    const data=await resp.json();
    if(data.status===200){
      const short=location.origin+data.key;
      result.className="result";result.style.display="block";
      result.innerHTML='<a href="'+short+'" target="_blank">'+short+'</a>';
    }else{
      result.className="result error";result.style.display="block";
      result.textContent=data.error||"Failed to create short link";
      if(data.captcha_required)window.__captchaToken=null;
    }
  }catch(e){result.className="result error";result.style.display="block";result.textContent="Network error: "+e.message}
  finally{btn.disabled=false;btn.textContent="Shorten"}
}
document.getElementById("urlInput").addEventListener("keydown",function(e){if(e.key==="Enter")shorten()});
</script>
</body>
</html>`;

function getHomepage() {
  let html = HTML_HOMEPAGE;
  if (config.captcha.enabled && config.captcha.require_on_create) {
    const captchaScript = `
    (function(){
      var box=document.getElementById("captchaBox");box.style.display="flex";
      var s=document.createElement("script");s.src="${config.captcha.api_endpoint.replace("/api", "")}/cap.min.js";document.head.appendChild(s);
      var w=document.createElement("cap-widget");w.setAttribute("data-cap-api-endpoint","${config.captcha.api_endpoint}/");
      box.appendChild(w);
      w.addEventListener("solve",function(e){window.__captchaToken=e.detail.token;});
    })();`;
    html = html.replace(
      "CAPTCHA_ENABLED_PLACEHOLDER",
      captchaScript
    );
  } else {
    html = html.replace("CAPTCHA_ENABLED_PLACEHOLDER", "");
  }
  return html;
}

const CAPTCHA_CHALLENGE_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Verification Required</title>
<script src="${config.captcha.api_endpoint.replace("/api", "")}/cap.min.js"></script>
<style>
body{font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;
  background:linear-gradient(135deg,#667eea 0%,#764ba2 100%)}
.container{background:#fff;padding:2rem;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.15);max-width:400px;text-align:center}
h1{color:#333;font-size:1.3rem;margin-bottom:.5rem}p{color:#666;margin-bottom:1.5rem;font-size:.9rem}
#cap{margin:1.5rem 0;display:flex;justify-content:center}
.loading{display:none;color:#667eea;margin-top:1rem}
</style>
</head>
<body>
<div class="container">
  <h1>Verification Required</h1>
  <p>Please complete the verification below to continue.</p>
  <cap-widget id="cap" data-cap-api-endpoint="${config.captcha.api_endpoint}/"></cap-widget>
  <div class="loading" id="loading">Verifying and redirecting...</div>
</div>
<script>
document.querySelector("#cap").addEventListener("solve",function(e){
  document.getElementById("loading").style.display="block";
  window.location.href=window.location.pathname+"?captcha_token="+encodeURIComponent(e.detail.token);
});
</script>
</body></html>`;

const HTML_NO_REF = (url) => `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="referrer" content="no-referrer">
<meta http-equiv="refresh" content="0;url=${url}">
<script>window.location.replace("${url}")</script>
</head><body>Redirecting...</body></html>`;

const HTML_SAFE_BROWSING_WARNING = (url) => `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Security Warning</title>
<style>body{font-family:system-ui,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0;background:#fff3f0}
.box{max-width:500px;padding:2rem;text-align:center}h1{color:#d32f2f;font-size:1.5rem}
p{color:#666;line-height:1.6;margin:1rem 0}.url{word-break:break-all;background:#f5f5f5;padding:.5rem;border-radius:4px;font-size:.85rem;color:#999}
a{color:#4a90d9;text-decoration:none}</style>
</head><body><div class="box"><h1>Security Warning</h1>
<p>The URL you are about to visit has been flagged as potentially unsafe by Google Safe Browsing.</p>
<p class="url">${url}</p>
<p><a href="/">Go Back</a></p></div></body></html>`;

// ============ Request Handler ============

async function handleRequest(request, env) {
  const LINKS = env.LINKS;
  const url = new URL(request.url);

  // OPTIONS (CORS preflight)
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: buildCorsHeaders() });
  }

  // POST - Create short link
  if (request.method === "POST") {
    return handleCreate(request, LINKS, url);
  }

  // GET - Serve homepage or redirect
  if (request.method === "GET") {
    return handleGet(request, LINKS, url);
  }

  return jsonResponse({ status: 405, error: "Method not allowed" }, 405);
}

async function handleCreate(request, LINKS, requestUrl) {
  // Parse body
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(
      { status: 400, error: "Invalid JSON body" },
      400
    );
  }

  const targetUrl = body.url;

  // Validate URL
  if (!isValidUrl(targetUrl)) {
    return jsonResponse(
      {
        status: 400,
        error:
          "Invalid URL format. Must start with http:// or https:// and be under 2048 characters.",
      },
      400
    );
  }

  // CAPTCHA check
  if (isCaptchaRequired("create")) {
    const captchaToken =
      body.captcha_token || body.captchaToken || body.token;

    if (!captchaToken) {
      return jsonResponse(
        { status: 403, error: "CAPTCHA token required", captcha_required: true },
        403
      );
    }

    const validation = await validateCaptchaToken(captchaToken, false);

    if (!validation.success) {
      return jsonResponse(
        {
          status: 403,
          error: validation.error || "CAPTCHA verification failed",
          captcha_required: true,
        },
        403
      );
    }

    if (validation.degraded) {
      console.warn("Request processed under CAPTCHA service degradation");
    }
  }

  // Safe browsing check
  if (!(await isUrlSafe(targetUrl))) {
    return jsonResponse(
      { status: 403, error: "URL flagged as unsafe by Google Safe Browsing" },
      403
    );
  }

  // Create short link
  let key;
  if (config.unique_link) {
    key = await saveUniqueUrl(LINKS, targetUrl);
  } else {
    key = await saveUrl(LINKS, targetUrl);
  }

  if (!key) {
    return jsonResponse(
      { status: 500, error: "Failed to generate short link. Please retry." },
      500
    );
  }

  return jsonResponse({
    status: 200,
    key: "/" + key,
    short_url: requestUrl.origin + "/" + key,
  });
}

async function handleGet(request, LINKS, requestUrl) {
  const path = requestUrl.pathname.split("/")[1];
  const params = requestUrl.search;

  // Serve homepage
  if (!path) {
    return htmlResponse(getHomepage());
  }

  // Look up short link
  const value = await LINKS.get(path);

  if (!value) {
    return htmlResponse(HTML_404, 404);
  }

  const location = params ? value + params : value;

  // CAPTCHA check for access
  if (isCaptchaRequired("access")) {
    const captchaToken =
      requestUrl.searchParams.get("captcha_token") ||
      requestUrl.searchParams.get("token");

    if (!captchaToken) {
      return htmlResponse(CAPTCHA_CHALLENGE_PAGE, 403);
    }

    const validation = await validateCaptchaToken(captchaToken, false);

    if (!validation.success) {
      return htmlResponse(
        `<!DOCTYPE html><html><head><title>Verification Failed</title></head>
<body><h1>Verification Failed</h1><p>${validation.error || "CAPTCHA verification failed"}</p>
<a href="${requestUrl.pathname}">Try again</a></body></html>`,
        403
      );
    }

    if (validation.degraded) {
      console.warn("Access granted under CAPTCHA service degradation");
    }
  }

  // Safe browsing check
  if (!(await isUrlSafe(location))) {
    return htmlResponse(HTML_SAFE_BROWSING_WARNING(location));
  }

  // Redirect
  if (config.no_ref === "on") {
    return htmlResponse(HTML_NO_REF(location));
  }

  return Response.redirect(location, 302);
}

// ============ Export (ES Modules) ============

export default {
  async fetch(request, env, ctx) {
    try {
      return await handleRequest(request, env);
    } catch (err) {
      console.error("Unhandled error:", err.stack || err.message);
      return jsonResponse(
        { status: 500, error: "Internal server error" },
        500
      );
    }
  },
};
