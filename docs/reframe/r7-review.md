# File safety review

2026-10-12 · written by GPT-6.1-Sol · commit 8ac4e8f

**Verdict: the file feature does not yet meet its privacy and folder-boundary promises.**
Agents can obtain hidden records and file contents through the local HTTP API, and the agent
text tool can read credential files through a renamed link. Folder replacements can also make
Pharos read outside the folder originally approved. Fix these before adding private documents.

The evidence is three new regression suites: [paths and responses](../../apps/server/src/files/protections.test.ts),
[request checks](../../apps/server/src/files/request-protections.test.ts), and
[agent visibility](../../apps/server/src/store/agent-file-protections.test.ts). They use temporary,
made-up files, an in-memory database and `app.request()`; no listening server or owner data.
Confirmed gaps deliberately fail the expected protection. Production code was left unchanged.

## Gaps, highest severity first

1. **High — agents can use the owner's HTTP read routes.** With
   `X-Pharos-Author: agent:…`, entity lists/get, project data, history, revisions and differences
   return hidden files and disk paths. With matching browser headers, file routes return hidden
   contents and contents from a Details folder; scan suggestions reveal unadded names.
   **Reproduce:** the agent-labeled REST tests, including the Details text canary.
   **Fix:** apply `AgentFiles` to every agent HTTP response in `app.ts`; refuse agents on owner-only
   file, folder-list and scan routes. The author header is a declared role, not authentication;
   stronger guarantees against impersonation need separately authenticated owner/agent access.

2. **High — the text tool reads excluded secrets.** Replace an added ordinary `.txt` file with
   an in-folder link to `.env` or `credentials.json`. `file_read_text` returns the secret;
   `readAgentFileText` checks containment but skips the browser reader's name checks.
   **Reproduce:** both MCP alias regressions.
   **Fix:** share the safe reader with `FileService`, checking both recorded and resolved names,
   the resolved text type, folder permission and a safely opened descriptor before reading.

3. **High — approval does not survive disk changes.** Replace the approved root with a link
   outside: scanning lists new outside names and serving returns outside bytes. Replace a parent
   directory between resolution and opening: outside bytes again. `O_NOFOLLOW` protects only the
   final file, not its parents (`safety.ts:127`, `service.ts:233`, `scan.ts:200`).
   **Reproduce:** root-replacement tests and the deterministic pre-open directory swap.
   **Fix:** pin the approved root's canonical identity and reject replacement; traverse/open
   relative to directory descriptors with symlink restrictions on every ancestor. Use that same
   mechanism for scans, hashing and agent reads. Another string check alone leaves a race.

4. **Medium — local source links carry hidden information into agent views.** Sanitization
   removes a hidden `artifact.fileId` but retains its absolute `uri`. Source-linked claims,
   quotes and term explanations copied from that hidden file remain visible through MCP reads,
   snapshots and previews.
   **Reproduce:** artifact-path and explicitly source-linked text regressions.
   **Fix:** redact every local artifact URI; derive artifact visibility from both `fileId` and
   local URI, then propagate hidden-source restrictions through claims, terms, history and
   preview datasets. Redact literal source quotations when the source permits Details only.

5. **Medium — credential backups and some credential names are allowed.**
   `credentials.json.bak`, `server.pem.bak`, `terraform.tfstate.backup` and `credentials.csv`
   are scanned and downloaded. The exclusion checks only the final extension and a narrow set
   of credential-name suffixes (`safety.ts:61–96`).
   **Reproduce:** the four credential-name scan/download cases.
   **Fix:** recognize backup suffixes before applying secret-extension rules and reject exact
   credential-name stems with CSV and backup extensions; share these rules across all readers.

6. **Medium — browser checks are incomplete.** Folder-list and artifact-file GETs answer
   requests with no browser proof or a foreign local Origin. A folder-level downgrade also
   bypasses the checks. Guarded file routes compare host/port only, accepting the wrong scheme
   when fetch metadata is absent.
   **Reproduce:** request matrices cover each route and method, including HEAD and actions.
   **Fix:** mount the common browser guard on every folder and artifact-file route, including
   downgrade PATCH; compare complete URL origins (scheme, host and effective port).

7. **Medium — deleting a project bypasses the file-removal rule.** Agent `apply` refuses an
   explicit file deletion but accepts project deletion, which removes its hidden and visible
   file records by cascade (`store.ts:851`). The disk files remain; their project records vanish.
   **Reproduce:** the agent project-delete regression checks rejection and record survival.
   **Fix:** authorize the complete deletion closure inside the transaction, rejecting any agent
   operation that removes a file record, including indirect deletions and undo operations.

8. **Medium — disclosure checks miss messages and errors.** A mixed revision keeps its
   hidden filename in the message after hidden changes are removed. A permission-denied text
   read exposes its absolute path because `openSync` is outside the redacting error handler
   (`agent-files.ts:170,275`). An agent's project-undo conflict also names a hidden file in the
   HTTP error's `issues` list (`store.ts:722`).
   **Reproduce:** mixed-history/changes, unreadable-text and REST project-revert regressions.
   **Fix:** substitute a neutral agent message whenever hidden changes are removed, and catch
   open/read/close failures behind a generic path-free refusal. Sanitize transaction conflict
   details for the requesting author before returning them.

## Protections confirmed

- Literal climbs, absolute paths, backslashes, NUL and dot-parts are rejected. Stored percent
  escapes are not decoded into paths; composed/decomposed Unicode and lookalikes stay literal.
- Static escaping file/folder links, links changed after a scan, and links to dotfiles are
  refused by browser serving. The final-file swap is stopped by `O_NOFOLLOW`.
- HTML, SVG and scripts are attachments with an allowlisted type and safe headers. Disguised
  HTML served as text stays text; a PDF alias targeting HTML becomes an octet-stream download.
  Hostile filename characters are encoded safely. Reveal/Open receive one absolute path
  argument without a shell; unapproved extensions are refused.
- Folder creation resolves aliases and rejects nested, system, home and dot-folder roots.
  Declared agents and nonbrowser calls cannot add folders or widen access through folder writes.
- Direct MCP file reads/list/get/history hide hidden files and strip location fields. Details
  contents, explicit file create/delete/move, and undo that recreates or repoints a file are
  refused. Requests lose their hidden-file context. These controls do not close the gaps above.

**Verification:** `npx pnpm@12.9.1 typecheck`, `lint` and `format:check` pass. The required
`test` run fails on the new regressions; its initial parallel run also had existing web and
evaluation-test failures. Rerunning server and web suites with `--maxWorkers 1` passes all
236 existing server tests and 272 web tests; the 53 schema tests pass too. The 58 new tests
have **30 expected failures and 28 passes**. No confirmed gap has been fixed by this review.
