# HTTPS at Home with Nginx Proxy Manager

This sets up Folio so every device on your home network opens it over HTTPS with a real, trusted certificate, and no warnings. Nothing is exposed to the internet.

What you end up with:

- `https://folio-a.yourdomain.com` and `https://folio-b.yourdomain.com`, one name for each Folio instance.
- Your password, statements and balances encrypted as they cross your network.
- Share and Copy working on every device, because browsers only allow those on secure (HTTPS) pages.
- Each instance keeping its own sign-in. On one address with different ports, the instances would keep signing each other out.

The examples use your set-up: Nginx Proxy Manager (NPM) and both Folio instances on `192.168.7.7`, on ports `3000` and `3001`. Swap in your own domain wherever you see `yourdomain.com`.

## Before You Start

You need:

- A domain whose DNS is on Cloudflare (for example one bought through Cloudflare, about $10 a year). The domain is only used to prove to Let's Encrypt that it is yours. Your server does not need to be reachable from the internet.
- Nginx Proxy Manager running, and the address of the machine it runs on (here `192.168.7.7`).
- A way to add local DNS names: Pi-hole, AdGuard Home, or your router's DNS settings.
- Admin access to each Folio instance's `.env` file.

Each Folio instance must have its own database (`DATABASE_URL`) and its own `FOLIO_SECRET`.

## Step 1: Create a Cloudflare API Token

NPM uses this to prove you own the domain, by adding a temporary DNS record.

1. Sign in to Cloudflare and open **My Profile › API Tokens**.
2. Choose **Create Token**, then use the **Edit zone DNS** template.
3. Under **Zone Resources**, choose **Include › Specific zone › yourdomain.com**.
4. Choose **Continue to summary**, then **Create Token**.
5. Copy the token now. Cloudflare only shows it once.

Keep the token. NPM needs it again every time it renews the certificate, about every 60 days, which it does automatically.

## Step 2: Get a Wildcard Certificate in NPM

One wildcard certificate covers every Folio instance, and any you add later.

1. In NPM, open **SSL Certificates › Add SSL Certificate › Let's Encrypt**.
2. **Domain Names**: add both `yourdomain.com` and `*.yourdomain.com`.
3. **Email Address for Let's Encrypt**: your email (they send renewal warnings here).
4. Turn on **Use a DNS Challenge**.
5. **DNS Provider**: Cloudflare.
6. **Credentials File Content**: replace the example with your token:
   ```
   dns_cloudflare_api_token = paste-your-token-here
   ```
7. **Propagation Seconds**: leave empty, or enter `60` if the first attempt fails.
8. Agree to the Let's Encrypt terms and choose **Save**.

After a minute or so the certificate appears in the list with an expiry date about 90 days away.

## Step 3: Point the Names at NPM on Your Network

These names only exist on your home network. Do not add them to Cloudflare's public DNS.

Point each name at the machine running NPM, not at Folio (here they are the same machine):

| Name | Address |
| --- | --- |
| `folio-a.yourdomain.com` | `192.168.7.7` |
| `folio-b.yourdomain.com` | `192.168.7.7` |

Where to add them:

- **Pi-hole**: **Local DNS › DNS Records**. Enter the domain and the IP, then **Add**.
- **AdGuard Home**: **Filters › DNS rewrites › Add DNS rewrite**.
- **Router**: look for "Local DNS", "DNS host mapping" or "Static DNS". The wording varies by brand.

Check it from any computer on your network:

```
nslookup folio-a.yourdomain.com
```

The answer should be `192.168.7.7`. If it isn't, that device isn't using your Pi-hole, AdGuard or router for DNS.

## Step 4: Add a Proxy Host for Each Instance

In NPM, open **Hosts › Proxy Hosts › Add Proxy Host**. Do this once for each instance.

**Details tab**

