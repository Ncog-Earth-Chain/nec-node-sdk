module.exports = {
  preset: 'ts-jest', testEnvironment: 'node',
  // The retained Node20/22 suite cannot construct hybrid TLS fixtures. Those tests
  // run unconditionally in the separate required test:pq command and CI job.
  testPathIgnorePatterns: ['/node_modules/', '\\.pq\\.test\\.ts$'],
};
