import schemaV01 from './v0.1/flow-model.schema.json'

/**
 * A read-only Schema snapshot bundled with the viewer.
 *
 * The selected folder is never allowed to supply a replacement schema: a
 * config directory must not be able to change the rules the viewer validates
 * with (DESIGN.md 6.4). `sha256` is the digest of the snapshot file exactly as
 * committed, and is verified by `pnpm schema:check`.
 */
export interface SchemaSnapshot {
  /** Value of the top-level `schema_version` this snapshot accepts. */
  readonly version: string
  readonly schemaId: string
  /** Where the snapshot was copied from, for upgrade traceability. */
  readonly upstream: string
  readonly sha256: string
  readonly schema: Record<string, unknown>
}

export const SCHEMA_SNAPSHOTS: readonly SchemaSnapshot[] = [
  {
    version: '0.1',
    schemaId: 'https://ardupilot.org/schema/business-flow/0.1/flow-model.schema.json',
    upstream: 'arducopter-flow-model/schema/flow-model.schema.json',
    sha256: '34e540276302ebb56860632cef30da72a48b83744ea5becd7d99f449cb3fdaeb',
    schema: schemaV01 as Record<string, unknown>,
  },
]

export const SUPPORTED_SCHEMA_VERSIONS: readonly string[] = SCHEMA_SNAPSHOTS.map((s) => s.version)

/** Newest supported version, shown on the welcome page. */
export const LATEST_SCHEMA_VERSION: string =
  SUPPORTED_SCHEMA_VERSIONS[SUPPORTED_SCHEMA_VERSIONS.length - 1] ?? ''

const SNAPSHOTS_BY_VERSION: ReadonlyMap<string, SchemaSnapshot> = new Map(
  SCHEMA_SNAPSHOTS.map((snapshot) => [snapshot.version, snapshot]),
)

export function findSchemaSnapshot(version: string): SchemaSnapshot | undefined {
  return SNAPSHOTS_BY_VERSION.get(version)
}

export function isSupportedSchemaVersion(version: string): boolean {
  return SNAPSHOTS_BY_VERSION.has(version)
}

/**
 * Reads the declared `schema_version` from an already parsed YAML document.
 * Returns `null` when the document is not an object or carries no string
 * version, which the caller reports as `UNSUPPORTED_SCHEMA_VERSION`.
 */
export function extractSchemaVersion(document: unknown): string | null {
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    return null
  }
  const raw = (document as Record<string, unknown>)['schema_version']
  if (typeof raw === 'string') {
    return raw
  }
  // YAML parses a bare `0.1` as the number 0.1, which is not a supported form.
  if (typeof raw === 'number') {
    return String(raw)
  }
  return null
}
