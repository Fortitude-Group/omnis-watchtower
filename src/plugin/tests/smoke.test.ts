import { expect, test } from 'claude-code/testing'

test('the plugin loads under the engine', async ($) => {
  expect(typeof $.tool.call).toBe('function')
})
