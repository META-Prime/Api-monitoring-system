const express = require("express");
const axios = require("axios");
const client = require("prom-client");

const app = express();
const register = new client.Registry();
require("dotenv").config();
client.collectDefaultMetrics({ register });

const CHECK_INTERVAL_MS = Number(process.env.CHECK_INTERVAL_MS || 30000);
const PORT = Number(process.env.MONITOR_PORT || 4000);
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const OPENWEATHER_KEY =
  process.env.OPENWEATHER_KEY || process.env.openweather_key;

const requestDuration = new client.Histogram({
  name: "external_api_request_duration_ms",
  help: "External API response duration in milliseconds",
  labelNames: ["api", "endpoint"],
  buckets: [100, 250, 500, 1000, 2000, 5000, 10000],
});

const requestStatus = new client.Gauge({
  name: "external_api_up",
  help: "External API health status (1 = up, 0 = down)",
  labelNames: ["api", "endpoint"],
});

const requestFailures = new client.Counter({
  name: "external_api_failures_total",
  help: "Total failed requests to external APIs",
  labelNames: ["api", "endpoint", "reason"],
});

const requestSuccesses = new client.Counter({
  name: "external_api_success_total",
  help: "Total successful requests to external APIs",
  labelNames: ["api", "endpoint"],
});

const requestTotal = new client.Counter({
  name: "external_api_requests_total",
  help: "Total requests to external APIs grouped by result",
  labelNames: ["api", "endpoint", "result"],
});

const lastCheckUnix = new client.Gauge({
  name: "external_api_last_check_unix",
  help: "Last check time in unix seconds",
  labelNames: ["api", "endpoint"],
});

const lastSuccessUnix = new client.Gauge({
  name: "external_api_last_success_unix",
  help: "Last successful check time in unix seconds",
  labelNames: ["api", "endpoint"],
});

const lastStatusCode = new client.Gauge({
  name: "external_api_last_status_code",
  help: "Most recent HTTP status code for each endpoint",
  labelNames: ["api", "endpoint"],
});

const runChecksTotal = new client.Counter({
  name: "external_api_check_runs_total",
  help: "Total monitoring cycles executed",
});

const requestNetworkErrors = new client.Counter({
  name: "external_api_network_errors_total",
  help: "Total network errors by error code",
  labelNames: ["api", "endpoint", "error_code"],
});

const githubRateLimit = new client.Gauge({
  name: "github_rate_limit",
  help: "GitHub API rate limit",
  labelNames: ["resource"],
});

const githubRateRemaining = new client.Gauge({
  name: "github_rate_remaining",
  help: "GitHub API remaining requests in current window",
  labelNames: ["resource"],
});

const githubRateResetUnix = new client.Gauge({
  name: "github_rate_reset_unix",
  help: "GitHub API rate limit reset time (unix seconds)",
  labelNames: ["resource"],
});

register.registerMetric(requestDuration);
register.registerMetric(requestStatus);
register.registerMetric(requestFailures);
register.registerMetric(requestSuccesses);
register.registerMetric(requestTotal);
register.registerMetric(lastCheckUnix);
register.registerMetric(lastSuccessUnix);
register.registerMetric(lastStatusCode);
register.registerMetric(runChecksTotal);
register.registerMetric(requestNetworkErrors);
register.registerMetric(githubRateLimit);
register.registerMetric(githubRateRemaining);
register.registerMetric(githubRateResetUnix);


githubRateLimit.labels("core").set(0);
githubRateRemaining.labels("core").set(0);
githubRateResetUnix.labels("core").set(0);

function githubRequestHeaders() {
  return {
    "User-Agent": "stse-monitor/1.0",
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
  };
}

function getErrorCode(error) {
  if (typeof error?.code === "string" && error.code.trim()) {
    return error.code;
  }
  return "UNKNOWN";
}

