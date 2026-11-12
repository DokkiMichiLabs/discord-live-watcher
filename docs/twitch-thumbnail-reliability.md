# Twitch thumbnail reliability implementation report

## Root cause analysis

Confirmed in the original code:

- `twitchAdapter.js` formatted the Helix thumbnail template by substituting dimensions only. No stream identity or refresh key was added. Twitch's own [Get Streams example](https://dev.twitch.tv/docs/api/reference/streams/#get-streams) uses a channel-based `live_user_<login>` URL, so this resource name can be reused between broadcasts; the URL is not a broadcast identifier.
- `notificationService.js` embedded that remote URL directly. It neither fetched nor validated image responses and uploaded no persistent snapshot.
- Subsequent live polls updated database fields but never edited the Discord image. Saving the same URL again cannot refresh an existing Discord embed.
- Offline edits used `lastThumbnailUrl`, still pointing at Twitch's live preview resource. The bot had no control over its availability or content after the broadcast.
- Generic state handling overwrote thumbnail metadata on every live poll, regardless of validation. It recognized a new broadcast only after observing an offline transition; a different stream ID while still marked live did not create a new notification.

External behavior is distinguishable from these defects. Twitch [documents previews](https://dev.twitch.tv/docs/api/reference/streams/#get-streams) as frames from the last five minutes. Generation delay or CDN caching can therefore explain initially old frames. Discord can also cache external embed images. Neither production caching behavior nor a specific user's stale frame was measured here. Adding query parameters requests a distinct resource but cannot force Twitch to generate new pixels or prove their broadcast provenance.

## Implementation summary

Files changed:

| File | Change |
| --- | --- |
| `src/platforms/twitch/twitchAdapter.js` | Preserve Helix `started_at` alongside stream ID and formatted thumbnail. |
| `src/platforms/twitch/twitchThumbnail.js` | Bounded fetch, validation, cache keys, SHA-256 fingerprints and stream-specific attachment names. |
| `src/services/twitchStateService.js` | Twitch lifecycle, per-config serialization, refresh throttling, safe state persistence and offline recovery. |
| `src/services/notificationService.js` | Initial attachment upload, image-only live edits, attachment retention offline, safe upload fallback. |
| `src/services/streamStateService.js` | Route Twitch through the new handler; existing TikTok path remains intact. |
| `src/services/watcherService.js` | Fetch Twitch status inside the serialized operation using the freshly read watch configuration. |
| `src/repositories/streamWatchRepository.js` | Read a fresh config and state by ID. |
| `src/config/env.js`, `.env.example` | Add `TWITCH_THUMBNAIL_REFRESH_MS`, default 300000; require a safe integer of at least 60000. |
| `package.json`, `test/*.test.js` | Add Node's built-in test command and local regression suite. |
| `README.md`, this report | Configuration, test instructions, evidence and operational notes. |

No dependencies, database columns, migrations, storage services, or background timers were added. Existing database records are read without migration. `lastThumbnailUrl` now stores a successful Twitch attachment reference, rather than an unvalidated remote URL. The Discord message itself supplies the durable image bytes and fingerprint on restart.

### Initial live notification

Use the current Helix template and stream ID. Download only HTTPS images from Twitch's documented `static-cdn.jtvnw.net` host, without redirects. Add stream ID and request-time query keys and request cache revalidation. Apply a five-second total deadline and Axios timeout, and cap the decompressed response at 4 MiB, checking both declared length and streamed bytes. Accept JPEG/PNG content types only, with matching signatures and end markers. If both timestamps exist, reject an object whose `Last-Modified` predates the broadcast start.

Attachment filenames combine a hash of the stream ID with a SHA-256 content fingerprint. The embed refers to `attachment://<filename>` and the message uploads the bytes. The original initial role mention is retained. Invalid/missing images fall back to the Discord banner or an embed without a stream image. Definitive upload rejections (HTTP 400/403/413) get one send attempt without the attachment. Ambiguous network/send failures are propagated through the existing watcher error handling, rather than immediately resending a possibly delivered message.

### Active refresh

Watcher polls keep their existing cadence and Helix calls. At most once per configured interval, download the current preview and fetch the existing message. A matching attachment filename skips the edit. Changed bytes replace only this broadcast's thumbnail attachment; unrelated attachments are retained. The embed's title, description, timestamp, fields and streamer visuals are copied from the existing message. No message content is supplied on refresh; mention parsing is disabled and no notification is sent.

A new stream ID first marks the previous notification offline, then creates a new notification even when the previous offline period was missed. If closing the previous message fails, its durable pointer is retained and the next watcher attempt retries; the new announcement is deferred. Discord's explicit Unknown Message/Unknown Channel errors count as an already removed notification. The old attachment cannot be inherited. A return to the same already-announced ID edits the existing message back to live without sending a duplicate announcement.

### Offline preservation and failures

Offline edits fetch the message and select only an attachment matching its persisted stream ID. They retain existing attachment IDs explicitly and use the selected attachment filename in the embed. They never use Twitch's live preview URL for a Twitch offline image. For legacy messages with no snapshot, the safe fallback replaces the remote preview. A deleted attachment cannot be reconstructed from a dead Twitch URL.

The installed, lockfile-pinned Discord.js version is 14.25.1 (the manifest allows `^14.18.0`). Its `MessagePayload.resolveBody` appends new upload IDs to the explicitly retained attachment list. This behavior is exercised directly in the tests. The [Discord.js edit contract](https://discord.js.org/docs/packages/discord.js/main/MessageEditOptions%3AInterface) also defines `attachments` as the list to keep, retaining all when omitted. References stay message-local; no expiring signed CDN URL is saved as the durable reference.

Download or refresh failures retain the last successful snapshot and are retried at the next eligible interval. Offline edit failures do not block persisting `isLive: false`; failed or unavailable message edits retry at the thumbnail interval. The first offline observation after restart also attempts to reconcile an existing notification. Repeated successful offline checks do not keep editing the message during the same process lifetime.

Twitch message reads now use `force: true` to bypass Discord.js's message cache. An edit error triggers one fresh read to check whether Discord committed the replacement before losing its response. At eligible live checks, the message's current attachment reference is reconciled into database state even if the CDN download fails. Successful offline edits also persist the retained reference. Offline reconciliation is retried if its database write fails. These corrections and the tests that exposed them are detailed in [the independent review report](twitch-thumbnail-independent-review.md).

If restoring the same broadcast to live fails, subsequent eligible refreshes inspect the message's actual Status field and retry restoration even without a new image. An unchanged attachment alone does not establish that a status edit succeeded.

Operations for a given config are serialized, including status retrieval, image download, Discord mutation and database write. The config/state is re-read inside the lock; reassignment or reset observed after an awaited fetch abandons the stale operation. A queued offline check runs after any in-flight refresh and leaves the message offline with the latest successfully uploaded image. Failures release the lock. TikTok continues through its original lifecycle.

## Validation results

- `npm test`: 43 tests passed, zero failures, including nested HTTP failure cases, after the independent review corrections.
- Tests cover current Helix URL/ID propagation, new broadcasts, missed offline gaps, five-minute throttling, unchanged images, failed downloads, stale CDN timestamps, unsafe URLs, invalid MIME/body, truncated and oversized responses, timeout handling, initial upload fallback, ambiguous send failures, offline attachment retention, refresh/offline edit failures, retry throttling, concurrent refresh/offline operations, config reassignment, restart with legacy URLs, same-ID deduplication, role behavior, and production TikTok dispatch.
- HTTP tests use a mocked Axios adapter or injected response streams. A localhost-only HTTP server exercises actual Axios streaming, size rejection and the five-second total deadline. Discord interactions and Prisma repository calls are mocked; Discord.js embed/file serialization itself runs for real.
- No production credentials, real Twitch requests, real Discord notifications, or database connections are used by the tests.
- Prisma client generation completed locally. No migration was generated or run.
- `node --check`: all 23 JavaScript source/test files passed. `prisma validate`: passed using a dummy local database URL, without connecting to a database.
- `git diff --check` with `cr-at-eol` (matching the existing committed CRLF convention): passed. The diff contains only the thumbnail implementation, tests, example configuration and documentation. No credential files, database schema, migrations or lockfile were changed. The pre-existing untracked `.idea/` directory was left untouched.

## Operational considerations and remaining limitations

- **Twitch impact:** No additional Helix requests. One CDN request at initial detection and at most one per refresh interval per live watch; default approximately 12 per hour. Repeated watches of one streamer are independent, matching existing architecture.
- **Discord impact:** One normal initial send with attachment. Up to 12 changed-image edits per hour per live watch; unchanged bytes skip edits. Refreshes also read the channel/message. Offline recovery checks occur once after restart and retry failures at the configured interval. Rate limiting remains managed by Discord.js.
- **Memory/storage:** At most 4 MiB per accepted image; chunk assembly and upload may temporarily hold several copies. Watcher configs are processed sequentially. No image buffers are cached across polls or written to disk. Throttle metadata is capped at 10,000 entries, and completed operation locks are removed. Discord retains one current snapshot per notification; replacing it removes that broadcast's earlier attachment from that message. Historical notification messages retain their own snapshots.
- **Restart:** Throttle metadata is deliberately process-local. Each live watch may attempt one immediate refresh after restart, then resumes interval throttling. The message's attachment fingerprint prevents redundant uploads. No previous broadcast's buffer or remote URL is restored. A crash between sending a message and persisting its ID retains the application's existing non-atomic send/database limitation.
- **Concurrency:** Serialization covers one bot process. Run one watcher replica, as in the existing deployment model. Multiple replicas would require shared coordination beyond this bounded change. Command edits cannot be made atomic with external Discord operations; rechecks narrow that race but do not provide distributed transactions.
- **Freshness:** Cache busting and timestamp checks cannot prove image provenance when Twitch serves old pixels without reliable metadata. A valid CDN image may initially be old, and five-minute updates remain approximate. Exact byte hashes suppress identical responses; visually identical re-encodings may still produce an edit. Content validation checks MIME/signatures/end markers, not a full image decode. Only documented-host JPEG/PNG previews are accepted; unsupported formats/hosts use the safe fallback until reviewed.
- **Availability:** A deleted Discord message/attachment, revoked permissions, or unavailable Discord service cannot be repaired by preserving a reference. Refresh errors are logged with config/stream IDs, without HTTP request objects or tokens. An unknown initial-send outcome is not immediately retried with another message; the next watcher pass follows existing retry behavior.
- **Deployment:** No deployment was performed. Review this diff, retain one watcher replica, install existing lockfile dependencies, run Prisma generation and tests, and optionally set `TWITCH_THUMBNAIL_REFRESH_MS=300000`. Existing Docker startup/migration behavior needs no changes. The existing lockfile install reported 17 dependency vulnerabilities (5 moderate, 11 high, 1 critical); dependency remediation was outside this task and the lockfile was left unchanged.
- **Rollback:** Restore the previous application revision and restart. No schema rollback, data migration or external storage cleanup is needed. Already posted Discord attachments remain attached to their messages.
