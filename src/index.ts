#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { constants } from 'node:os'

type Variable = 'BAO_ADDR' | 'BAO_ROLE_ID' | 'BAO_SECRET_ID' | 'BAO_SECRET_PATH'

interface AppRoleLogin {
  auth: { client_token: string }
}

interface KvV2Read {
  data: { data: Record<string, string> }
}

function fail(message: string, code = 1): never {
  console.error(`bao-run: ${message}`)
  process.exit(code)
}

function required(name: Variable) {
  const value = process.env[name]
  if (!value) fail(`${name} is required`)
  return value
}

const separator = process.argv.indexOf('--')
const [command, ...args] = separator === -1 ? [] : process.argv.slice(separator + 1)
if (!command) fail('usage: bao-run -- <command> [args...]', 2)

const addr = required('BAO_ADDR').replace(/\/+$/, '')
const path = required('BAO_SECRET_PATH')

async function bao<T>(endpoint: string, init?: RequestInit) {
  const response = await fetch(`${addr}/v1${endpoint}`, init)
  if (!response.ok) fail(`${endpoint}: ${response.status} ${await response.text()}`)
  // SAFETY: the shapes are those of the OpenBao API for AppRole login and KV v2 read
  return (await response.json()) as T
}

const { auth } = await bao<AppRoleLogin>('/auth/approle/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ role_id: required('BAO_ROLE_ID'), secret_id: required('BAO_SECRET_ID') }),
})
const { data } = await bao<KvV2Read>(`/secret/data/${path}`, {
  headers: { 'x-vault-token': auth.client_token },
})

const { BAO_ROLE_ID: _roleId, BAO_SECRET_ID: _secretId, ...env } = { ...process.env, ...data.data }
console.error(`bao-run: loaded ${Object.keys(data.data).length} secrets from ${path}`)

const child = spawn(command, args, { stdio: 'inherit', env })
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const)
  process.on(signal, () => child.kill(signal))
child.on('error', (error) => fail(`${command}: ${error.message}`, 127))
child.on('exit', (code, signal) =>
  process.exit(code ?? 128 + (signal ? constants.signals[signal] : 0)),
)
