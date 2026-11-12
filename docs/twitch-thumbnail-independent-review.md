# Twitch thumbnail reliability: independent review

## Recommendation

**GO for controlled staging integration testing**, after review of the local fixes below. This is not production approval or authorization to send messages now. No deployment or live integration testing was performed.

The review confirmed four defects across the initial pass and subsequent re-check. Targeted tests first demonstrated failures against the corresponding pre-fix implementations, and pass after narrow corrections. File/line references below point to the corrected working-tree locations, rather than an immutable commit: the implementation was already uncommitted when this review began.

## Confirmed findings and corrections

### P1: Missed offline interval orphaned a live notification

Reference: `src/services/twitchStateService.js:70` (retirement before sending/replacing persisted message IDs).

On stream ID A → B, the handler announced B and overwrote A's message pointer without editing A offline. The original rollover test asserted B's creation and lack of inherited imagery, but never examined A. Extending that test reproduced A remaining `Live` indefinitely.

Correction: close A using its own persisted title, URL, stream ID and attachment before announcing B. If the edit fails or the message is unavailable for an unconfirmed reason, retain A's durable pointer and let the watcher retry. Do not lose the only recoverable reference to A. Explicit Discord errors 10008 (Unknown Message) and 10003 (Unknown Channel) identify notifications that no longer exist and allow rollover to continue (`src/services/notificationService.js:139`). The follow-up tests cover rollover edit failure, restart recovery and an already deleted old message.

Tradeoff: a permission failure or Discord outage affecting A can defer B's announcement until A can be closed; no unbounded background job or extra schema was introduced. The previous notification may remain temporarily live while Discord rejects edits, but it is no longer permanently orphaned by a successful pointer overwrite. Retry uses the existing watcher cadence.

### P2: Cached attachment IDs could prevent offline recovery after an ambiguous edit

References: `src/services/notificationService.js:150`, `src/services/notificationService.js:204`, `src/services/notificationService.js:228`.

The original message fetch supplied only an ID. The installed Discord.js `MessageManager._fetchSingle` returns a complete cached message by default (`node_modules/discord.js/src/managers/MessageManager.js:102`). If Discord commits the replacement but the edit response is lost, the cache may still describe the removed attachment. A subsequent offline edit could then retain an invalid attachment ID or reference the removed filename. The original mock always returned current shared objects, masking this distinction.

Correction: Twitch message reads explicitly use `{ message: id, force: true }`. On an edit error, perform one fresh read to determine whether the new named attachment and matching embed already exist, accepting that confirmed result without another upload. Otherwise preserve the prior database reference and let normal throttled recovery continue. The test mock can now retain a stale cached snapshot, simulate a server commit followed by a lost response, and reject nonexistent retained attachment IDs. The added test demonstrates an offline edit using the actual replacement image and valid IDs, rather than the cached removed attachment.

### P2: Persisted references were not reconciled when Discord had a newer snapshot

References: `src/services/twitchStateService.js:28`, `src/services/twitchStateService.js:80`, `src/services/notificationService.js:187`, `src/services/notificationService.js:212`.

A replacement could succeed and remove the previous attachment, then its database write could fail. After restart, a failed CDN download skipped `refreshImage` entirely, retaining `lastThumbnailUrl` for the removed attachment. Offline editing selected the current image from the message correctly when its reads were fresh, but did not write that reference back to state. The added restart/database-failure test reproduced the old reference surviving despite a valid newer message attachment.

Correction: eligible live checks reconcile attachment metadata even when no new image downloads. This is a message read, not another image download or unnecessary edit. A matching attachment supplies its `attachment://filename` reference; an absent attachment clears the stale reference; an unavailable read leaves prior metadata intact. Twitch offline edits return the retained reference for persistence, while the TikTok return/mention behavior remains unchanged. The offline completion marker is reset if persistence fails, so reconciliation can retry without another process restart (`src/services/twitchStateService.js:37`). A targeted database-failure test also covers this recovery boundary.

### P2: Rejected same-broadcast live restoration left the embed stuck offline

References: `src/services/notificationService.js:211`, `src/services/notificationService.js:233`; regression: `test/twitchThumbnails.test.js:441`.

The subsequent re-check exercised live → offline → live for the same stream ID with an existing valid attachment. If the edit restoring the live status was rejected, detection still correctly persisted `isLive: true`. The edit-error reconciliation accepted the unchanged attachment as evidence of success without checking status. Later refreshes skipped the edit based on detection state and unchanged or unavailable image bytes, leaving the message offline indefinitely.

Correction: inspect the freshly fetched embed's Status field when deciding whether live status needs restoration. A later eligible check retries an offline embed even if detection state is already live and no image downloads. Error reconciliation requires the freshly read message to show Live as well as the expected attachment/reference. This preserves the existing attachment, announcement count and mention suppression. The added test failed before this correction and passes afterward; it verifies recovery without a replacement image or new announcement.

