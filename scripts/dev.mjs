import { spawn } from 'node:child_process'

const children = ['dev:api', 'dev:web'].map((script) =>
  spawn('pnpm', ['run', script], {
    stdio: 'inherit',
    env: { ...process.env, NODE_ENV: 'development' },
  })
)
let closing = false
function stop(code = 0) {
  if (closing) return
  closing = true
  for (const child of children) child.kill('SIGTERM')
  setTimeout(() => process.exit(code), 500).unref()
}
for (const child of children) {
  child.on('error', () => stop(1))
  child.on('exit', (code) => stop(code ?? 0))
}
process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
