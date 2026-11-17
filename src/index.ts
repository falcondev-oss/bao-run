#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { constants } from 'node:os'

type Variable = 'BAO_ADDR' | 'BAO_ROLE_ID' | 'BAO_SECRET_ID' | 'BAO_SECRET_PATH'

function fail(message: string, code = 1): never {
  console.error(`bao-run: ${message}`)
  process.exit(code)
}

function required(name: Variable) {
  const value = process.env[name]
  if (value === undefined || value === '') fail(`${name} is required`)
  return value
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isAppRoleLogin(value: unknown): value is { auth: { client_token: string } } {
  return isObject(value) && isObject(value.auth) && typeof value.auth.client_token === 'string'
}

function isKvV2Read(value: unknown): value is { data: { data: Record<string, unknown> } } {
  return isObject(value) && isObject(value.data) && isObject(value.data.data)
}

const separator = process.argv.indexOf('--')
const [command, ...args] = separator === -1 ? [] : process.argv.slice(separator + 1)
if (command === undefined) fail('usage: bao-run -- <command> [args...]', 2)

const addr = required('BAO_ADDR').replace(/\/+$/u, '')
const path = required('BAO_SECRET_PATH')

async function bao<T>(endpoint: string, is: (value: unknown) => value is T, init?: RequestInit) {
  const response = await fetch(`${addr}/v1${endpoint}`, init)
  if (!response.ok) fail(`${endpoint}: ${response.status} ${await response.text()}`)
  const body: unknown = await response.json()
  if (!is(body)) fail(`${endpoint}: unexpected response`)
  return body
}

const { auth } = await bao('/auth/approle/login', isAppRoleLogin, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ role_id: required('BAO_ROLE_ID'), secret_id: required('BAO_SECRET_ID') }),
})
const { data } = await bao(`/secret/data/${path}`, isKvV2Read, {
  headers: { 'x-vault-token': auth.client_token },
})

const secrets = Object.entries(data.data).map(([key, value]) =>
  typeof value === 'string' ? ([key, value] as const) : fail(`${key} in ${path} is not a string`),
)
const {
  BAO_ROLE_ID: _roleId,
  BAO_SECRET_ID: _secretId,
  ...env
} = {
  ...process.env,
  ...Object.fromEntries(secrets),
}
console.error(`bao-run: loaded ${secrets.length} secrets from ${path}`)

const child = spawn(command, args, { stdio: 'inherit', env })
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
  process.on(signal, () => {
    child.kill(signal)
  })
}
child.on('error', (error) => fail(`${command}: ${error.message}`, 127))
child.on('exit', (code, signal) =>
  process.exit(code ?? 128 + (signal === null ? 0 : constants.signals[signal])),
)
