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
