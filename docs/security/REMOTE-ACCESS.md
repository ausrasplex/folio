# Reaching Folio from Outside Your Home

Folio holds your loans, account numbers and statements. The safest way to use it away from home is to keep it off the internet entirely and reach it through a VPN. Only expose it publicly if a VPN really won't do, and then only after working through the [checklist](#before-you-expose-folio) at the end.

| Option | Exposed to the internet | Effort | Good for |
| --- | --- | --- | --- |
| [Tailscale](#tailscale-recommended) | No | Low | Everyone. Start here. |
| [WireGuard](#wireguard) | One UDP port, VPN only | Medium | People who don't want a third-party service |
| [Cloudflare Tunnel and Access](#cloudflare-tunnel-and-access) | Yes, behind Cloudflare's login | Medium | Opening Folio in any browser without a VPN app |
| [Authelia with a reverse proxy](#authelia-with-a-reverse-proxy) | Yes, behind your own login page | High | People already running Authelia |

For HTTPS on your home network (needed for Share and Copy on phones), see [HTTPS at Home](HTTPS-AT-HOME.md). It works alongside any option here.

## Use a VPN First

With a VPN, Folio stays reachable only from your home network. Your phone or laptop joins that network from wherever you are, encrypted, and nothing about Folio is visible to the internet. Sign-in limits, invites that only open at home, and everything else behave as if you were at home.

Folio's privacy check (Settings › Server) reports a Tailscale address as "Your VPN", and invites open over the VPN just as they do at home.

### Tailscale (Recommended)

Tailscale is the least work: no ports to open, and it gets through almost any network.

1. On Unraid, install the **Tailscale** plugin from Community Applications, open it and sign in.
2. Install the Tailscale app on your phone and laptop, and sign in with the same account.
3. Open Folio at the server's Tailscale name or address, for example `http://unraid:3000` or `http://100.x.y.z:3000`, from anywhere.

For HTTPS over Tailscale (so Share and Copy work away from home too), turn on **MagicDNS** and **HTTPS certificates** in the Tailscale admin console, then on the server run:

```
tailscale serve --bg http://localhost:3000
```

Folio is then at `https://<server>.<tailnet>.ts.net` with a valid certificate. Set `FOLIO_URL` to that address. Tailscale gives each machine one name, so a second Folio instance needs another port on it (`tailscale serve --bg --https=8443 http://localhost:3001`). Both would then share one sign-in cookie, so prefer [HTTPS at Home](HTTPS-AT-HOME.md) names for more than one instance.

### WireGuard

WireGuard is built into Unraid and needs no outside service, but you forward one UDP port on your router to it.

1. In Unraid, open **Settings › VPN Manager** and add a tunnel.
2. Add a peer of type **Remote access to LAN** for each phone or laptop.
3. On your router, forward the tunnel's UDP port (shown in VPN Manager, 51820 by default) to the Unraid server. Only WireGuard answers on it; Folio is still not exposed.
4. Scan the peer's QR code with the WireGuard app on your phone, or import its file on a laptop.
5. With the tunnel on, open Folio at its home address, for example `http://192.168.7.7:3000`.

WireGuard addresses usually come from a private range, so Folio treats them as your home network.

## Other Ways In

If a VPN won't do, the next sections cover putting Folio behind a login that runs before Folio's own: Cloudflare Access or Authelia. Folio's own sign-in, two-step verification and limits still apply on top.

## Cloudflare Tunnel and Access

A Cloudflare Tunnel connects out from your server to Cloudflare, so you open no ports on your router. Cloudflare Access puts a sign-in page in front of the tunnel: only the email addresses you allow get through to Folio at all.

**Know this first:** Cloudflare ends HTTPS at its own servers. Everything you send Folio through the tunnel (your password, statement uploads, balances and account numbers on screen) passes through Cloudflare decrypted before being encrypted again on the way to your server. If that is not acceptable, use a VPN.

You need a domain on Cloudflare and a free Cloudflare Zero Trust account (**Zero Trust** in the Cloudflare dashboard; it asks for a team name, which becomes `yourteam.cloudflareaccess.com`).

### 1. Run the tunnel

1. In Zero Trust, open **Networks › Tunnels › Create a tunnel**, choose **Cloudflared**, and name it (for example `folio`).
2. Copy the install token it shows.
3. On Unraid, install the **cloudflared** container from Community Applications (or run `cloudflare/cloudflared` yourself) with the command `tunnel run --token <your token>`. Put it on the same Docker network as Folio (see [HTTPS at Home, Step 6](HTTPS-AT-HOME.md#step-6-close-the-side-door)).
4. Back in Cloudflare, the tunnel shows as **Healthy**.

### 2. Give Folio a public name

1. In the tunnel, open **Public Hostname › Add a public hostname**.
2. **Subdomain** `folio`, **Domain** `yourdomain.com`.
3. **Service**: `HTTP` and the Folio container's name and port, for example `folio-a:3000`.
4. Save. Don't open the address yet: the next step puts the login in front of it.

### 3. Put Cloudflare Access in front

1. In Zero Trust, open **Access › Applications › Add an application › Self-hosted**.
2. **Application domain**: `folio.yourdomain.com`.
3. Add a policy: **Action** Allow, **Include › Emails** with your email address (and anyone else who uses this Folio).
4. Save. On the application's **Overview**, copy the **Application Audience (AUD) Tag**.

Opening `https://folio.yourdomain.com` now asks you to sign in to Cloudflare first (a code is emailed to you), then shows Folio's own sign-in.

### 4. Make Folio check Access itself

Without this, anyone who reaches Folio another way (for example through a mistake in the tunnel's settings) skips Cloudflare's login. With it, Folio refuses every request that doesn't carry a valid Access sign-in. In Folio's `.env`:

```
FOLIO_URL="https://folio.yourdomain.com"
FOLIO_TRUST_PROXY="true"
FOLIO_CF_ACCESS_TEAM="yourteam"
FOLIO_CF_ACCESS_AUD="the AUD tag you copied"
```

- `FOLIO_CF_ACCESS_TEAM` is your team name (or the full `yourteam.cloudflareaccess.com`).
- Folio checks each request's `Cf-Access-Jwt-Assertion` header against your team's public keys and the AUD tag. A missing or invalid one gets "403 Forbidden".
- `FOLIO_TRUST_PROXY` makes Folio take each visitor's real address from Cloudflare (`cf-connecting-ip`) rather than the tunnel container's.

To still open Folio directly at home (for example at `http://192.168.7.7:3000`, which carries no Access sign-in), also set:

```
FOLIO_CF_ACCESS_LAN_BYPASS="true"
```

Requests without the header are then allowed only from your home network or VPN. Everything else still needs the Access sign-in.

Restart Folio. Check it: `https://folio.yourdomain.com` works after the Cloudflare sign-in, and with the bypass off, opening Folio at its home address shows "Open Folio through its Cloudflare address".

## Authelia with a Reverse Proxy

Authelia is a login page you run yourself. Your reverse proxy (here Nginx Proxy Manager, as in [HTTPS at Home](HTTPS-AT-HOME.md)) asks Authelia about every request, and only sends signed-in ones on to Folio. Unlike Cloudflare, nothing passes through anyone else's servers, but you open port 443 on your router to NPM and keep NPM and Authelia up to date yourself.

Set up [HTTPS at Home](HTTPS-AT-HOME.md) first: it covers the certificate, the proxy host and closing Folio's side door, all of which this builds on.

### 1. Run Authelia

1. Install the **Authelia** container from Community Applications and put it on the same Docker network as NPM and Folio (`folio-proxy`).
2. In its `configuration.yml`, set at least:
   ```yaml
   session:
     cookies:
       - domain: yourdomain.com
         authelia_url: https://auth.yourdomain.com
   authentication_backend:
     file:
       path: /config/users_database.yml
   access_control:
     default_policy: deny
     rules:
       - domain: folio.yourdomain.com
         policy: two_factor   # or one_factor: a password only
   ```
   plus the storage, notifier and secrets sections from Authelia's own getting-started guide.
3. Add yourself to `users_database.yml`, with a password hash made by `authelia crypto hash generate argon2`.
4. **two_factor** (recommended) asks for an authenticator code or security key on top of the password, the first time on each device.

### 2. Put NPM in front of both

1. Forward port **443** on your router to NPM, and nothing else. Never forward Folio's port (3000) or Postgres (5432).
2. In NPM, make sure your certificate covers `auth.yourdomain.com` and `folio.yourdomain.com` (the wildcard from [HTTPS at Home, Step 2](HTTPS-AT-HOME.md#step-2-get-a-wildcard-certificate-in-npm) does). Add both names to your public DNS at Cloudflare, pointing at your home's public address.
3. Add a proxy host for `auth.yourdomain.com`, forwarding to `authelia` port `9091`, with the certificate and **Force SSL**.
4. On Folio's proxy host (from HTTPS at Home), add Authelia's forward-auth configuration in the **Advanced** tab. Use the current snippet from Authelia's guide, **Integration › Proxies › NGINX Proxy Manager**: it has NPM ask `http://authelia:9091/api/authz/auth-request` about each request, send people who aren't signed in to the login page, and pass `Remote-User` and `Remote-Email` on to Folio. Keep the `client_max_body_size` and timeout lines from HTTPS at Home.

Opening `https://folio.yourdomain.com` now shows Authelia's login first, then Folio's own sign-in.

### 3. Make Folio check the login itself

Folio doesn't sign you in from Authelia's headers. They are only a second gate, so Folio refuses visitors from outside your home network unless the proxy says who they are. In Folio's `.env`:

```
FOLIO_URL="https://folio.yourdomain.com"
FOLIO_TRUST_PROXY="true"
FOLIO_TRUSTED_PROXY_IPS="172.18.0.2"
FOLIO_REQUIRE_PROXY_AUTH="true"
```

- `FOLIO_TRUSTED_PROXY_IPS` is NPM's address **as Folio sees it**, on the Docker network. Folio only believes `Remote-User` and `Remote-Email` from these addresses, and removes them from every other request before anything in Folio can see them.
- Docker can give NPM a different address after a restart, so fix it: in NPM's container, add `--ip 172.18.0.2` to **Extra Parameters** (any free address on `folio-proxy`; `docker network inspect folio-proxy` shows the range).
- `FOLIO_TRUST_PROXY` must be on. Without it, every request through NPM looks like it comes from NPM's own home-network address, so the check would let everyone in.
- `FOLIO_REQUIRE_PROXY_AUTH` turns the check on. Requests from your home network or VPN still get in without the login.

Restart Folio. Check it: from outside your home (for example on your phone with Wi-Fi off), `https://folio.yourdomain.com` shows the Authelia login first. Folio's own sign-in still follows.

## Before You Expose Folio

Work through every item before Folio can be reached from the internet in any way other than a VPN (Cloudflare Tunnel, or port 443 to a proxy). Tick each one only once you have checked it.

- [ ] **Folio is up to date** with the security changes: sign-in and two-step limits, trusted client addresses, HTTPS-only cookies, session limits, one password rule, required two-step (A1 to A7); security headers, request origin checks, invites kept to the home network, size limits (B1 to B4); and statement files read in a limited worker and checked by content (C1, C2). They are all in this version.
- [ ] **`FOLIO_URL` is set to the https address** people use, for example `https://folio.yourdomain.com`. This makes the sign-in cookie HTTPS-only and turns on HSTS.
- [ ] **`FOLIO_TRUST_PROXY=true`**, and Folio can only be reached through the proxy or tunnel ([HTTPS at Home, Step 6](HTTPS-AT-HOME.md#step-6-close-the-side-door)). Check: Profile › Security shows each device's own address, not the proxy's.
- [ ] **Two-step verification is required** for everyone: Settings › Server › Require two-step verification for everyone. Turn it on for your own account first, in Profile.
- [ ] **A backup is made and a restore is tested**: Settings › Server › Back up now, then restore that file on a spare Folio (same `FOLIO_SECRET`) and check your loans and accounts are there.
- [ ] **`npm run audit` is clean**, or each finding is noted with why it doesn't matter here.
- [ ] **A front-door login is in place**: Cloudflare Access with `FOLIO_CF_ACCESS_TEAM` and `FOLIO_CF_ACCESS_AUD` set, or Authelia with `FOLIO_REQUIRE_PROXY_AUTH=true` (sections above). Check from outside your home (a phone with Wi-Fi off): the front-door login appears before Folio's own.
- [ ] **Port forwarding goes only to the proxy** (443 to NPM), or there is none at all (Cloudflare Tunnel). Never forward Folio's port (3000) or Postgres (5432). Check your router's port forwarding list.

Keep it up: update Folio, NPM, Authelia or cloudflared, and Unraid when updates come out, and look at Profile › Security now and then for devices you don't recognise.