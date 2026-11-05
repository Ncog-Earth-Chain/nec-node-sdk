module.exports = {
  ...require('./jest.config'),
  testMatch: ['<rootDir>/tests/**/*.pq.test.ts'],
  testPathIgnorePatterns: ['/node_modules/'],
};
