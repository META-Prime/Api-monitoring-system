const axios = require("axios");
const { performance } = require("perf_hooks");

const BASE = "https://api.github.com";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const githubHeaders = {
  "User-Agent": "stse-tests/1.0",
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  ...(GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {}),
};
const anyStatus = { validateStatus: () => true, headers: githubHeaders };

function msSince(start) {
  return Math.round(performance.now() - start);
}

describe("GitHub API — functional", () => {

  test("GET /users/octocat returns valid user", async () => {
    const { status, data } = await axios.get(`${BASE}/users/octocat`, anyStatus);

    expect(status).toBe(200);
    expect(data.login).toBe("octocat");
    expect(data).toHaveProperty("id");
    expect(data).toHaveProperty("repos_url");
  });

  test("GET user repos returns array", async () => {
    const { status, data } = await axios.get(`${BASE}/users/octocat/repos`, anyStatus);

    expect(status).toBe(200);
    expect(Array.isArray(data)).toBe(true);
  });

});

describe("GitHub API — data validation", () => {

  test("user object structure is valid", async () => {
    const { data } = await axios.get(`${BASE}/users/octocat`, anyStatus);

    expect(typeof data.login).toBe("string");
    expect(typeof data.id).toBe("number");
    expect(typeof data.repos_url).toBe("string");
  });

  test("repos response structure is consistent", async () => {
    const { data } = await axios.get(`${BASE}/users/octocat/repos`, anyStatus);

    if (data.length > 0) {
      expect(data[0]).toHaveProperty("name");
      expect(data[0]).toHaveProperty("html_url");
    }
  });

});

describe("GitHub API — headers", () => {

  test("response headers contain metadata", async () => {
    const res = await axios.get(`${BASE}/users/octocat`, anyStatus);

    expect(res.headers).toHaveProperty("content-type");
    expect(res.headers["content-type"]).toContain("application/json");
  });

});

describe("GitHub API — negative", () => {

  test("invalid user returns 404", async () => {
    const { status } = await axios.get(
      `${BASE}/users/thisuserdoesnotexist123456`,
      anyStatus
    );

    expect(status).toBe(404);
  });

});

describe("GitHub API — performance", () => {

  test("GET user responds under 1000ms", async () => {
    const start = performance.now();

    const { status } = await axios.get(`${BASE}/users/octocat`, anyStatus);

    const time = msSince(start);
    console.log("Response time:", time);

    expect(status).toBe(200);
    expect(time).toBeLessThan(1000);
  });

});

describe("GitHub API — rate limiting", () => {

  test("rate limit headers exist", async () => {
    const res = await axios.get(`${BASE}/users/octocat`, anyStatus);

    expect(res.headers).toHaveProperty("x-ratelimit-limit");
    expect(res.headers).toHaveProperty("x-ratelimit-remaining");
  });

  test("multiple requests reduce remaining limit", async () => {
    const res1 = await axios.get(`${BASE}/users/octocat`, anyStatus);
    const remaining1 = Number(res1.headers["x-ratelimit-remaining"]);

    const res2 = await axios.get(`${BASE}/users/octocat`, anyStatus);
    const remaining2 = Number(res2.headers["x-ratelimit-remaining"]);

    expect(remaining2).toBeLessThanOrEqual(remaining1);
  });

});

describe("GitHub API — reliability", () => {

  test("multiple parallel requests succeed", async () => {
    const n = 5;

    const results = await Promise.all(
      Array.from({ length: n }, () =>
        axios.get(`${BASE}/users/octocat`, anyStatus)
      )
    );

    for (const res of results) {
      expect(res.status).toBe(200);
    }
  });

});