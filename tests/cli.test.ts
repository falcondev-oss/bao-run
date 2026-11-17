import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { afterAll, expect, test } from 'vitest'

const cli = fileURLToPath(new URL('../src/index.ts', import.meta.url))

function isLogin(value: unknown): value is { role_id: unknown; secret_id: unknown } {
  return typeof value === 'object' && value !== null && 'role_id' in value && 'secret_id' in value
}

const server = createServer((req, res) => {
  res.setHeader('content-type', 'application/json')
  if (req.url === '/v1/auth/approle/login') {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk: string) => {
      body += chunk
    })
    req.on('end', () => {
      const login: unknown = JSON.parse(body)
      if (!isLogin(login) || login.role_id !== 'role' || login.secret_id !== 'secret') {
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
  if (req.url === '/v1/secret/data/app/json' && req.headers['x-vault-token'] === 'token') {
    res.end(JSON.stringify({ data: { data: { PORT: 3000 } } }))
    return
  }
  res.statusCode = 403
  res.end(JSON.stringify({ errors: ['permission denied'] }))
})

server.listen(0, '127.0.0.1')
await once(server, 'listening')
const address = server.address()
if (address === null || typeof address === 'string') throw new Error('expected a TCP address')
const addr = `http://127.0.0.1:${address.port}/`
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
  child.stdout.on('data', (chunk: string) => {
    stdout += chunk
  })
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk
  })
  const exit = new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    child.on('exit', (code) => {
      resolve({ code, stdout, stderr })
    })
  })
  return { child, exit }
}

const printEnv = `console.log(JSON.stringify({ DATABASE_URL: process.env.DATABASE_URL, MULTI: process.env.MULTI, ROLE: process.env.BAO_ROLE_ID, SECRET: process.env.BAO_SECRET_ID, ADDR: process.env.BAO_ADDR }))`

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

test('fails on a value that is not a string', async () => {
  const { code, stderr } = await run(['--', 'true'], { BAO_SECRET_PATH: 'app/json' }).exit
  expect(code).toBe(1)
  expect(stderr).toContain('PORT in app/json is not a string')
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
  await once(child.stdout, 'data')
  child.kill('SIGTERM')
  const { code, stdout } = await exit
  expect(stdout).toContain('term')
  expect(code).toBe(0)
})
