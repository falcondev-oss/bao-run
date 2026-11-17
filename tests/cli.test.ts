import type { AddressInfo } from 'node:net'

import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, test } from 'vitest'

const cli = fileURLToPath(new URL('../src/index.ts', import.meta.url))

const server = createServer((req, res) => {
  res.setHeader('content-type', 'application/json')
  if (req.url === '/v1/auth/approle/login') {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => (body += chunk))
    req.on('end', () => {
      // SAFETY: the test controls the request body
      const { role_id, secret_id } = JSON.parse(body) as Record<string, string>
      if (role_id !== 'role' || secret_id !== 'secret') {
        res.statusCode = 400
        res.end(JSON.stringify({ errors: ['invalid role or secret ID'] }))
        return
      }
      res.end(JSON.stringify({ auth: { client_token: 'token' } }))
    })
    return
  }
  if (req.url === '/v1/secret/data/app/prod' && req.headers['x-vault-token'] === 'token') {
    res.end(JSON.stringify({ data: { data: { DATABASE_URL: 'postgres://db', MULTI: 'a\nb' } } }))
    return
  }
  res.statusCode = 403
  res.end(JSON.stringify({ errors: ['permission denied'] }))
})

server.listen(0, '127.0.0.1')
await once(server, 'listening')
// SAFETY: a TCP server listening on a port has an AddressInfo
const addr = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`
afterAll(() => server.close())

function run(args: string[], env: Record<string, string>) {
  const child = spawn(process.execPath, [cli, ...args], {
    env: {
      PATH: process.env.PATH ?? '',
      BAO_ADDR: addr,
      BAO_ROLE_ID: 'role',
      BAO_SECRET_ID: 'secret',
      BAO_SECRET_PATH: 'app/prod',
      ...env,
    },
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stdout.on('data', (chunk: string) => (stdout += chunk))
  child.stderr.on('data', (chunk: string) => (stderr += chunk))
  const exit = once(child, 'exit').then(([code]) => ({ code: code as number, stdout, stderr }))
  return { child, exit }
}

const printEnv = `console.log(JSON.stringify({ DATABASE_URL: process.env.DATABASE_URL, MULTI: process.env.MULTI, ROLE: process.env.BAO_ROLE_ID, SECRET: process.env.BAO_SECRET_ID, ADDR: process.env.BAO_ADDR }))`

describe('bao-run', () => {
  test('loads the secret into the environment and hides the AppRole', async () => {
    const { code, stdout, stderr } = await run(['--', process.execPath, '-e', printEnv], {}).exit
    expect(code).toBe(0)
    expect(JSON.parse(stdout)).toEqual({
      DATABASE_URL: 'postgres://db',
      MULTI: 'a\nb',
      ADDR: addr,
    })
    expect(stderr).toContain('loaded 2 secrets from app/prod')
  })

  test('passes the exit code of the command through', async () => {
    const { code } = await run(['--', process.execPath, '-e', 'process.exit(3)'], {}).exit
    expect(code).toBe(3)
  })

  test('fails without BAO_ADDR', async () => {
    const { code, stderr } = await run(['--', 'true'], { BAO_ADDR: '' }).exit
    expect(code).toBe(1)
    expect(stderr).toContain('BAO_ADDR is required')
  })

  test('fails on a wrong secret id', async () => {
    const { code, stderr } = await run(['--', 'true'], { BAO_SECRET_ID: 'wrong' }).exit
    expect(code).toBe(1)
    expect(stderr).toContain('/auth/approle/login: 400')
  })

  test('forwards SIGTERM to the command', async () => {
    const { child, exit } = run(
      [
        '--',
        process.execPath,
        '-e',
        `process.on('SIGTERM', () => { console.log('term'); process.exit(0) }); console.log('ready'); setInterval(() => {}, 1000)`,
      ],
      {},
    )
    await new Promise<void>((resolve) =>
      child.stdout.on('data', (chunk: string) => chunk.includes('ready') && resolve()),
    )
    child.kill('SIGTERM')
    const { code, stdout } = await exit
    expect(stdout).toContain('term')
    expect(code).toBe(0)
  })
})
