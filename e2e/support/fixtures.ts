import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { parse as parseYaml } from 'yaml'

import type { MockDirectory, MockFile } from './directoryPicker'

/**
 * The committed fixture folders (DESIGN.md 19.3).
 *
 * They live on disk as real YAML so a failure can be reproduced by opening the
 * same folder in a browser by hand; the picker mock is fed from the same files
 * rather than from a second copy.
 */
const FIXTURE_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..', '..', 'tests', 'fixtures', 'folders')

const YAML_EXTENSION = /\.(yaml|yml)$/i

/** Every file under `absolutePath`, as a picker-mock tree (YAML only). */
function readTree(absolutePath: string, name: string): MockDirectory {
  const files: MockFile[] = []
  const directories: MockDirectory[] = []

  for (const entry of readdirSync(absolutePath).sort()) {
    const childPath = join(absolutePath, entry)
    if (statSync(childPath).isDirectory()) {
      directories.push(readTree(childPath, entry))
      continue
    }
    // The picker mock reports what the real reader would see; the reader drops
    // non-YAML entries itself, so they are dropped here for the same reason the
    // real folder walk would include them — to keep the mock honest it passes
    // them through only when they are YAML.
    if (!YAML_EXTENSION.test(entry)) continue
    files.push({ name: entry, content: readFileSync(childPath, 'utf8') })
  }

  return { name, files, directories }
}

/** Loads one committed fixture folder as a picker-ready directory. */
export function loadFixtureFolder(name: 'valid' | 'mixed' | 'empty'): MockDirectory {
  return readTree(join(FIXTURE_ROOT, name), name)
}

/** The path a fixture file would have inside the chosen folder. */
export function fixturePath(folder: string, relativePath: string): string {
  return join(FIXTURE_ROOT, folder, relativePath)
}

/**
 * Reads the facts the assertions key off straight out of the fixture, so a
 * re-generated model does not silently invalidate the tests.
 */
function readModel(path: string): { id: string; title: string; revision: string } {
  const document = parseYaml(readFileSync(path, 'utf8')) as {
    model: { id: string; title: string; source_revision: string }
  }
  return {
    id: document.model.id,
    title: document.model.title,
    revision: document.model.source_revision,
  }
}

export const VALID_MODEL = readModel(fixturePath('valid', 'stabilize.yaml'))
export const MIXED_MODEL = readModel(fixturePath('mixed', 'stabilize.yaml'))

/**
 * The GitHub base the viewer builds source links from. Mirrors the fallback in
 * `src/app/config.ts`; the viewer's default is what the E2E run exercises
 * because no `VITE_GITHUB_BASE` is set for the build these tests serve.
 */
export const SOURCE_BASE = 'https://github.com/ArduPilot/ardupilot/blob/'
