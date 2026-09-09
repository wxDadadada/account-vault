import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { type PublicProfile, type VaultResponse } from '../shared/protocol'
import {
  createCredentials,
  decryptVault,
  encryptVault,
} from '../src/vault/lib/crypto'
import { fixtureVault, master } from '../tests/fixtures'

const name = `keyfolio-smoke-${randomUUID().slice(0, 8)}`
const volume = `${name}-data`
const image = process.env.SMOKE_IMAGE ?? 'keyfolio:local'
function docker(...args: string[]) {
  return execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
}
let origin = ''
async function ready() {
  // Docker may allocate a different ephemeral host port after a restart.
  const mapping = JSON.parse(docker('inspect', name))[0].NetworkSettings.Ports[
    '8188/tcp'
  ]?.[0]
  if (mapping) origin = `http://127.0.0.1:${mapping.HostPort}`
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      if ((await fetch(`${origin}/api/health`)).ok) return
    } catch {
      /* Container is starting. */
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error(
    `Container did not become healthy: ${docker('logs', '--tail', '20', name)}`
  )
}
async function request(
  path: string,
  payload?: unknown,
  cookie?: string,
  method = 'POST'
) {
  const response = await fetch(`${origin}/api${path}`, {
    method: payload === undefined ? 'GET' : method,
    headers: {
      'content-type': 'application/json',
      'x-keyfolio': '1',
      origin: 'http://localhost:8188',
      ...(cookie ? { cookie } : {}),
    },
    ...(payload !== undefined ? { body: JSON.stringify(payload) } : {}),
  })
  assert.equal(
    response.status,
    200,
    `${method} ${path} failed with ${response.status}`
  )
  return {
    value: await response.json(),
    cookie: response.headers.get('set-cookie')?.split(';')[0],
  }
}
try {
  docker('volume', 'create', volume)
  docker(
    'run',
    '-d',
    '--name',
    name,
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--tmpfs',
    '/tmp:size=16m,mode=1777',
    '-p',
    '127.0.0.1::8188',
    '-v',
    `${volume}:/app/data`,
    '-e',
    'APP_ORIGIN=http://localhost:8188',
    image
  )
  const binding = JSON.parse(docker('inspect', name))[0].NetworkSettings.Ports[
    '8188/tcp'
  ][0]
  origin = `http://127.0.0.1:${binding.HostPort}`
  await ready()
  assert.equal(docker('exec', name, 'id', '-u'), '1000')
  const page = await fetch(origin)
  const html = await page.text()
  assert.match(html, /拾钥/)
  const moduleUrl = html.match(/<script[^>]+src="([^"]+)"/)?.[1]
  assert.ok(moduleUrl)
  assert.equal((await fetch(`${origin}${moduleUrl}`)).status, 200)
  assert.equal((await fetch(`${origin}/settings`)).status, 200)
  const credentials = await createCredentials('docker-owner', master)
  const initial = fixtureVault()
  const setup = await request('/auth/setup', {
    credentials: credentials.credentials,
    payload: await encryptVault(credentials.key, initial),
  })
  const state = setup.value as { profile: PublicProfile; vault: VaultResponse }
  assert.equal(state.vault.revision, 1)
  await request('/backup', {}, setup.cookie)
  const changed = structuredClone(initial)
  changed.accounts[0].notes = 'CONTAINER_RESTART_CHECK'
  const saved = await request(
    '/vault',
    { revision: 1, payload: await encryptVault(credentials.key, changed) },
    setup.cookie,
    'PUT'
  )
  assert.equal(saved.value.revision, 2)
  docker('restart', name)
  await ready()
  const login = await request('/auth/login', {
    username: 'docker-owner',
    authProof: credentials.credentials.authProof,
  })
  assert.equal(login.value.vault.revision, 2)
  assert.deepEqual(
    await decryptVault(credentials.key, login.value.vault.payload),
    changed
  )
  docker('stop', name)
  const restoreCode = `const fs = require('node:fs'); const dir = '/app/data'; const file = fs.readdirSync(dir + '/backups').filter(f => f.endsWith('.sqlite')).sort().at(-1); if (!file) throw Error('No snapshot'); for (const suffix of ['-wal', '-shm']) fs.rmSync(dir + '/keyfolio.sqlite' + suffix, { force: true }); fs.copyFileSync(dir + '/backups/' + file, dir + '/keyfolio.sqlite');`
  docker(
    'run',
    '--rm',
    '--read-only',
    '-v',
    `${volume}:/app/data`,
    image,
    'node',
    '-e',
    restoreCode
  )
  docker('start', name)
  await ready()
  const restored = await request('/auth/login', {
    username: 'docker-owner',
    authProof: credentials.credentials.authProof,
  })
  assert.equal(restored.value.vault.revision, 1)
  assert.deepEqual(
    await decryptVault(credentials.key, restored.value.vault.payload),
    initial
  )
  process.stdout.write(
    'Docker smoke passed: non-root/read-only startup, frontend assets, SPA routing, encrypted write, restart persistence, SQLite snapshot restoration.\n'
  )
} finally {
  try {
    docker('rm', '-f', name)
  } catch {
    /* May not have been created. */
  }
  try {
    docker('volume', 'rm', volume)
  } catch {
    /* Preserve error from the test itself. */
  }
}