| Field | folio-a | folio-b |
| --- | --- | --- |
| Domain Names | `folio-a.yourdomain.com` | `folio-b.yourdomain.com` |
| Scheme | `http` | `http` |
| Forward Hostname / IP | `192.168.7.7` (or the container's name, see Step 6) | same |
| Forward Port | `3000` | `3001` |
| Block Common Exploits | On | On |
| Websockets Support | Off (not needed) | Off |

**SSL tab**

- **SSL Certificate**: the `*.yourdomain.com` certificate from Step 2.
- **Force SSL**: On (anyone who types `http://` is sent to `https://`).
- **HTTP/2 Support**: On.
- **HSTS Enabled**: Off. Folio sends its own HSTS header once `FOLIO_URL` is https, so there is no need for two.

**Advanced tab**, in **Custom Nginx Configuration**:

```
client_max_body_size 30m;
proxy_read_timeout 600s;
proxy_send_timeout 600s;
```

The first line lets statements up to 25 MB through. Raise it (for example to `2048m`) on the instance where the admin restores large backups. The other two give restores up to 10 minutes.

Choose **Save**.

## Step 5: Tell Each Folio Instance Its Address

In each instance's `.env`, add:

```
FOLIO_URL="https://folio-a.yourdomain.com"
FOLIO_TRUST_PROXY="true"
```

Use `folio-b.yourdomain.com` in the second instance's file.

What these do:

- `FOLIO_URL` is the address in alert and invite links. Because it starts with `https://`, Folio also makes its sign-in cookie HTTPS-only (named `__Host-folio_session`) and sends HSTS.
- `FOLIO_TRUST_PROXY` lets Folio read your device's real address from the headers NPM adds. Folio uses that address for sign-in limits and to keep invites on your home network.

Leave `FOLIO_SECURE_COOKIE` unset.

Only set `FOLIO_TRUSTED_PROXY_IPS` if there is a second proxy in front of NPM. There isn't in this set-up.

## Step 6: Close the Side Door

This step matters. With `FOLIO_TRUST_PROXY=true`, Folio believes the forwarded headers it receives. If anyone on your network can still reach Folio directly at `192.168.7.7:3000`, they can skip NPM and send fake headers, for example to get round the sign-in limits. Folio must only be reachable through NPM.

Pick the case that matches how Folio runs.

**Folio in Docker on the same Unraid server as NPM** (recommended)

1. Create a shared network once, in the Unraid terminal:
   ```
   docker network create folio-proxy
   ```
2. Edit the NPM container and each Folio container: set **Network Type** to **Custom: folio-proxy**.
3. In each Folio container, **remove the port mapping** (3000 or 3001), so nothing outside Docker can reach it.
4. In NPM (Step 4), set **Forward Hostname** to the Folio container's name, for example `folio-a`, and **Forward Port** to the port Folio listens on inside the container (`3000` for both, if both use the default).

**Folio started with `npm start` on the same machine as NPM**

Make Folio listen only on the machine itself:

```
npx next start -H 127.0.0.1 -p 3000
```

Then in NPM use **Forward Hostname** `127.0.0.1`. If NPM itself runs in Docker, `127.0.0.1` means the NPM container, not the machine: either run Folio in Docker too (the first case above), or add `--add-host=host.docker.internal:host-gateway` to NPM's **Extra Parameters**, use **Forward Hostname** `host.docker.internal`, and start Folio with `-H 0.0.0.0` plus a firewall rule as in the next case.

**Folio on a different machine from NPM**

Allow port 3000 (and 3001) on that machine only from NPM's address, and block everything else. On Windows, in **Windows Defender Firewall › Advanced settings › Inbound Rules**, edit or add the rule for port 3000 and, under **Scope › Remote IP address**, allow only `192.168.7.7`.

## Step 7: Restart and Check

1. Restart each Folio instance so it picks up the new `.env`.
2. Open `https://folio-a.yourdomain.com`. You should see the padlock and no warning.
3. Sign in.
4. In the browser's developer tools (F12 › **Application › Cookies**), the cookie should be `__Host-folio_session`, marked **Secure**.
5. Open **Profile › Security**. In the list of signed-in devices, your device's address should be its own (for example `192.168.7.42`), **not** `192.168.7.7` or a Docker address like `172.x.x.x`. If it shows NPM's address, `FOLIO_TRUST_PROXY` is not set or Folio was not restarted.
6. On your phone, open an account and try **Share** and **Copy**.
7. Try the side door: `http://192.168.7.7:3000` should no longer open Folio.
8. Repeat for `folio-b`, and check that signing in to one no longer signs you out of the other.

Update any bookmarks and home-screen icons to the new `https://` addresses.

## If Something Goes Wrong

| What you see | Likely cause and fix |
| --- | --- |
| The certificate request fails | The token is missing **Edit zone DNS** for this domain, or DNS was slow. Try **Propagation Seconds** `60`. |
| "502 Bad Gateway" | NPM can't reach Folio: check the forward host and port, that Folio is running, and in Docker that both containers are on `folio-proxy`. |
| The name doesn't open at all | The device isn't using your local DNS. Run `nslookup` from that device (Step 3). |
| You are signed out straight away, or can't stay signed in | You opened Folio by its IP or with `http://`. The HTTPS-only cookie is never sent over HTTP. Use the `https://` name. |
| "This request came from another website" when saving | `FOLIO_URL` doesn't match the name in the address bar (check spelling and `https://`), then restart Folio. |
| "413 Request Entity Too Large" when importing or restoring | Raise `client_max_body_size` in the proxy host's Advanced tab. |
| An invite says "Open this invite at home" while you are at home | Folio is seeing an address outside your network. Check the device address in Profile › Security (Step 7.5). |
| Share still does nothing on a computer | Desktop Firefox has no Share. Folio copies the details instead. |

## Adding Another Instance Later

1. Give it its own database, `FOLIO_SECRET` and port.
2. Add a local DNS name for it (Step 3).
3. Add a proxy host for it (Step 4). The wildcard certificate already covers it.
4. Set its `FOLIO_URL` and `FOLIO_TRUST_PROXY` (Step 5), close its side door (Step 6), and check it (Step 7).
