import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export async function ensureDir(path) {
  await mkdir(path, { recursive: true })
}

export async function writeJson(path, data) {
  await ensureDir(dirname(path))
  await writeFile(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

export async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'))
}

export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

export function timestampForFile(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-')
}
