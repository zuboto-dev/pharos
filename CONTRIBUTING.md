# Contributing to Pharos

Thanks for helping improve Pharos. Before changing code, read [README.md](README.md) for setup and
the `docs/` pages for the product scope and architecture. [CLAUDE.md](CLAUDE.md) records repository
conventions. Use the Node.js version required by the README and the pinned pnpm version, 12.9.1.

## Set up the project

```sh
pnpm install --frozen-lockfile
pnpm dev
```

The web app is at <http://localhost:5173>; the server is at <http://localhost:4300>. By default,
Pharos stores data in `~/.pharos/pharos.db`. To keep development data separate, set `PHAROS_DB` to
another path when starting the app, for example in a POSIX shell or WSL:

```sh
PHAROS_DB=/tmp/pharos-dev.db pnpm dev
```

## Validate changes

Run the checks that cover your change before opening a pull request:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm format:check
```

For a focused test run, use the relevant workspace package, such as
`pnpm --filter @pharos/web test` or `pnpm --filter @pharos/server test`. The workspace packages are
`@pharos/schema`, `@pharos/server`, and `@pharos/web`.

## Add a view catalog component

The schema is the source of truth for view nodes and component props:

1. Add the component's strict Zod schema in `packages/schema/src/views/catalog.ts` and include leaf
   nodes in `LEAF_NODES`. This supplies the catalog entry and inferred `ComponentName` and `NodeOf`
   types. Add descriptions to props that agents configure.
2. Add an entry to `packages/schema/src/views/catalog-info.ts`: its category, when to use it, minimum
   and suggested board widths, and a valid example node. This guidance is used by the MCP catalog
   and the web app's resize controls.
3. Implement leaf components in the relevant file under `apps/web/src/catalog/components/` and
   register them in `components/index.ts`. The layout nodes `Grid`, `Section`, and `Tabs` are
   rendered in `apps/web/src/catalog/renderer.tsx` instead.
4. Add a representative node to `SAMPLES` in `apps/web/src/catalog/renderer.test.tsx`. The test
   checks that every catalog node has a sample, validates it against `ViewNode`, and renders each
   sample with populated and empty data. Reuse `apps/web/src/catalog/__fixtures__/dataset.json`;
   extend it only when the component needs data the current fixture does not provide.
5. If the component changes a built-in view, update the relevant template in
   `packages/schema/src/views/templates.ts` and its expected tests as well.

View specs should describe how to display data, not copy project records into the spec. Components
read the shared project data from `useViewData()` and use the schema query helpers such as
`runQuery` for filtered data.

All checked-in fixture data should be synthetic. Keep fixtures small and representative, and do not
copy records or identifiers from a real project into tests.

## Create or change a view

Built-in starting layouts live in `packages/schema/src/views/templates.ts`. A project stores its
views as `view` entities: a view can use a built-in `template`, while a saved `spec` customizes that
view and takes precedence. Change a template when changing the shared default; use the MCP tools
for project-specific tabs. `view_create` creates a persistent tab, `view_update` changes one or
resets it to its template, and `view_answer` creates an answer view that expires after seven days
by default (`expiresInDays`, 1 to 90) unless kept.

When designing or editing a project view:

1. Read `pharos://guide/views`, `pharos://guide/catalog`, and `pharos://examples/answers`. Call
   `catalog_list` for the component overview, then `catalog_describe` for the exact props and example
   nodes of the components you plan to use. Boards have 12 columns; follow each component's minimum
   and suggested widths.
2. Use `view_list` to find the relevant tab and `view_get` to read its current board before an
   update. Prefer small `view_update` operations (`add`, `update`, `move`, or `remove`) so you
   preserve existing widget IDs and layout. Keep IDs stable across edits; they identify widgets
   within the board.
3. Bind widgets to live project data with catalog queries and filters. Do not hand-copy entity
   names or counts into a view when a query or live `Text` value can keep it current. For new
   components, interpret customizable statuses and other options by their meaning: use
   `meaningOf`/`valueFor` in schema code or `useOptions().meaning`/`useOptions().valueFor` in the
   web app, rather than comparing values to built-in labels. Query helpers already match option
   values or meanings.
4. Read the preview returned by `view_create` or `view_update`. Use `view_preview` with draft
   widgets before saving when useful. Check for unknown fields, unintended empty widgets, and width
   warnings, then correct the board before calling it ready.

## Change the data model or database

Define entity types, fields, defaults, references, and delete behavior in
`packages/schema/src/entities.ts`. Entity data is stored as JSON, and writes go through
`Store.apply` so they are recorded in revision history. Add or update schema and store tests for
new fields, defaults, validation, and reference behavior.

For a SQLite table or index change, append a new SQL entry to `MIGRATIONS` in
`apps/server/src/store/database.ts`. Treat existing entries as immutable: databases record the
applied migration count in `PRAGMA user_version`. Add a migration test in
`apps/server/src/store/database.test.ts` that opens a database at the previous version and checks
the upgrade, including preservation or backfilling of existing data where relevant. Use
`openDatabase(':memory:')` or a temporary file for isolated database tests.

Server TypeScript uses NodeNext resolution, so relative imports include the `.js` extension. If a
new dependency needs an install build script, allow it in `pnpm-workspace.yaml`.

## Submit a change

Keep changes focused on one issue or user need. For broader work, use the repository's issue
templates to describe the problem and agree on scope before splitting it into implementation work.
Open a reviewable pull request with a clear description of the behavior and reason for the change,
and list the checks you ran. Include screenshots for changes to the web interface. Follow the
[Code of Conduct](CODE_OF_CONDUCT.md); report security issues using the process in
[SECURITY.md](SECURITY.md).

## License

Pharos is licensed under MIT. See [LICENSE](LICENSE) for the terms that apply to contributions.
