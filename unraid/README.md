# Folio on Unraid

Folio runs on Unraid as two containers: PostgreSQL for the data, and Folio itself from the template in this folder. Statement files are kept in the database, so the only folder Folio writes to is its backups folder.

## What you need

- Unraid 6.12 or later, with Docker turned on.
- The Folio image, `ghcr.io/ausrasplex/folio`. GitHub Actions (`.github/workflows/docker.yml`) builds it on every push. A push to the repo's default branch publishes `latest`, any other branch publishes an image named after the branch, and a version tag (`v1.2.3`) publishes `1.2.3` and `1.2`. Its progress is under the repo's **Actions** tab. To build it yourself, see [Building the image yourself](#building-the-image-yourself).
- While the repo is private, so is the image. Do one of these:
  - **Make only the image public.** On GitHub, open your profile › **Packages** › **folio** › **Package settings** › **Change visibility** › **Public**. The code stays private, and the image holds only the built app, with no `.env` and no data. Unraid can then pull it with no sign-in.
  - **Or let Unraid sign in.** On GitHub, make a classic personal access token with only the `read:packages` scope (**Settings** › **Developer settings** › **Personal access tokens**). Then, in the Unraid terminal, run `docker login ghcr.io -u ausrasplex` and paste the token as the password. Unraid remembers it, and updates keep working.

## 1. Start PostgreSQL

In the Unraid web UI, open **Apps**, search for **postgres** and install the official `postgres` image, version 16 (repository `postgres:16`). Set:

| Setting | Value |
| --- | --- |
| `POSTGRES_USER` | `folio` |
| `POSTGRES_PASSWORD` | a long random password (letters and numbers only keeps the URL simple) |
| `POSTGRES_DB` | `folio` |
| Data path (`/var/lib/postgresql/data`) | `/mnt/user/appdata/folio-postgres` |
| Port | `5432` |

Start it and wait for its log to say `database system is ready to accept connections`.

## 2. Make a secret key

Folio encrypts account numbers and two-step secrets with this key. In the Unraid terminal (the `>_` button at the top right):

```
openssl rand -base64 32
```

Keep a copy somewhere safe, such as your password manager. Never change it: a backup only reads those details back with the same key.

**Moving an existing Folio to Unraid?** Use the `FOLIO_SECRET` from your current `.env` instead of making a new one.

## 3. Add the template

Copy `unraid/folio.xml` from the project to Unraid's flash share as `\\tower\flash\config\plugins\dockerMan\templates-user\my-Folio.xml`. That is `/boot/config/plugins/dockerMan/templates-user/my-Folio.xml` in the Unraid terminal. Replace `tower` with your server's name or IP address.

If the repo is public, you can download the template in the Unraid terminal instead:

```
wget -O /boot/config/plugins/dockerMan/templates-user/my-Folio.xml \
  https://raw.githubusercontent.com/ausrasplex/folio/HEAD/unraid/folio.xml
```

The template's icon is downloaded from GitHub too, so it shows as blank while the repo is private. Nothing else depends on it.

Then go to **Docker** › **Add Container** and choose **Folio** from the **Template** list.

## 4. Fill in the settings

| Setting | What to put |
| --- | --- |
| Web UI port | `3000`, or another free port |
| Backups | `/mnt/user/appdata/folio/backups` (or a share that is itself backed up) |
| Database URL | `postgresql://folio:PASSWORD@UNRAID-IP:5432/folio?schema=public`, with your Postgres password and the Unraid server's IP address |
| Secret key | the key from step 2 |
| Folio address | how people open Folio, such as `http://192.168.1.10:3000`. Leave it empty if you're not sure. |
| Time zone | your time zone, such as `Australia/Melbourne` |

**Show more settings** has the reverse-proxy and Cloudflare Access options. Leave them empty unless you follow [docs/security/REMOTE-ACCESS.md](../docs/security/REMOTE-ACCESS.md).

Click **Apply**. On every start, Folio applies any database updates and then starts. Its log ends with `Ready`, and the Docker page shows it as healthy after about a minute.

## 5. First start

Open the Web UI (`http://UNRAID-IP:3000`) and create the first account, which becomes the admin.

In **Settings** › **Server**, leave the backup folder empty or set it to `/backups`. That is the Backups folder from step 4, seen from inside the container. A folder from another computer, such as `C:\…`, will not work there.

### Bringing your existing data across

**With a Folio backup (simplest):**

1. On the old install, go to **Settings** › **Server** › **Back up now**, then download the backup.
2. On Unraid, set the Secret key to the old install's `FOLIO_SECRET`, then start Folio.
3. Create a temporary admin account, then go to **Settings** › **Server** › **Restore** and choose the backup. Everything is replaced, including the accounts, so you then sign in with your old details.

**Or with `pg_dump`:** dump the old database (`pg_dump -Fc -d folio -f folio.dump`), copy the file to the Postgres container's data share, and restore it before starting Folio for the first time: `docker exec -it postgres pg_restore -U folio -d folio --no-owner /var/lib/postgresql/data/folio.dump`. Use the same Secret key in this case as well.

## Updating

1. Make a backup first: **Settings** › **Server** › **Back up now**.
2. On the **Docker** page, click **Check for Updates**, then **Apply Update** next to Folio.

Database updates are applied when the container starts. They only add to the database. Never run `prisma migrate reset` against a real install.

To stay on one version, change the repository in the template from `:latest` to a version tag such as `:1.2.0`.

## Building the image yourself

Without GitHub, build the image on any computer that has Docker, from the project folder:

```
docker build -t folio .
```

Then either push it to a registry you use, or on Unraid build it directly (copy the project to `/mnt/user/appdata/folio/src` and run `docker build -t folio /mnt/user/appdata/folio/src`). In the template, set the repository to `folio`.

## Good to know

- The container runs as Unraid's usual `nobody:users` (99:100), so backup files on the share belong to that user and group.
- `/api/health` is Docker's health check. It says only whether Folio can reach its database, plus the version number. When Cloudflare Access or a login proxy is in front of Folio, only the container itself can ask it without signing in.
- Automatic backups and alert sending run inside the container, so they happen only while it is running.
- If Folio stops while starting with `Folio can't start: …`, the log line says which setting is missing. If it says the database can't be reached after two minutes, check the Database URL and that Postgres is running.
