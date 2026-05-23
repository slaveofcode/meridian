import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['*.js', 'tools/*.js'],
      exclude: [
        'scripts/',
        'discord-listener/',
        'setup.js',
        'envcrypt.js',
        'vitest.config.js',
      ],
    },
  },
})
