# Url-Shorten-Worker

基于 Cloudflare Workers + KV 的轻量级短链接服务。

## 功能特性

- **无服务器**: 完全运行在 Cloudflare 边缘网络，无需后端服务器
- **ES Modules**: 使用 Cloudflare Workers 推荐的现代格式
- **自包含**: 首页 HTML 内联，无外部依赖
- **唯一链接**: 相同长链接生成相同短链接（可配置）
- **验证码保护**: 可选的 [CAP Worker](https://captcha.gurl.eu.org) 集成，防止机器人滥用
- **安全检测**: 可选的 Google Safe Browsing URL 安全检查
- **过期时间**: 可配置的链接过期时间（TTL）
- **隐藏来源**: 可选的匿名跳转（隐藏 HTTP Referer 头）
- **跨域支持**: API 支持跨域调用

---

## 部署方式一：Cloudflare 控制台（推荐新手）

### 第 1 步：创建 KV 命名空间

1. 登录 [Cloudflare 控制台](https://dash.cloudflare.com/)
2. 左侧菜单找到 **Workers & Pages** → **KV**
3. 点击 **Create a namespace**（创建命名空间）
4. 名称填 `URL_LINKS`（或你喜欢的名字），点击 **Add**

![创建 KV 命名空间](docs/kv_create_namespace.png)

### 第 2 步：创建 Worker

1. 进入 **Workers & Pages** → **Overview**（概览）
2. 点击 **Create**（创建）→ **Create Worker**（创建 Worker）
3. 给 Worker 取个名字（如 `url-shorten`），点击 **Deploy**（部署）
4. 部署后点击 **Edit Code**（编辑代码）

### 第 3 步：部署代码

1. 删除编辑器中所有默认代码
2. 复制本项目 `index.js` 的全部内容，粘贴进去
3. 点击 **Save and Deploy**（保存并部署）

### 第 4 步：绑定 KV 命名空间

1. 进入你的 Worker → **Settings**（设置）→ **Bindings**（绑定）
2. 点击 **Add**（添加）→ **KV Namespace**
3. **Variable name** 填 `LINKS`（必须是 `LINKS`，大小写敏感）
4. **KV namespace** 选择第 1 步创建的命名空间
5. 点击 **Save**（保存）

![绑定 KV](docs/worker_kv_binding.png)

### 第 5 步：测试

访问你的 Worker 地址（如 `https://url-shorten.你的账号.workers.dev`），应该能看到短链接服务首页。

---

## 部署方式二：Wrangler 命令行

适合习惯命令行操作的开发者。

### 前置条件

```bash
# 安装 Wrangler
npm install -g wrangler

# 登录 Cloudflare（会打开浏览器授权）
wrangler login
```

### 部署步骤

```bash
# 克隆项目
git clone https://github.com/maojoey/Url-Shorten-Worker.git
cd Url-Shorten-Worker

# 创建 KV 命名空间
wrangler kv namespace create LINKS
# 命令会输出一个 id，复制它

# 编辑 wrangler.toml，把 YOUR_KV_NAMESPACE_ID_HERE 替换为刚才的 id

# 部署
wrangler deploy
```

### 本地开发调试

```bash
# 启动本地开发服务器（默认 http://localhost:8787）
wrangler dev
```

---

## 自定义域名配置

如果你的域名托管在 Cloudflare（如 `example.com`），可以用子域名 `s.example.com` 作为短链接地址。

### 方法 A：Custom Domains（最简单，推荐）

Cloudflare 自动处理 DNS，你什么都不用额外配置。

1. 进入你的 Worker → **Settings**（设置）→ **Triggers**（触发器）
2. 在 **Custom Domains** 下点击 **Add Custom Domain**
3. 输入域名（如 `s.example.com`）
4. 点击 **Add Custom Domain**
5. 完成！Cloudflare 会自动创建 DNS 记录

### 方法 B：Workers Routes + DNS（更灵活）

**第 1 步 — 添加 DNS 记录：**

进入域名的 DNS 设置，添加一条记录：

| 类型 | 名称 | 内容 | 代理状态 |
|------|------|------|----------|
| `AAAA` | `s` | `100::` | 已代理（橙色云朵开启） |

> `100::` 是占位 IP，Cloudflare 会在流量到达源站之前拦截，所以 IP 不重要。**关键是橙色云朵必须开启**，否则 Worker 不会触发。

**第 2 步 — 添加 Worker Route：**

1. 进入域名页面 → **Workers Routes**
2. 点击 **Add Route**（添加路由）
3. Route 填：`s.example.com/*`
4. Worker 选择你的 `url-shorten`
5. 点击 **Save**

### 使用根域名

如果想直接用 `example.com`（不用子域名）：

- Custom Domains 方法：直接输入 `example.com`
- Workers Routes 方法：Route 填 `example.com/*`，DNS 中 `@` 记录设置 `AAAA` → `100::`

---

## 配置说明

编辑 `index.js` 顶部的 `config` 对象：

```javascript
const config = {
  no_ref: "off",         // "on" = 跳转时隐藏 Referer 头
  theme: "default",      // 首页主题
  cors: "on",            // 允许跨域 API 调用
  unique_link: true,     // 相同 URL 生成相同短链接
  custom_link: false,    // 是否允许用户自定义短码
  safe_browsing_api_key: "",  // Google Safe Browsing API 密钥（可选）
  expiration_ttl: 0,     // 链接过期时间，单位秒（0 = 永不过期）

  captcha: {
    enabled: false,              // true 启用验证码
    api_endpoint: "https://captcha.gurl.eu.org/api",
    require_on_create: true,     // 创建短链接时需要验证码
    require_on_access: false,    // 访问短链接时需要验证码
    timeout: 5000,               // API 超时（毫秒）
    fallback_on_error: true,     // 验证码服务故障时允许操作
    max_retries: 2,              // 重试次数
  },
};
```

### 常见配置方案

**个人使用（无验证码）：**
```javascript
captcha: { enabled: false }
expiration_ttl: 0  // 链接永不过期
```

**公开服务（有验证码 + 过期时间）：**
```javascript
captcha: { enabled: true, require_on_create: true, require_on_access: false }
expiration_ttl: 86400  // 24 小时后过期
```

**高安全场景：**
```javascript
captcha: { enabled: true, require_on_create: true, require_on_access: true, fallback_on_error: false }
safe_browsing_api_key: "你的 Google API 密钥"
```

---

## API 接口

### 创建短链接

**POST** `https://你的域名/`

**请求体：**
```json
{
  "url": "https://example.com/very/long/url",
  "captcha_token": "如果启用了验证码则需要此字段"
}
```

**成功响应：**
```json
{
  "status": 200,
  "key": "/aBcDeF",
  "short_url": "https://你的域名/aBcDeF"
}
```

**错误响应：**
```json
{
  "status": 400,
  "error": "Invalid URL format. Must start with http:// or https:// and be under 2048 characters."
}
```

### cURL 示例

```bash
curl -X POST https://s.example.com/ \
  -H "Content-Type: application/json" \
  -d '{"url": "https://example.com/long/url"}'
```

### 访问短链接

**GET** `https://你的域名/{key}`

返回 `302` 重定向到原始 URL。

完整 API 文档：[API 接口文档](docs/API_zh-hans.md)

---

## 验证码

详细的验证码配置说明：[CAPTCHA 验证码文档](docs/CAPTCHA_zh-hans.md)

---

## 常见问题

### Q: 升级代码后，之前的短链接还能用吗？

**能**。KV 中的数据格式没有变化（key → URL），升级代码后所有已有短链接照常工作。

### Q: Workers 免费额度够用吗？

Cloudflare Workers 免费版提供：
- 每天 **100,000 次**请求
- KV 每天 **100,000 次**读取，**1,000 次**写入

对于个人使用完全够用。

### Q: 如何查看已创建的短链接？

在 Cloudflare 控制台 → Workers & Pages → KV → 选择你的命名空间，可以浏览所有键值对。

### Q: 如何删除某条短链接？

在 KV 命名空间界面，找到对应的 key，点击删除即可。

---

## 更新日志

### v2.1.0 (2026-04)
- 迁移到 ES Modules 格式（Cloudflare 推荐）
- 首页 HTML 内联，去除外部 GitHub Pages 依赖
- 添加 `wrangler.toml` 支持命令行部署
- URL 校验增强（使用 URL 构造器 + 长度限制）
- 使用 `crypto.getRandomValues()` 生成安全随机短码
- 改进错误处理，返回结构化 JSON 响应
- 添加安全响应头
- API 响应中返回完整 `short_url`
- 顶层错误捕获，防止 Worker 崩溃

### v2.0.0 (2025-11)
- 集成 CAP Worker 验证码服务
- 添加链接过期时间配置

### v1.x
- 初始版本，基础短链接功能

---

## 致谢

Fork 自 [xyTom/Url-Shorten-Worker](https://github.com/xyTom/Url-Shorten-Worker)。

## 许可证

[MIT](LICENSE)
