# NEXO

NEXO is a guest first discovery and playback app for live TV, movies, and web series. It has a Flutter mobile client, a NestJS API, and a Next.js operator panel that also hosts the API when deployed.

## Apps and boundaries

- `apps/mobile`: Flutter + Dart, GoRouter, flutter_bloc/Cubit, Dio, `get_storage` for device local My List, `video_player` for HLS, the official YouTube IFrame Player, and `webview_flutter` for provider embeds.
- `apps/api`: NestJS + TypeScript and PostgreSQL through `pg`. It is the only application that connects to Neon. Swagger is available at `/docs`.
- `apps/admin`: Next.js App Router + TypeScript + Tailwind. It calls authenticated NestJS routes and never connects to Neon.

The mobile app does not ask viewers to sign in. My List stays on the device and does not sync across devices.

## Local setup

1. Copy `apps/api/.env.example` to `apps/api/.env`. Set `DATABASE_URL` to the existing Neon URL. Set a long random `ADMIN_API_TOKEN`; `npm run admin:token -w @nexo/api` can generate one locally. Set `TMDB_API_KEY` to enable movie and series listings. `PLAYBACK_ALLOWED_HOSTS` is optional: leave it empty to play any HTTPS stream URL stored in the catalog, or list hostnames to restrict playback to them. Keep this file private; it is ignored by Git.
2. Copy `apps/admin/.env.example` to `apps/admin/.env.local`. Set `ADMIN_LOGIN_USERNAME` and a strong `ADMIN_LOGIN_PASSWORD` for the operator, then copy the same `ADMIN_API_TOKEN` from the API environment. The admin login form accepts only the operator username and password; the API token stays in server configuration. `API_BASE_URL` (server only) points the admin at a separately running API such as the Nest dev server on `:4000`; leave it unset to run the API inside the admin app.
3. From the repository root, run `npm install`, then `npm run db:inspect` to inspect the existing database. Apply the additive catalog migration with `npm run db:migrate` (details below).
4. Run `npm run dev` to start the API and admin panel, or start `npm run api:dev` and `npm run admin:dev` in separate terminals.
5. For the mobile app, run `cd apps/mobile`, `flutter pub get`, then `flutter run`. On the Android emulator the app reaches the API at `http://10.0.2.2:4000/api/v1` by default. For a physical device, pass the machine's LAN address: `flutter run --dart-define=API_BASE_URL=http://192.168.x.x:4000/api/v1`. Add `--dart-define=CONTENT_REPORT_EMAIL=content@example.com` to show a report link.

## Database and seed data

The existing `channeltb` and `categorydb` tables remain the source of truth for channels and categories. Their live schema was inspected read only and is documented in [docs/database-schema.md](docs/database-schema.md). NEXO does not recreate, rename, drop, or seed those tables.

The database initially contained no movie, series, season, episode, or collection tables. `npm run db:migrate` creates only the missing NEXO catalog tables (`movies`, `series`, `seasons`, `episodes`, `collections`, and `collection_items`) and records the migration in `nexo_schema_migrations`. It uses `CREATE TABLE IF NOT EXISTS`, and the migration does not change existing channel or category data.

`db/seed/catalog.json` contains two clearly marked, unpublished setup drafts with no artwork or playback URLs. They are not shown in viewer catalogs. Replace or remove them when adding real rights-cleared metadata and approved HTTPS playback URLs, then run `npm run db:seed`. Playback URLs must be official YouTube URLs or match `PLAYBACK_ALLOWED_HOSTS`; artwork URLs must use HTTPS. Existing channel records are never changed by the seed script. The expected JSON shape and allowed fields are in [db/seed/README.md](db/seed/README.md).

Useful database commands:

- `npm run db:inspect` — read only schema inventory and channel/category column details.
- `npm run db:migrate` — apply the additive catalog migration once.
- `npm run db:seed` — import the operator supplied `db/seed/catalog.json`; empty input is a no op.

## Playback and content rights

Each kind of content has one source:

| Content | Source | Player |
| --- | --- | --- |
| Live channels | `channeltb.liveurl` (HLS) | `video_player` |
| Movies | TMDB listing, Superembed embed by TMDB id | in-app WebView |
| Web series and dramas | TMDB listing and episode guide, VidSrc embed by TMDB id | in-app WebView |
| Sports videos | Uploads feed of the channels in `SPORTS_YOUTUBE_CHANNELS` | official YouTube IFrame Player |

