# STSE Final Project - API Testing and Monitoring

## What to run

- Run all tests: `npm run test:all`
- Run GitHub tests only: `npm run test:github`
- Run REST Countries tests only: `npm run test:rest`
- Run monitoring server: `npm run monitor`

## Important for GitHub API (headers + token)

GitHub may return `403` if requests are unauthenticated and rate limit is exceeded.
Set a token before running heavy tests/monitoring.

PowerShell:

```powershell
$env:GITHUB_TOKEN="your_github_personal_access_token"
```

The project now sends these headers for GitHub requests:

- `User-Agent`
- `Accept: application/vnd.github+json`
- `X-GitHub-Api-Version: 2022-11-28`
- `Authorization: Bearer <token>` (only if `GITHUB_TOKEN` is set)

## Monitoring endpoints

- `http://localhost:4000/health`
- `http://localhost:4000/metrics`

From `/metrics`, the project exposes:

- `external_api_up`
- `external_api_request_duration_ms`
- `external_api_failures_total`
- `github_rate_limit`
- `github_rate_remaining`
- `github_rate_reset_unix`
