import { defineConfig } from 'oxfmt'

export default defineConfig({
  semi: false,
  singleQuote: true,
  printWidth: 100,
  quoteProps: 'consistent',
  sortPackageJson: true,
  ignorePatterns: ['dist/', 'node_modules/', 'pnpm-lock.yaml'],
})
