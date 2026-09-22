/**
 * Build-time constants the configuration is not allowed to influence.
 *
 * Everything here is fixed when the bundle is built. A YAML file in the chosen
 * folder may supply a `path`, a `revision` and line numbers, but it can never
 * choose the host those become a link to (DESIGN.md 18).
 */

/**
 * GitHub base used to build pinned-SHA source links.
 *
 * A link is only ever `{base}/blob/{sha}/{path}#L{start}-L{end}`, so the worst a
 * malicious or mistaken configuration can do is point at a path that does not
 * exist inside this one repository.
 */
export const GITHUB_BASE: string =
  import.meta.env.VITE_GITHUB_BASE ?? 'https://github.com/ArduPilot/ardupilot'
