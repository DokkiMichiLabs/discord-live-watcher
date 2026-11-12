# Isolated Twitch/Discord integration test readiness

## Assessment and recommendation

**GO for controlled integration testing using the dedicated local launcher, once the manual resource checks below are completed.** With the placeholder file unchanged, startup is intentionally NO-GO: no usable test credentials or resources have been configured or verified. This assignment performed no live integration test, deployment, database migration, resource creation, or real notification.

Use a separate working copy containing the reviewed changes, a separate Discord application/bot installed only in a private test guild, a fresh local PostgreSQL instance/role/database, and independent test Twitch application credentials. Do not copy production `.env` files, tokens, application secrets, database dumps, watch records, message IDs or Euler subscriptions. Do not attach a test process to the production process manager. The production instance can remain running independently.

### Startup and database findings

`src/index.js` constructs a Guilds-intent Discord client and logs in immediately when imported. On ready, it connects Prisma and starts monitoring. Both watcher implementations perform their first tick immediately; startup is not a passive dry run. Originally both watchers and a webhook listener always started. Euler disabled alone did not disable TikTok polling or the HTTP listener.

Prisma uses PostgreSQL. Its schema contains `StreamWatchConfig`, its one-to-one `StreamWatchState`, and the Twitch/TikTok platform enum. Normal Node startup connects and subsequently reads/writes state; it does not run migrations or copy data. The existing Docker entrypoint **does** run `prisma migrate deploy` automatically; do not use that entrypoint for this runbook. The dedicated launcher has separate explicit migration, seed and startup actions.

`DISCORD_GUILD_ID` configures slash-command registration; it is **not** a runtime watcher filter. Watchers select all active records of their platform from the configured database and use the stored notification channel/message IDs. This is why a separate empty database and a single-watch preflight are essential. No production database/channel address is hardcoded. The Prisma client now explicitly uses the URL resolved by the application configuration.

### Role mentions and shared services

The legacy role ID `1466589257933127703` remains the default when `DISCORD_NOTIFICATION_ROLE_ID` is omitted. A role mention resolves within the destination guild; a truly separate guild would not contain that production role. A wrong destination/token/database could still expose production users. The isolated launcher therefore requires an explicitly **blank** role setting, causing initial sends, upload fallbacks and offline edits to use empty content and disabled mention parsing. Refresh edits already suppress mentions. Production role content and defaults remain unchanged.

Shared resources to avoid are Discord bot identity/session, guild membership and command registration, PostgreSQL credentials/data/forwarded ports, Twitch application credentials/quota, Euler account/alerts/targets/signing key, public webhook routes/tunnels, and inherited shell credentials/proxy/preload settings. OAuth tokens and throttle/image metadata are process-local; there is no external object store. Dependency downloads still contact package/Prisma distribution services during setup. Live tests would contact Discord gateway/API/CDN and Twitch OAuth/Helix/CDN; TikTok and Euler must remain disabled.

## Minimal changes

- `TIKTOK_WATCHER_ENABLED` and `WEBHOOK_SERVER_ENABLED` default to `true`, preserving existing production startup. Test settings explicitly disable both. `EULER_ALERTS_ENABLED=false` separately prevents command-driven Euler subscription changes.
- `DISCORD_NOTIFICATION_ROLE_ID` defaults to the existing role if absent; blank disables mention content/parsing.
- `DOTENV_CONFIG_PATH` selects an explicit application env file; ordinary startup still defaults to `.env`.
- `scripts/integration-local.js` loads and validates `.env.test` directly. Its child receives only that file's allowed settings and OS essentials: inherited app secrets, `NODE_OPTIONS`, Prisma overrides and proxies are excluded. The DB helper also sanitizes its own environment before importing application/Prisma code, so direct helper invocation cannot silently inherit another database URL.
- The launcher restricts the database to loopback port `5433`, database/role `discord_live_watcher_integration`, and the public schema. It rejects remote hosts, other databases/roles/ports, endpoint query overrides, nonblank role/Euler settings, placeholders, and enabled shared services. No errors print credential values.
- `seed` creates one Twitch config and state only if no watch records exist. Repeating it preserves matching state; any other rows cause failure. `start` rechecks exactly one matching active Twitch record, rejects Euler IDs or a saved notification channel outside the test channel, then imports the bot. It does not seed or migrate automatically.
- `.env.test` is ignored by Git and Docker. No dependencies, production defaults, schema changes, migrations or storage services were added.

The launcher is a configuration guard, not a sandbox or proof of resource ownership. It cannot recognize a production token pasted into a test field or detect that a loopback port forwards to production. Verify ownership and endpoint routing manually. Do not change watch records or issue management commands during a run; the single-watch check occurs at startup, not on every tick.

## Configuration inventory

The safe template is [`.env.test.example`](../.env.test.example). All credentials, identities and the streamer are placeholders; literal booleans, intervals and blank settings are intentional safe controls.