async function probe(api, endpoint, url, expectedStatus) {
  const start = Date.now();
  const nowUnix = Math.floor(start / 1000);
  lastCheckUnix.labels(api, endpoint).set(nowUnix);
  try {
    const res = await axios.get(url, {
      timeout: 10000,
      validateStatus: () => true,
      headers:
        api === "github"
          ? githubRequestHeaders()
          : { "User-Agent": "stse-monitor/1.0" },
    });

    const elapsed = Date.now() - start;
    requestDuration.labels(api, endpoint).observe(elapsed);

    if (res.status === expectedStatus) {
      requestStatus.labels(api, endpoint).set(1);
      requestSuccesses.labels(api, endpoint).inc();
      requestTotal.labels(api, endpoint, "success").inc();
      lastSuccessUnix.labels(api, endpoint).set(nowUnix);
    } else {
      requestStatus.labels(api, endpoint).set(0);
      requestFailures.labels(api, endpoint, `status_${res.status}`).inc();
      requestTotal.labels(api, endpoint, "failure").inc();
    }
    lastStatusCode.labels(api, endpoint).set(res.status);

    if (api === "github") {
      const limit = Number(res.headers["x-ratelimit-limit"]);
      const remaining = Number(res.headers["x-ratelimit-remaining"]);
      const reset = Number(res.headers["x-ratelimit-reset"]);

      if (!Number.isNaN(limit)) githubRateLimit.labels("core").set(limit);
      if (!Number.isNaN(remaining)) githubRateRemaining.labels("core").set(remaining);
      if (!Number.isNaN(reset)) githubRateResetUnix.labels("core").set(reset);
    }
  } catch (error) {
    const elapsed = Date.now() - start;
    const errorCode = getErrorCode(error);
    requestDuration.labels(api, endpoint).observe(elapsed);
    requestStatus.labels(api, endpoint).set(0);
    requestFailures.labels(api, endpoint, `network_${errorCode}`).inc();
    requestNetworkErrors.labels(api, endpoint, errorCode).inc();
    requestTotal.labels(api, endpoint, "failure").inc();
    lastStatusCode.labels(api, endpoint).set(0);
  }
}

async function probeWithFallback(api, endpoint, urls, expectedStatus) {
  for (const url of urls) {
    const start = Date.now();
    const nowUnix = Math.floor(start / 1000);
    lastCheckUnix.labels(api, endpoint).set(nowUnix);
    try {
      const res = await axios.get(url, {
        timeout: 10000,
        validateStatus: () => true,
        headers: { "User-Agent": "stse-monitor/1.0" },
      });

      const elapsed = Date.now() - start;
      requestDuration.labels(api, endpoint).observe(elapsed);
      lastStatusCode.labels(api, endpoint).set(res.status);

      if (res.status === expectedStatus) {
        requestStatus.labels(api, endpoint).set(1);
        requestSuccesses.labels(api, endpoint).inc();
        requestTotal.labels(api, endpoint, "success").inc();
        lastSuccessUnix.labels(api, endpoint).set(nowUnix);
        return;
      }

      requestFailures.labels(api, endpoint, `status_${res.status}`).inc();
      requestTotal.labels(api, endpoint, "failure").inc();
    } catch (error) {
      const elapsed = Date.now() - start;
      const errorCode = getErrorCode(error);
      requestDuration.labels(api, endpoint).observe(elapsed);
      requestFailures.labels(api, endpoint, `network_${errorCode}`).inc();
      requestNetworkErrors.labels(api, endpoint, errorCode).inc();
      requestTotal.labels(api, endpoint, "failure").inc();
      lastStatusCode.labels(api, endpoint).set(0);
    }
  }

  requestStatus.labels(api, endpoint).set(0);
}

async function runChecks() {
  runChecksTotal.inc();

  const checks = [
    probe("github", "user_octocat", "https://api.github.com/users/octocat", 200),
    probe(
      "restcountries",
      "country_ethiopia",
      "https://restcountries.com/v3.1/name/ethiopia",
      200
    ),
    probeWithFallback(
      "binance",
      "server_time",
      [
        "https://api.binance.com/api/v3/time",
        "https://api.binance.us/api/v3/time",
      ],
      200
    ),
    probeWithFallback(
      "binance",
      "current_avg_price_btcusdt",
      [
        "https://api.binance.com/api/v3/avgPrice?symbol=BTCUSDT",
        "https://api.binance.us/api/v3/avgPrice?symbol=BTCUSDT",
      ],
      200
    ),
    probeWithFallback(
      "binance",
      "ping",
      ["https://api.binance.com/api/v3/ping", "https://api.binance.us/api/v3/ping"],
      200
    ),
  ];

  if (OPENWEATHER_KEY) {
    checks.push(
      probe(
        "openweather",
        "current_weather_london",
        `https://api.openweathermap.org/data/2.5/weather?q=London&appid=${OPENWEATHER_KEY}`,
        200
      )
    );
  } else {
    requestStatus.labels("openweather", "current_weather_london").set(0);
    requestFailures
      .labels("openweather", "current_weather_london", "missing_api_key")
      .inc();
  }

  await Promise.all(checks);
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "stse-monitor",
    intervalMs: CHECK_INTERVAL_MS,
  });
});

app.get("/metrics", async (_req, res) => {
  res.set("Content-Type", register.contentType);
  res.end(await register.metrics());
});

app.listen(PORT, async () => {
  console.log(`Monitoring server running on http://localhost:${PORT}`);
  console.log(`Metrics endpoint: http://localhost:${PORT}/metrics`);

  await runChecks();
  setInterval(runChecks, CHECK_INTERVAL_MS);
});
