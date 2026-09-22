#!/usr/bin/env node
/**
 * Generates TypeScript domain types from every embedded Schema snapshot.
 *
 * `src/schemas/v*\/flow-model.schema.json` is the structural source of truth for
 * its version; the generated file is committed but must never be edited by
 * hand. `pnpm schema:check` regenerates it in memory and fails on drift.
 */
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { compile } from 'json-schema-to-typescript'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const schemasDir = join(projectRoot, 'src', 'schemas')
const outputDir = join(projectRoot, 'src', 'generated')

const BANNER = `/**
 * GENERATED FILE - DO NOT EDIT BY HAND.
 *
 * Produced by \`pnpm schema:types\` from the embedded Schema snapshot.
 * Edit the snapshot under src/schemas/ and regenerate instead.
 */
`

/** Discovers `v<version>` directories that hold an embedded Schema snapshot. */
export async function listSchemaSnapshots() {
  const entries = await readdir(schemasDir, { withFileTypes: true })
  const snapshots = []
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith('v')) continue
    const schemaPath = join(schemasDir, entry.name, 'flow-model.schema.json')
    try {
      await readFile(schemaPath, 'utf8')
    } catch {
      continue
    }
    snapshots.push({ dirName: entry.name, schemaPath })
  }
  return snapshots.sort((a, b) => a.dirName.localeCompare(b.dirName))
}

/**
 * Compiles one snapshot to TypeScript source. Exported so the checker can
 * produce the same bytes without touching the working tree.
 */
export async function generateTypes(snapshot) {
  const schema = JSON.parse(await readFile(snapshot.schemaPath, 'utf8'))
  const types = await compile(schema, schema.title ?? 'FlowModel', {
    bannerComment: BANNER,
    cwd: dirname(snapshot.schemaPath),
    additionalProperties: false,
    declareExternallyReferenced: true,
    enableConstEnums: false,
    format: false,
    style: { semi: false, singleQuote: true, printWidth: 100 },
  })
  return types.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
}

export function outputPathFor(snapshot) {
  const version = snapshot.dirName.replace(/^v/, '')
  return join(outputDir, `flow-model-v${version}.ts`)
}

async function main() {
  const snapshots = await listSchemaSnapshots()
  if (snapshots.length === 0) {
    throw new Error(`No embedded Schema snapshots found under ${relative(projectRoot, schemasDir)}`)
  }
  await mkdir(outputDir, { recursive: true })
  for (const snapshot of snapshots) {
    const target = outputPathFor(snapshot)
    await writeFile(target, await generateTypes(snapshot), 'utf8')
    console.log(`generated ${relative(projectRoot, target).replace(/\\/g, '/')}`)
  }
}

const isDirectRun =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href

if (isDirectRun) {
  main().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