| Setting | Separate-instance requirement |
| --- | --- |
| `DISCORD_TOKEN` | New test bot token, never the production bot's token. |
| `DISCORD_CLIENT_ID` | Test Discord application's ID, matching that bot. Required by existing config even without command deployment. |
| `DISCORD_GUILD_ID` | Private test guild ID; not a watcher filter. |
| `TEST_DISCORD_CHANNEL_ID` | Only destination for this run. Bot should have access only to the test guild/channel. |
| `TEST_DISCORD_USER_ID` | Test guild user's ID used for the watch association and optional avatar/banner. |
| `TEST_TWITCH_USERNAME` | Exactly one lowercase login, not a URL or list. |
| `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET` | Independently provisioned test Twitch application's credentials. |
| `DATABASE_URL` | Fresh local PostgreSQL database and non-superuser role on port 5433, using the template's exact database/role name. URL-encode the new local password. |
| `DISCORD_NOTIFICATION_ROLE_ID` | Must be present and empty. |
| `TIKTOK_WATCHER_ENABLED`, `WEBHOOK_SERVER_ENABLED`, `EULER_ALERTS_ENABLED` | Must each be `false`. |
| `EULER_API_KEY`, `EULER_ACCOUNT_ID`, `EULER_WEBHOOK_SECRET`, `PUBLIC_BASE_URL` | Must each be present and empty. |
| `TWITCH_WATCH_INTERVAL_MS` | `60000`; independent from production timers. Launcher requires at least 60000. |
| `TWITCH_THUMBNAIL_REFRESH_MS` | `300000`; optionally reduce to `60000` for one bounded test run. Keep a five-minute run to verify normal cadence. |
| `NODE_ENV` | Template uses `production` for structured logs; this does not choose credentials/resources. |
| `DOTENV_CONFIG_PATH` | Assigned by launcher to the absolute test-file path. Do not add it to the test file. |
| `WATCH_INTERVAL_MS` | Legacy fallback; not needed because the test Twitch interval is explicit. |
| `WEBHOOK_PORT`, `PORT`, `EULER_WEBHOOK_PATH` | Unused with the listener disabled; omit. |
| `TIKTOK_DAILY_BUDGET`, `TIKTOK_MIN_INTERVAL_MINUTES`, `TIKTOK_MAX_INTERVAL_MINUTES`, `TIKTOK_IDLE_INTERVAL_MS`, `TIKTOK_RATE_LIMIT_BACKOFF_MS`, `TIKTOK_PER_STREAMER_DELAY_MS`, `TIKTOK_OVERLAP_RETRY_MS`, `TIKTOK_FAILURE_RETRY_MS`, `TIKTOK_UNKNOWN_LIVE_GRACE_MS` | Unused with TikTok disabled; existing defaults remain unchanged. Omit from the isolated file. |

## Exact local preparation and validation

These commands are instructions for a future operator; resource provisioning and all DB/live commands below were **not executed** in this assignment. Run from the root of the separate working copy in PowerShell. Use Node 22 or later, matching the existing deployment base, and a separate locally managed PostgreSQL server bound to loopback port 5433. Verify no SSH/Docker proxy/tunnel sends that port to any shared database.

First verify the code-only working copy has no production `.env`. Do not inspect/copy a production file; if one exists, choose another clean working copy. Then install the existing lockfile dependencies and run offline checks:

```powershell
if (Test-Path -LiteralPath .env) { throw 'Use a separate code-only working copy without .env' }
npm ci --ignore-scripts
$env:DATABASE_URL = 'postgresql://unused:unused@127.0.0.1:1/unused'
npx prisma generate
npx prisma validate
npm test
$files = rg --files src scripts test -g '*.js'
foreach ($file in $files) { node --check $file; if ($LASTEXITCODE -ne 0) { throw "Syntax failed: $file" } }
if (!(Test-Path -LiteralPath .env.test)) { Copy-Item -LiteralPath .env.test.example -Destination .env.test }
```

Do not overwrite an existing `.env.test` on repeat runs. Edit that file locally using only independently provisioned test values. Avoid putting secrets in command-line arguments, shared logs or version control. The launcher replaces the dummy `DATABASE_URL` inherited from this shell with the file's validated URL.

Manually confirm in Discord's test application/guild settings: token/application identity match, bot is installed only in the private test guild, and channel/user IDs belong there. Give the test bot View Channel, Send Messages, Embed Links, Attach Files and Read Message History in that channel; do not give Administrator or Mention Everyone. No slash commands are required: the local seed replaces `/set-stream`. Do **not** run `npm run deploy:commands`; that sends a real registration request for the supplied application/guild.

Provision only the dedicated local role/database on the independently verified local PostgreSQL server. Connect using its local admin (substitute the local admin username):

```powershell
psql -h 127.0.0.1 -p 5433 -U YOUR_LOCAL_TEST_ADMIN -d postgres
```

In that interactive local session, run once (no production connection, no restore/import):

```sql
CREATE ROLE discord_live_watcher_integration LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
\password discord_live_watcher_integration
CREATE DATABASE discord_live_watcher_integration OWNER discord_live_watcher_integration;
\q
```

