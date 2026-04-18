/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  testMatch: ["**/tests/**/*.test.js"],
  testTimeout: 30_000,
  reporters: ["default", "jest-html-reporter"],
};
