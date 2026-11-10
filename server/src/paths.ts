import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** Repo root (server/src/ -> ../..). */
export const ROOT = resolve(here, '../..')
export const dataPath = (file: string) => resolve(ROOT, 'data', file)