Use a fresh password entered at the prompt and put its URL-encoded form only in `.env.test`. The role should have no grants or memberships for production resources. If a role/database with these names already exists, verify its origin instead of reusing or deleting it blindly.

Run structural preflight next. This action reads only the named file, does not import the bot, and performs no database/API access:

```powershell
node scripts/integration-local.js check
```

Only after the manual checks pass, future local DB preparation uses:

```powershell
node scripts/integration-local.js migrate
node scripts/integration-local.js seed
```

`migrate` applies existing migrations to the guarded local URL. `seed` refuses any watch table containing other/mismatched rows and preserves the existing matching state on repeat. For an alternate test-file location, pass its path as the final argument to every action, for example `node scripts/integration-local.js check C:\TestConfig\.env.test`. Do not use normal `npm start`, `npm run dev`, direct `src/index.js`, or the production Docker entrypoint for this test.

## Controlled live startup — stop boundary

**Stop here until the dedicated resources and live test window have been approved separately.** The repository is prepared, but this assignment authorizes no live test. The following command logs into Discord, reads/writes the local test DB, and starts immediate Twitch polling; a currently live streamer can cause a real test-channel notification right away:

```powershell
node scripts/integration-local.js start
```

Check the ready log shows the test bot, only Twitch monitoring starts, and no webhook listener/TikTok calls appear. Stop the foreground process with Ctrl+C before changing the environment, role settings, watch identity, or permissions. On restart, use the same `start` action and the same local database without clearing state. Stop this test process when finished; keep its test messages/state for review. No production shutdown or rollback is required, since it uses separate identities/resources.

## Integration test checklist

Record stream ID, test message ID, attachment filename and observed timestamps; do not record tokens, secrets or signed CDN query strings. All cases use only the one test watch/private channel.

- [ ] **Isolation:** structural check passes; manually verify dedicated bot/application, test-only guild membership, destination, fresh DB role/database and local port; no production records; blank role and disabled TikTok/Euler/webhook settings. Startup preflight accepts exactly one watch and retains its state. No management commands during the run.
- [ ] **Initial notification:** begin with the streamer offline, then start a test broadcast (or explicitly acknowledge the immediate notification if already live). Exactly one announcement appears in the test channel, with no role ping/content. Its title/link identify the right streamer and its image references a stream-specific Discord attachment, or a safe fallback while Twitch generates a valid preview. Confirm the bot doesn't touch other channels.
- [ ] **Refresh:** change the scene visibly and wait through the configured refresh interval plus a watcher tick. The same message ID updates; title/streamer information remain appropriate, there is no new announcement or mention. New filename matches the attachment referenced by the embed; the old thumbnail attachment is replaced. A static/repeated CDN image should not produce repeated edits. If Twitch re-encodes identical visuals, byte hashes may still differ.
- [ ] **Offline preservation:** end the stream. After the next successful status poll, the same message becomes offline, retains its last valid attachment and renders after Twitch's live URL expires. There is no role ping. Repeat an end near a refresh boundary and verify the final state stays offline after the queued check.
- [ ] **Restart recovery:** stop/start only the test process while the stream remains live, keeping test DB/message records. No duplicate announcement; an unchanged attachment avoids an upload. Repeat while offline: the existing image remains valid. Verify the referenced filename corresponds to an attachment actually present on the message, not a stored expiring CDN URL.
- [ ] **Subsequent broadcasts:** start another broadcast with a different stream ID. The old message remains/becomes offline with its own snapshot. Exactly one new message appears; it cannot inherit the old attachment. To exercise a missed offline interval, stop the test process while A is live, end A and start B while stopped, then restart with the same DB: A must be closed before B is announced.
- [ ] **Recovery:** in the private test channel only, deliberately remove Attach Files permission for one refresh, then restore it. Existing image/state remain recoverable and converge on the next eligible refresh without duplicate messages. A failure closing the old message can defer the next announcement; restore access and verify recovery. Do not inject failures into production or delete records to force tests.
- [ ] **Finish:** stop the test process and review evidence. Test credentials remain local and ignored. Any cleanup is limited to independently identified test resources and is a separate operator action.

## Local verification performed

- Full mocked regression suite: 49 tests passed (the existing 43 plus six isolation tests).
- Isolation tests cover rejected remote/wrong database routes, placeholders, enabled shared services, mentions, inherited environment injection, single-watch and saved-channel guards, production startup/default compatibility, and a no-network structural-check subprocess.
- Syntax checks passed for all 28 JavaScript source/script/test files; Prisma schema validation passed using a dummy URL. Prisma generation used local tooling; no schema changes, migrations or connections to a database were performed.
- Existing role, Twitch thumbnail lifecycle/deduplication and TikTok regression tests remain passing. New test files set only dummy process-local values and bypass `.env` loading.

This is configuration and mocked-behavior evidence, not real Discord/Twitch success. Remaining live risks include CDN freshness, attachment rendering/retention after offline edits and restart, correct test permissions, and external API limits. Use one isolated test process; in-process locks do not coordinate processes sharing a database. A separate database is mandatory even if a separate bot token/channel is used.
