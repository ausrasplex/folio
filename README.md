# Folio

A self-hosted app for keeping an eye on home loans: import the bank's statements, check they add up, and see when each loan will be paid off. It runs on your own computer or server and is meant to be reached on your home network or VPN.

This guide gets it running on your computer with Node.js and PostgreSQL. Unraid comes later and uses the same app.

## What you need

- **Node.js 20 or newer** (22 recommended). Check with `node -v`.
- **PostgreSQL 14 or newer** (16 recommended), running on your computer.
  - macOS: `brew install postgresql@16 && brew services start postgresql@16`
  - Windows: the installer from postgresql.org (remember the password you give the `postgres` user)
  - Linux: your package manager, for example `sudo apt install postgresql`

## 1. Make the database

Open a PostgreSQL prompt (`psql postgres` on macOS, `sudo -u postgres psql` on Linux, or "SQL Shell (psql)" on Windows) and run:

```sql
CREATE USER folio WITH PASSWORD 'pick-a-password';
CREATE DATABASE folio OWNER folio;
```

## 2. Settings

Copy `.env.example` to `.env` and fill in:

```
DATABASE_URL="postgresql://folio:pick-a-password@localhost:5432/folio?schema=public"
FOLIO_SECRET="a long random string"
```

Make the secret with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.

**Keep `FOLIO_SECRET` safe and never change it.** It encrypts account numbers, BSBs and two-step secrets. A backup restored on another install only reads those back if that install has the same secret.

Optional settings (all described in `.env.example`):

- `FOLIO_URL`: the address people use to reach Folio, for links in alerts and invites.
- `FOLIO_BACKUP_DIR`, `FOLIO_UPDATE_URL`, `FOLIO_NO_JOBS`: backups, update checks and background jobs.
- `FOLIO_MAX_RESTORE_MB`: the largest backup the admin can restore (2048 MB unless set).
- `FOLIO_SECURE_COOKIE`: the sign-in cookie is HTTPS-only whenever Folio is reached over HTTPS (`FOLIO_URL` is https, or a trusted proxy says so). Set it to `false` if you also open Folio over plain HTTP at home with an https `FOLIO_URL`, since a HTTPS-only cookie is never sent over HTTP.
- `FOLIO_TRUST_PROXY`: set to `true` only when every request reaches Folio through your own reverse proxy or Cloudflare. Folio then takes the visitor's address from `cf-connecting-ip` or `x-forwarded-for`. Left off, it uses the connection's own address and ignores those headers, since anyone can send them. Sign-in limits use this address.
- `FOLIO_TRUSTED_PROXY_IPS`: the addresses of any further proxies in front of that one, comma-separated. Only needed when there are two in a row.
- `FOLIO_REQUIRE_PROXY_AUTH`: when a login proxy such as Authelia sits in front of Folio, refuse visitors from outside the home network unless a proxy in `FOLIO_TRUSTED_PROXY_IPS` says who signed in. See [docs/security/REMOTE-ACCESS.md](docs/security/REMOTE-ACCESS.md).
- `FOLIO_CF_ACCESS_TEAM`, `FOLIO_CF_ACCESS_AUD`, `FOLIO_CF_ACCESS_LAN_BYPASS`: when Folio sits behind Cloudflare Tunnel and Access, make Folio itself refuse any request without a valid Access sign-in. See [docs/security/REMOTE-ACCESS.md](docs/security/REMOTE-ACCESS.md).

## 3. Install and start

```
npm install
npx prisma migrate deploy
npm run dev
```

Open http://localhost:3000. The first visit asks you to make the admin account and your first household.

### Trying it with sample data instead

On an **empty** database you can load a demo household before opening the app:

```
npm run db:seed
```

It signs in as `alex@folio.local`, `sam@folio.local` or `jordan@folio.local`, all with the password `folio-demo`. Alex is the server admin. The seed refuses to run once real people exist. To go back to a real setup, drop the database and make it again (step 1), then run `npx prisma migrate deploy`.

