# Production security configuration

## Deployment boundary

Run the Node service only behind a managed HTTPS reverse proxy. Production
startup requires a loopback-only host such as `127.0.0.1`. The proxy
must terminate TLS, forward the original `Host` header, reject malformed host
headers, and must not pass client-supplied proxy headers as trusted values. This
application does not use `X-Forwarded-*` headers for authentication decisions.

Copy `.env.production.example` to a local, ignored `.env.production` file and
start the application with `ENV_FILE=.env.production`. Do not put that file in
Git, backups, tickets, or chat messages.

## Startup safeguards

With `NODE_ENV=production`, startup rejects the configuration unless all of the
following are true:

- `PUBLIC_BASE_URL` is a canonical HTTPS origin.
- `TRUSTED_ORIGINS` contains that public origin and contains HTTPS origins only.
- `TRUST_PROXY=true` is explicit.
- `COOKIE_SECURE=true` is explicit.
- `MYSQL_SSL=true` is explicit.
- Application and dashboard database settings are present.
- Admin username and a valid scrypt password hash are present.

Validate a production file without binding a public port or connecting to the
database:

```powershell
$env:ENV_FILE='.env.production'
$env:VALIDATE_CONFIG_ONLY='true'
node server.js
```

Remove these temporary shell variables after validation. A successful result
only validates local configuration; it is not proof of a live HTTPS deployment.

## Cookies, origin checks, and headers

All authenticated cookies are `HttpOnly`, `SameSite=Strict`, and production
startup requires `Secure`. State-changing requests require a same-origin
`Origin` header. In production the header origin must be listed in
`TRUSTED_ORIGINS`.

The server adds `nosniff`, a strict referrer policy, frame denial, cross-origin
isolation headers, and a restrictive permissions policy. In production it adds
a compatible Content Security Policy. HSTS is sent only when
`ENABLE_HSTS=true`; enable it only after HTTPS works on every intended domain
and subdomain.

## Database

Use separate least-privilege accounts for the application, dashboard, backup,
and migration/recovery administration. The application accounts must not have
`CREATE`, `ALTER`, `DROP`, or global privileges. Require TLS to MySQL in
production and configure `MYSQL_SSL_CA` when the CA is not already trusted by
the operating system. Keep production, test, and recovery databases separate.

## Manual production checklist

1. Create a private `.env.production` from the template and validate it.
2. Configure HTTPS certificates and reverse-proxy routing.
3. Verify the public hostname, `TRUSTED_ORIGINS`, and secure cookie behavior.
4. Configure restricted MySQL accounts and TLS.
5. Configure protected private-document and backup storage outside static roots.
6. Test login, logout, file authorization, health, and error handling through
   the real HTTPS endpoint.
7. Only then set `ENABLE_HSTS=true` and restart after approval.

No production deployment, database migration, or unattended production backup
schedule is activated by this documentation.
