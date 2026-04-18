const express = require("express");
const axios = require("axios");
const client = require("prom-client");

const app = express();
const register = new client.Registry();
client.collectDefaultMetrics({ register });

const CHECK_INTERVAL_MS = Number(process.env.CHECK_INTERVAL_MS || 30000);
const PORT = Number(process.env.MONITOR_PORT || 4000);
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

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
register.registerMetric(githubRateLimit);
register.registerMetric(githubRateRemaining);
register.registerMetric(githubRateResetUnix);

// Initialize labeled series so they always appear in /metrics output.
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

async function probe(api, endpoint, url, expectedStatus) {
  const start = Date.now();
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
    } else {
      requestStatus.labels(api, endpoint).set(0);
      requestFailures.labels(api, endpoint, `status_${res.status}`).inc();
    }

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
    requestDuration.labels(api, endpoint).observe(elapsed);
    requestStatus.labels(api, endpoint).set(0);
    requestFailures.labels(api, endpoint, "network_or_timeout").inc();
  }
}

async function runChecks() {
  await Promise.all([
    probe("github", "user_octocat", "https://api.github.com/users/octocat", 200),
    probe("restcountries", "country_ethiopia", "https://restcountries.com/v3.1/name/ethiopia", 200),
  ]);
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
