const { FlatCompat } = require('@eslint/eslintrc')
const globals = require('globals')

const compat = new FlatCompat({ baseDirectory: __dirname })

module.exports = [
  ...compat.extends('standard'),
  {
    languageOptions: {
      globals: {
        ...globals.node
      }
    },
    rules: {
      'node/no-deprecated-api': 'off'
    }
  }
]