### Running it the faster way

`npm run dev` is for trying things out. For everyday use on your computer:

```
npm run build
npm start
```

## Using it

- **Add a loan** from the + button. You can attach its statements as you go.
- **Statements** takes PDF or CSV statements, several at once. Each file is matched against every saved layout (and every version of each), checked, and shown to you before anything is saved.
- **A statement from a bank Folio has not seen** needs a layout. Use *Map a layout* on the review card (or Settings, Layouts, +): choose the statement, draw a box around each section (or press *Suggest*), and Folio reads it back and checks the totals before you save.
- **Settings** holds the household, invites (with a QR code), alerts and where they go (Discord, Telegram, ntfy, Gotify, Home Assistant or a webhook), lenders, brokers, layouts, your data export and, for the admin, backups.
- **Profile** holds your name, photo, sign-in email, password, two-step verification and signed-in devices.

Who sees what: a loan is visible only to its borrowers and an account only to its holders. Lenders and brokers are shared in a household, and layouts are shared on the whole server. Shared things never reveal loans or accounts you are not on.

## Backups

The admin's Server tab backs up everything (database and statement files) to a folder, daily or weekly, and keeps the last 7, 14 or 30. *Back up now* makes one straight away, and each backup can be downloaded. *Restore* replaces everything on the server with a backup and signs everyone out.

Backups are written to `./backups` unless you choose another folder.

## Checks

```
npm run typecheck   # TypeScript
npm test            # engine and statement-reading tests
npm run e2e         # visits every screen in a browser (needs the app running and the demo data, plus Playwright)
```

## Reaching Folio from outside your home

Use a VPN, so Folio is never on the internet: [Tailscale](https://tailscale.com) (there is an Unraid plugin) or WireGuard (built into Unraid, under Settings › VPN Manager). Your phone or laptop then reaches Folio as if it were at home. Folio's privacy check (Settings › Server) shows a Tailscale address as "Your VPN".

[docs/security/REMOTE-ACCESS.md](docs/security/REMOTE-ACCESS.md) walks through Tailscale and WireGuard, the other options if a VPN won't do, and a checklist to work through before Folio is ever reachable from the internet. For HTTPS on your home network, see [docs/security/HTTPS-AT-HOME.md](docs/security/HTTPS-AT-HOME.md).

## Updating

1. Make a backup first: Settings › Server › Back up now.
2. Get the new version (`git pull`), then install exactly what it lists: `npm ci`.
3. Apply any database changes: `npx prisma migrate deploy`. It only adds to the database; never run `prisma migrate reset` on a real install.
4. Build and restart: `npm run build`, then start Folio again.

`next`, `prisma`, `@prisma/client` and `pdfjs-dist` are pinned to exact versions so every build is the same. Update one on purpose (`npm install next@15.5.29`), then run `npm run typecheck`, `npm test` and `npm run audit` before using it.

Check for known problems in the packages Folio runs on with `npm run audit`. Findings that have been looked at and don't affect Folio are noted in [docs/security/DEPENDENCIES.md](docs/security/DEPENDENCIES.md).

## Good to know

- There is no mail server, so changing your sign-in email asks for your password and changes it straight away.
- Alerts are worked out from your data each time you load a page. When you connect a service, Folio checks every 15 minutes and sends each new alert once.
- Automatic backups and alert sending run inside the app, so they only happen while it is running.
- Statements are read on your server and never sent anywhere.

## Where things are

| Path | What it holds |
| --- | --- |
| `src/app` | Pages and the API (`/api/state`, `/api/act`, `/api/import`, files, export, backups) |
| `src/screens` | The screens |
| `src/lib/engine` | The loan engine (daily interest, offsets, forecasts) |
| `src/lib/server` | Data access, actions, statement reading, backups, alerts |
| `prisma` | Database schema, migrations and the demo seed |
| `docs/SPEC.md` | The full product spec |
