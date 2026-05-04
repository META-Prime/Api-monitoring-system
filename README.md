# STSE Final Project — API Testing & Monitoring System

This project is an **API testing and monitoring system**. It combines:

- **Automated API tests** written in **Jest** (functional, negative, performance, reliability)
- **Manual/collection-based API tests** using **Postman** collections
- A lightweight **monitoring server** (Node.js + Express) that probes external APIs on an interval and exposes **Prometheus metrics**
- A ready-to-import **Grafana dashboard** for visualizing availability, latency, throughput, failures, and GitHub rate limits

## Tech stack

- **Runtime**: Node.js (CommonJS)
- **HTTP client**: Axios
- **Testing**: Jest + `jest-html-reporter`
- **Monitoring**: Express + `prom-client` (Prometheus metrics)
- **Dashboarding**: Grafana (dashboard JSON included)
- **API testing**: Postman (collections included)

## Project structure

- `tests/`: Jest test suites for the external APIs
- `monitoring/monitor.js`: monitoring server + Prometheus `/metrics`
- `monitoring/grafana-dashboard.json`: Grafana dashboard (12 panels)
- `postman/`: Postman collections (GitHub, REST Countries, and OpenWeather/Binance)

## Setup

Install dependencies:

```bash
npm install
```

### Environment variables (optional but recommended)

Some APIs require authentication and/or rate limit quickly without it.

- **GitHub**: recommended to avoid `403` due to rate limiting
- **OpenWeather**: required if you want the OpenWeather monitoring check to be “up”

PowerShell examples:

```powershell
# GitHub Personal Access Token (recommended)
$env:GITHUB_TOKEN="your_github_personal_access_token"

# OpenWeather API key (optional; enables OpenWeather checks)
$env:OPENWEATHER_KEY="your_openweather_api_key"

# Optional monitoring config
$env:MONITOR_PORT="4000"
$env:CHECK_INTERVAL_MS="30000"
```

Notes:

- GitHub requests use headers: `User-Agent`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28`, and `Authorization: Bearer ...` (only when `GITHUB_TOKEN` is set).
- If `OPENWEATHER_KEY` is not set, the monitor exposes OpenWeather as down and increments a `missing_api_key` failure reason.

## Running the automated tests (Jest)

Run all tests:

```bash
npm run test:all
```

Run specific suites:

```bash
npm run test:github
npm run test:rest
npm run test:api
```

What the tests cover:

- **GitHub API**: functional checks, schema validation, negative tests (404), performance (<1000ms), rate-limit headers, parallel reliability
- **REST Countries API**: functional checks, field filtering, negative tests (404), performance (<1000ms), parallel reliability
- **Binance API**: ping/time/avg price (network errors are handled as “skipped” instead of failing)
- **OpenWeather API**: verifies 401 for an invalid key; validates real response only if `OPENWEATHER_KEY` is configured

## Running the monitoring server (Prometheus metrics)

Start the monitor:

```bash
npm run monitor
```

Endpoints:

- `http://localhost:4000/health`: basic service health + interval configuration
- `http://localhost:4000/metrics`: Prometheus metrics output

### Monitored APIs/endpoints

The monitoring loop probes these endpoints (default interval is 30 seconds):

- **GitHub**: `GET /users/octocat`
- **REST Countries**: `GET /v3.1/name/ethiopia`
- **Binance** (with fallback to `.us` if needed):
  - `GET /api/v3/time`
  - `GET /api/v3/avgPrice?symbol=BTCUSDT`
  - `GET /api/v3/ping`
- **OpenWeather** (only if `OPENWEATHER_KEY` is set):
  - `GET /data/2.5/weather?q=London&appid=...`

### Prometheus metrics exposed

From `/metrics`, the project exposes:

- `external_api_up` (gauge; 1 up / 0 down; labels: `api`, `endpoint`)
- `external_api_request_duration_ms` (histogram; labels: `api`, `endpoint`)
- `external_api_failures_total` (counter; labels: `api`, `endpoint`, `reason`)
- `external_api_success_total` (counter; labels: `api`, `endpoint`)
- `external_api_requests_total` (counter; labels: `api`, `endpoint`, `result`)
- `external_api_last_status_code` (gauge; labels: `api`, `endpoint`)
- `external_api_last_check_unix` (gauge; labels: `api`, `endpoint`)
- `external_api_last_success_unix` (gauge; labels: `api`, `endpoint`)
- `external_api_check_runs_total` (counter)
- `external_api_network_errors_total` (counter; labels: `api`, `endpoint`, `error_code`)
- `github_rate_limit` (gauge; label: `resource`)
- `github_rate_remaining` (gauge; label: `resource`)
- `github_rate_reset_unix` (gauge; label: `resource`)

## Grafana dashboard (included)

The file `monitoring/grafana-dashboard.json` contains a **12-panel** Grafana dashboard titled **“STSE API Monitoring (12 Panels)”**.

To use it:

- Add **Prometheus** as a Grafana data source
- Import the dashboard JSON from `monitoring/grafana-dashboard.json`

### Prometheus scrape configuration (example)

Prometheus must scrape the monitor’s `/metrics` endpoint. Example `prometheus.yml`:

```yaml
global:
  scrape_interval: 15s

scrape_configs:
  - job_name: "stse-monitor"
    metrics_path: /metrics
    static_configs:
      - targets: ["localhost:4000"]
```

If you changed the port via `MONITOR_PORT`, update the target accordingly.

If you want to rebuild panels manually, these are the Prometheus queries used:

- **Availability by endpoint (stat)**: `external_api_up`
- **P95 latency by endpoint (time series)**: `histogram_quantile(0.95, sum by (le, api, endpoint) (rate(external_api_request_duration_ms_bucket[5m])))`
- **P99 latency by endpoint (time series)**: `histogram_quantile(0.99, sum by (le, api, endpoint) (rate(external_api_request_duration_ms_bucket[5m])))`
- **Failure rate (time series)**: `sum by (api, endpoint) (rate(external_api_failures_total[5m]))`
- **Success rate (time series)**: `sum by (api, endpoint) (rate(external_api_success_total[5m]))`
- **Throughput (time series)**: `sum by (api, endpoint, result) (rate(external_api_requests_total[5m]))`
- **Last HTTP status code (table)**: `external_api_last_status_code`
- **Time since last success (stat)**: `time() - external_api_last_success_unix`
- **Time since last check (stat)**: `time() - external_api_last_check_unix`
- **Monitor cycle counter (stat)**: `external_api_check_runs_total`
- **GitHub remaining quota (gauge)**: `github_rate_remaining{resource="core"}`
- **GitHub reset timestamp (stat)**: `github_rate_reset_unix{resource="core"}`
- **Top network errors (bar chart)**: `sum by (api, endpoint, reason) (increase(external_api_failures_total{reason=~"network_.*"}[15m]))`

## Postman collections

Collections are in `postman/`:

- `postman/GitHub.postman_collection.json`
- `postman/REST-Countries.postman_collection.json`
- `postman/API Tests.postman_collection.json` (OpenWeather + Binance)

Recommended Postman variables:

- **GitHub collection**: `baseUrl=https://api.github.com`, `username=octocat`
- **REST Countries collection**: `baseUrl=https://restcountries.com/v3.1`
- **API Tests collection**:
  - `ow_base_url=https://api.openweathermap.org`
  - `openweather_key=<your key>` (optional)
  - `binance_base_url=https://api.binance.com`
