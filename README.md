# KC Mockup Library v2

Lightweight Thai borrowing register, fresh data, no authentication. Node 24, built-in SQLite, no npm runtime dependencies. Photos are separate files; thumbnail lists fetch 20 records at a time. Returned records older than 90 days appear in archived history. Automatic photo deletion is disabled.

## Local use

Run `node server.mjs`, open http://localhost:3000. Run `node --test test/app.test.mjs` for API integration tests. The equivalent `npm start` and `npm test` scripts are also provided. No dependency installation is required. Data defaults to `./data`; set DATA_DIR and PORT as needed. Node 24's SQLite API may emit an experimental warning.

No login is provided by design. Anyone with network access can view and change records. Keep borrower contact data appropriate to the chosen audience. Do not expose the data directory directly. Use HTTPS and the same origin for UI and API.

## Coolify deployment

1. Build this repository using the included Dockerfile, exposed container port 3000.
2. Create a dedicated persistent volume at `/data`. Never use an ephemeral container directory for the database or photos. Keep a single app replica for SQLite.
3. Set a chosen HTTPS domain through the existing proxy. No database port is needed.
4. Start with 512 MiB memory and 1 CPU limit; these are proposed limits, not measured production requirements. Build off-hours or in CI to avoid build-time contention.
5. Configure health check `/api/health`; verify add/edit/return/reopen/photo, then restart only this application and confirm persistence.
6. Compare existing project health and server memory/load before and after deployment. Roll back the application image if needed, preserving `/data`.

The included rate limiter uses the socket peer, so behind a proxy its 120 writes/minute cap may be shared by all users. It intentionally does not trust arbitrary forwarded IP headers. This is suitable for a small staff app; tune after observing use.

## Backup and restore

For a consistent database-and-photo backup, briefly stop app writes (stop this app only) and run `node backup.mjs <backup-directory>` in an environment with the data volume mounted and Node 24. DATA_DIR must point to that mount. The script uses SQLite's backup API and copies photos; it does not delete old backups. Deploy backup.mjs in a separate scheduled backup job or include it in your operations checkout.

Schedule daily, retain at least 7 daily and 4 weekly versions, and copy backups off this server. Before launch, restore a backup to a separate DATA_DIR and verify record counts and photos. To restore production, stop this app, preserve the current data directory as rollback, replace its contents with the selected backup, ensure the runtime user owns it, then start the app. Never overwrite a live database or retain stale WAL/SHM files from a different database.

## Scope and retention

- Existing Supabase data is not migrated.
- No automatic deletion and no permanent-delete button in v2.
- Photo uploads: browser JPEG conversion, 1280-pixel maximum long edge (1000 if needed), thumbnails 180 pixels; server caps full images at 700 KB and thumbnails at 100 KB.
- Print prints only the current filtered page (up to 20 rows).
- Refreshes every 30 seconds while visible; optimistic version checks prevent silent overwrites.
- Archive is a date-based view, not disk cleanup. Photo expiration can be added after an explicit retention period is chosen.
- Server validates JPEG signatures and size; it does not decode/re-encode untrusted images. Browser normalization is a convenience, not a security boundary. A hardened public upload deployment should add server-side decoding/re-encoding.

## Live deployment (30 September 2026)

- URL: https://kcmockup.118.27.151.202.sslip.io
- Z.com server: kc-production-01; Coolify project: KC Mockup Library; application: kcmockup.
- Source branch: `codex/lightweight-v2`; deployed application commit: `dc1409f4e5b00c65639135f8f32caada47238ab5`.
- Dedicated persistent volume mounted at `/data`; limits set to 512 MiB memory and 1 CPU. Idle sample after deployment: 17.35 MiB RAM and 0.28% CPU; this is not a load-test result.
- Coolify volume backups: daily at 02:00 Asia/Bangkok (19:00 UTC), retain 7 local backups. The app briefly stops during archive creation for consistency. Off-server copies are not configured.
- Verified HTTPS, save/return, persistence after backup restart, and isolated backup database readback with SQLite integrity check. Temporary production test record removed; live database starts empty. Existing seven workloads remained healthy.
- Off-server backup storage remains an operations follow-up. The address uses sslip.io and depends on that DNS service and the current server IP.