## Requested scenario assessment

| Scenario | Existing evidence | Added verification and result |
| --- | --- | --- |
| Upload/edit failure with a previous valid attachment | Existing failed refresh/offline test verified monitoring proceeds and the old saved URL survives a rejected edit. | `test/twitchThumbnails.test.js:178` verifies old bytes, embed and persisted reference remain consistent, then converge to a new image at the interval without another send. Lines 215, 235 and 253 cover database failure and a lost response after a committed replacement. |
| Successful replacement removes previous attachment | Existing active-refresh test checked a single attachment remained; generic `MessagePayload` test checked retained IDs plus upload ID. | `test/twitchThumbnails.test.js:197` exercises the actual refresh payload through installed Discord.js serialization: old thumbnail ID excluded, unrelated ID retained, upload ID `0` present, and embed `attachment://` filename equals the multipart upload filename. No replacement-retention defect was found in the normal successful path. |
| Offline while downloading/refreshing | Existing concurrent test (`test/twitchThumbnails.test.js:386`) pauses image retrieval and queues an offline observation. | `test/twitchThumbnails.test.js:317` pauses the Discord edit itself, covering both successful and rejected replacements. The final persisted state and embed are offline, with the last successful attachment, and only one announcement. Existing per-config serialization was sufficient; no concurrency architecture change was needed. |
| New ID without observed offline interval | Existing rollover test checked only new message/thumbnail isolation. | Extended test at line 161 verifies the old embed is offline and retains its own attachment. Lines 271 and 288 verify failure/restart recovery and deleted-message handling. Confirmed defect fixed. |
| Restart and attachment references | Existing unchanged-image restart and legacy-URL tests. | Lines 215 and 299 verify recovery from newer message metadata and real-shaped Discord CDN image URLs. Offline references are rebuilt from actual stream-specific attachment filenames, rather than expiring signed URLs or in-memory buffers. |

The source/test line references are stable for this review's final working tree. Existing role mention, deduplication and production TikTok dispatch tests were reused and remain passing.

## Tests and local verification

- Added ten top-level targeted tests across both passes, including one with two nested outcomes; extended the existing stream-ID rollover test. Overall test count increased from 31 to 43 (Node includes nested tests in this count). The subsequent re-check added only the rejected same-broadcast restoration test and its confirmed fix.
- Mock improvements distinguish stale cache from server state, simulate commit-before-response-loss, and reject invalid attachment retention. These represent explicit failure assumptions; they do not establish live Discord server behavior.
- `npm test`: **43 passed, zero failed**. Twitch HTTP, Discord and database interactions are mocked; only the existing Axios transport test opens a localhost-only HTTP server.
- `node --check`: all 23 JavaScript source/test files passed.
- Prisma client generated locally; schema validation passed with a dummy URL, without connecting to a database.
- Diff whitespace validation passed using `cr-at-eol`, matching existing committed line endings.
- Changes during this review are limited to `src/services/notificationService.js`, `src/services/twitchStateService.js`, `test/twitchThumbnails.test.js`, the implementation report and this review report. No dependencies, lockfile, schema, migrations, storage services or credentials were changed. Pre-existing unrelated files were left alone.

## Remaining risks for controlled staging validation

1. Confirm real Discord accepts the multipart replacement payload, rewrites embed image URLs as expected, retains the new attachment after the old one is removed, and still renders it following an offline edit and a complete bot restart. Local tests establish serialization and application intent; they cannot prove Discord's renderer/CDN retention.
2. Exercise an isolated test channel's missing permissions, removed messages and attachment upload rejections. Confirm the expected numeric Unknown Message/Unknown Channel codes and that rollover deferral/recovery behaves acceptably. Definitive rejection and ambiguous network outcomes differ.
3. Observe Twitch thumbnail generation timing, actual JPEG content types, cache headers, `Last-Modified` behavior, and post-offline preview expiry using staging-only credentials. Cache keys cannot force new pixels or prove provenance when upstream metadata is missing. Image validation remains MIME/signature/end-marker checking, not full decoding.
4. Offline status is known only after the next successful poll. The watcher does not re-query Helix during an individual image download. Serialization guarantees the final state after an observed/queued offline check; it cannot instantly detect a physical stream end while a request is in flight. Discord outages can delay the actual offline edit.
5. Run one bot replica. In-process serialization does not coordinate multiple instances. External Discord mutations and database writes are not transactional. Initial sends can still be duplicated across an ambiguous send/crash before the message ID is persisted; this pre-existing architectural limitation was not expanded into a new storage design.
6. If an edit succeeds, its state write fails, and subsequent Discord reads also fail, metadata reconciliation waits until a successful fresh read. The message itself remains the authoritative image snapshot; there is no independent byte backup for a deleted attachment.

These risks warrant controlled staging observation before any production decision. They do not block staging testing after the demonstrated local fixes. No staging action has been taken by this review.
