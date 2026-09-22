#!/usr/bin/env node
/**
 * Integrity gate for the embedded Schema registry (DESIGN.md 6.4, 7.1).
 *
 * Fails when:
 *  - a snapshot is missing, unparseable, or is not Draft 2020-12;
 *  - a snapshot's directory version and `$id` disagree;
 *  - a snapshot's SHA-256 does not match the digest recorded in registry.ts;
 *  - registry.ts records a digest that no snapshot file produces;
 *  - the committed generated types differ from freshly generated ones.
 */
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { generateTypes, listSchemaSnapshots, outputPathFor } from './generate-schema-types.mjs'

const projectRoot = fileURLToPath(new URL('..', import.meta.url))
const registryPath = join(projectRoot, 'src', 'schemas', 'registry.ts')

const problems = []
const fail = (message) => problems.push(message)

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex')

async function checkSnapshots() {
  const snapshots = await listSchemaSnapshots()
  if (snapshots.length === 0) {
    fail('no embedded Schema snapshots found under src/schemas/v*/')
    return snapshots
  }

  for (const snapshot of snapshots) {
    const raw = await readFile(snapshot.schemaPath)
    const label = relative(projectRoot, snapshot.schemaPath).replace(/\\/g, '/')

    let schema
    try {
      schema = JSON.parse(raw.toString('utf8'))
    } catch (error) {
      fail(`${label}: not valid JSON (${error.message})`)
      continue
    }

    if (schema.$schema !== 'https://json-schema.org/draft/2020-12/schema') {
      fail(`${label}: expected the Draft 2020-12 $schema, found ${JSON.stringify(schema.$schema)}`)
    }

    const version = snapshot.dirName.replace(/^v/, '')
    if (typeof schema.$id !== 'string' || !schema.$id.includes(`/${version}/`)) {
      fail(`${label}: $id ${JSON.stringify(schema.$id)} does not carry the directory version ${version}`)
    }

    snapshot.digest = sha256(raw)
    snapshot.version = version
  }

  return snapshots
}

async function checkRegistryDigests(snapshots) {
  const registrySource = await readFile(registryPath, 'utf8')
  const declared = new Set(registrySource.match(/\b[0-9a-f]{64}\b/g) ?? [])

  for (const snapshot of snapshots) {
    if (snapshot.digest === undefined) continue
    const label = `v${snapshot.version}`
    if (!declared.has(snapshot.digest)) {
      fail(
        `src/schemas/registry.ts does not record the SHA-256 of ${label} ` +
          `(expected ${snapshot.digest}). Update the snapshot entry after reviewing the change.`,
      )
    }
  }

  const produced = new Set(snapshots.map((s) => s.digest).filter((d) => d !== undefined))
  for (const digest of declared) {
    if (!produced.has(digest)) {
      fail(`src/schemas/registry.ts records ${digest}, which no embedded snapshot produces`)
    }
  }
}

async function checkGeneratedTypes(snapshots) {
  for (const snapshot of snapshots) {
    const target = outputPathFor(snapshot)
    const label = relative(projectRoot, target).replace(/\\/g, '/')

    const expected = await generateTypes(snapshot)
    let committed
    try {
      committed = await readFile(target, 'utf8')
    } catch {
      fail(`${label}: missing; run \`pnpm schema:types\``)
      continue
    }

    if (committed.replace(/\r\n/g, '\n') !== expected) {
      fail(`${label}: out of date with its Schema snapshot; run \`pnpm schema:types\``)
    }
  }
}

async function main() {
  const snapshots = await checkSnapshots()
  if (snapshots.length > 0) {
    await checkRegistryDigests(snapshots)
    await checkGeneratedTypes(snapshots)
  }

  if (problems.length > 0) {
    console.error('Schema registry check failed:')
    for (const problem of problems) console.error(`  - ${problem}`)
    process.exitCode = 1
    return
  }

  const versions = snapshots.map((s) => s.version).join(', ')
  console.log(`Schema registry OK (versions: ${versions}; digests and generated types match)`)
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