The API requires HTTPS for every playback URL and rejects URLs with embedded credentials. `PLAYBACK_ALLOWED_HOSTS` is an optional extra restriction; when it is empty, any HTTPS stream URL stored in the catalog plays. Embed URLs are built only by the API's playback module from `VIDSRC_BASE_URL` and `SUPEREMBED_BASE_URL` (defaults `https://vidsrc.net/embed` and `https://multiembed.mov`). These third-party services move domains from time to time: change the base URL if one stops loading, or set it to `off` to disable that provider. The in-app WebView blocks top-level navigation away from the embed once it has loaded, which stops most ad redirects. The app does not scrape sites, proxy streams, or extract media URLs. The operator is responsible for holding the rights to the channels and titles it makes available.

Movies and series added by hand in the admin panel still work and appear in a "Featured on NEXO" rail; their playback URL is whatever the operator enters.

The home feed is built by `GET /api/v1/home?tab=all|live|sports|movies|series|dramas`, which returns a hero list and ordered sections (channel circles, poster rails, ranked rails, video rails). TMDB and YouTube responses are cached in memory, so a provider outage leaves the live channel rails intact.

Missing or invalid playback sources show a friendly unavailable state. Catalog pages include a content availability note and can enable a report link with `CONTENT_REPORT_EMAIL` for Flutter and `NEXT_PUBLIC_CONTENT_REPORT_EMAIL` for the admin UI.

## Admin security

Admin sign in uses the operator username and password configured on the admin server. The API token is configured server side for the Next.js to NestJS connection and is never entered in the login form or exposed in a client bundle. Browser sessions use HttpOnly, SameSite cookies, and the API checks its credential on every admin route. Public catalog endpoints are read only. Rotate the API token in the secret manager and update both services when rotating.

## Checks and builds

From the repository root:

- `npm run api:build`, `npm run api:test`, `npm run api:lint`
- `npm run admin:build`, `npm run admin:lint`, `npm run admin:typecheck`
- `npm run build` — build API and admin

For Flutter, from `apps/mobile`: `flutter analyze` and `flutter test`.

## Deployment

The admin app and the API deploy together as one Vercel project on one domain. The Next.js app serves `/api/v1/*` by running the compiled NestJS API inside its server function (`apps/admin/src/app/api/v1/[[...path]]/route.ts`), and the admin's own server code reaches the same API in-process over a loopback port.

Vercel setup:

- Import the repository and set **Root Directory** to `apps/admin`. `apps/admin/vercel.json` installs from the workspace root, and `npm run build` builds the API first (`prebuild`) and then Next.js.
- Environment variables (all server only): `DATABASE_URL`, `ADMIN_API_TOKEN`, `ADMIN_LOGIN_USERNAME`, `ADMIN_LOGIN_PASSWORD`, `TMDB_API_KEY`, and optionally `CORS_ORIGINS`, `PLAYBACK_ALLOWED_HOSTS`, `VIDSRC_BASE_URL`, `SUPEREMBED_BASE_URL`, `SPORTS_YOUTUBE_CHANNELS`. Do **not** set `API_BASE_URL`.
- Point Flutter at the deployment: `--dart-define=API_BASE_URL=https://<your-domain>/api/v1`.
- Run `npm run db:migrate` once so the `channel_health` table exists. Stream check results are stored there and shared by every function instance.
- Channel health checks: set `CRON_SECRET` (a random string of 16+ characters) in Vercel. Vercel Cron then calls `/api/cron/channel-health` on the schedule in `apps/admin/vercel.json`. Each call checks channels for up to 240 seconds, oldest results first, so later calls pick up where it stopped. The default schedule is daily (`0 5 * * *`) because Hobby plans only allow daily crons; on Pro, change it to e.g. `*/15 * * * *`. Serverless functions do not run the in-process timer.
- Swagger (`/docs`) is only served by the standalone API (`npm run api:dev`).

The API can still run on its own (`npm run start -w @nexo/api`) on any Node host; set the admin's `API_BASE_URL` to its HTTPS URL in that case. Supply operator owned imagery and rights cleared playback sources before publishing catalog entries.
