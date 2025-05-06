/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleNameMapper: { // Added moduleNameMapper
    '^@/(.*)$': '<rootDir>/src/$1',
  },
  testMatch: [
    "**/__tests__/**/*.ts?(x)",
    "**/?(*.)+(spec|test).ts?(x)"
  ],
  // Coverage configuration
  collectCoverage: false, // We'll enable this via command line
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'clover', 'html'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/types.ts',
    '!src/tests/**',
    '!src/utils/**',
    '!src/infrastructure/network/server.ts', // Entry point with side effects
    '!**/node_modules/**'
  ]
};
