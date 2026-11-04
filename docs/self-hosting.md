# Self-hosting Sendy Birdy

This guide runs Sendy Birdy on a machine you own (a home server, a mini PC, an old laptop) so your clients can open share links from anywhere, while the admin app stays private.

```
                 internet                         your machine
 client's phone ───────────► tunnel ──────► public app   127.0.0.1:8001   share links only
                                                 │
 your laptop/phone ─ Tailscale (private) ──► admin app    127.0.0.1:8000   everything
                                                 │
                                            PostgreSQL   127.0.0.1:5432
```

- **Two processes, one database.** The public app (`APP_MODE=public`) only knows share links: `/s/<token>`, its API and the page's files. The admin app (`APP_MODE=admin`) has everything else. Admin routes don't exist in the public process, so exposing it can't expose them.
- **Nothing listens on your network.** Both apps and PostgreSQL bind to `127.0.0.1`. The tunnel runs on the same machine and makes an _outgoing_ connection to its provider. There's no port forwarding on your router and no public IP address.
- **Only the public app is ever exposed.** The admin app is reachable only from your own devices, through your private Tailscale network.

## What you need

- A Linux machine that stays on, with systemd (Ubuntu, Debian, Fedora…).
- PostgreSQL 18, Python 3.12+ with [uv](https://docs.astral.sh/uv/), Node 22.12+ (to build the frontend), and ffmpeg (for video posters; optional but recommended).
- A free [Tailscale](https://tailscale.com) account. For the Cloudflare option, you also need a domain on Cloudflare.

If it's a laptop, stop it from sleeping when the lid closes. A sleeping server means links that don't open.

## 1. Install the app

```bash
git clone https://github.com/<you>/sendy-birdy.git ~/sendy-birdy
cd ~/sendy-birdy
make install        # Python and Node dependencies; creates .env with a random SECRET_KEY
make db-setup       # the `sendy` role and databases (asks for your sudo password)
make db-migrate
make create-admin   # your email, name and password
make build          # the production frontend, served by the apps themselves
```

PostgreSQL already runs as a system service that starts on boot, and by default it only listens on localhost. Check both:

```bash
systemctl is-enabled postgresql                          # enabled
sudo -u postgres psql -tAc 'SHOW listen_addresses'       # localhost
```

## 2. Set up Tailscale

Install Tailscale on the server and sign in:

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
sudo tailscale set --operator="$USER"    # lets you run `tailscale serve/funnel` without sudo
```

In the [admin console](https://login.tailscale.com/admin/dns), turn on **MagicDNS** and **HTTPS certificates**. Your machine now has a name like `homebox.tail1234.ts.net`. You'll find it with:

```bash
tailscale status --json | jq -r .Self.DNSName      # homebox.tail1234.ts.net.  (ignore the final dot)
```

(Without `jq`, the name is also on the admin console's **Machines** page.)

Install the Tailscale app on your laptop and phone too, signed in to the same account. That's your private network.

## 3. Configure `.env`

Open `~/sendy-birdy/.env` and set the address your clients will use:

```bash
PUBLIC_BASE_URL=https://homebox.tail1234.ts.net
```

The other defaults are right for production: `COOKIE_SECURE=true` (the site is HTTPS), `LOG_RETENTION_DAYS=90` and `SESSION_DAYS=7`. Keep a copy of `.env` in your password manager. Backups don't include it, because it holds the secrets.

## 4. Run both apps as systemd user services

User services run as you (no root), start on boot, and restart if they crash. From the repository folder, this writes the two unit files with the right paths:

```bash
cd ~/sendy-birdy
APP="$PWD/backend"
mkdir -p ~/.config/systemd/user

cat > ~/.config/systemd/user/sendy-admin.service <<EOF
[Unit]
Description=Sendy Birdy admin app (127.0.0.1:8000)

[Service]
WorkingDirectory=$APP
Environment=APP_MODE=admin
# Migrations run before every start, so an update never runs against an old schema.
ExecStartPre=$APP/.venv/bin/alembic upgrade head
ExecStart=$APP/.venv/bin/uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8000
Restart=on-failure
RestartSec=5
NoNewPrivileges=yes

[Install]
WantedBy=default.target
EOF

cat > ~/.config/systemd/user/sendy-public.service <<EOF
[Unit]
Description=Sendy Birdy public app (127.0.0.1:8001)
# On restarts, let the admin app migrate the database first.
After=sendy-admin.service

[Service]
WorkingDirectory=$APP
Environment=APP_MODE=public
ExecStart=$APP/.venv/bin/uvicorn app.main:create_app --factory --host 127.0.0.1 --port 8001
Restart=on-failure
RestartSec=5
NoNewPrivileges=yes

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now sendy-admin sendy-public
sudo loginctl enable-linger "$USER"     # start them at boot, even before you log in
```

Check them:

```bash
systemctl --user status sendy-admin sendy-public
journalctl --user -u sendy-public -f                 # live logs
curl -s http://127.0.0.1:8000/api/health             # {"status":"ok"}
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8001/api/health    # 404: not in the public app
```

Notes:

- **Run one process per app, no `--workers`.** Rate limits for password guessing are kept in memory per process; several workers would each count separately.
- User services can't wait for the system's PostgreSQL. If the machine boots and an app starts before the database is ready, the migration fails and systemd retries every 5 seconds until it works. The apps themselves only connect when the first request arrives.
- uvicorn believes the tunnel's `X-Forwarded-For` and `X-Forwarded-Proto` headers because they come from `127.0.0.1` (its default `--forwarded-allow-ips`). That's how the Activity page shows real visitor addresses and how the app knows the connection was HTTPS (for HSTS). Don't change that setting.

## 5. Expose only the public app

Pick **one** of the two options. Tailscale Funnel is the simpler one and is what this guide assumes elsewhere.

### Option A: Tailscale Funnel (free, no domain needed)

```bash
tailscale funnel --bg http://127.0.0.1:8001
```

The first time, the CLI shows a link to approve Funnel for your tailnet; it adds the `funnel` attribute to your policy file. After that, `https://homebox.tail1234.ts.net` is reachable from the whole internet, and it serves the public app only.

Funnel terminates HTTPS with a real certificate and tells the app so with `X-Forwarded-Proto: https`, plus the connecting address in `X-Forwarded-For`. The check in step 7 confirms the Activity page shows your visitors' real addresses.

Check what's exposed at any time:

```bash
tailscale funnel status
```

Turn it off with `tailscale funnel --https=443 off`.

### Option B: Cloudflare Tunnel (needs your own domain)

If your domain is on Cloudflare, `cloudflared` can expose the public app as, say, `https://files.example.com`:

```bash
# Install cloudflared from Cloudflare's package repository first, then:
cloudflared tunnel login
cloudflared tunnel create sendy
cloudflared tunnel route dns sendy files.example.com
```

`~/.cloudflared/config.yml`:

```yaml
tunnel: sendy
credentials-file: /home/you/.cloudflared/<tunnel id>.json
ingress:
  - hostname: files.example.com
    service: http://127.0.0.1:8001
  - service: http_status:404
```

Run it as a service with `sudo cloudflared service install` (see Cloudflare's docs for the details of your distribution), and set `PUBLIC_BASE_URL=https://files.example.com`.

Two things to know:

- **Video:** Cloudflare's terms for Free, Pro and Business plans restrict serving video and large files through its network. A share with demo videos may break the rules. Read [Delivering videos with Cloudflare](https://developers.cloudflare.com/fundamentals/reference/policies-compliances/delivering-videos-with-cloudflare/) before relying on it. Tailscale Funnel has no such rule (it has bandwidth limits, see the checklist).
- **No caching rules:** don't add "cache everything" page rules. The app sends the right `Cache-Control` for every response, and a shared cache must never keep a copy of a share after it's revoked.

In both options, the admin app still goes through Tailscale (next step), never through Cloudflare.

## 6. Reach the admin app from your devices

Serve the admin app on your private Tailscale network only, on its own HTTPS port:

```bash
tailscale serve --bg --https=8443 http://127.0.0.1:8000
```

From any device signed in to your tailnet, open **`https://homebox.tail1234.ts.net:8443`**. It has a real certificate, so the secure session cookie works, and nobody outside your tailnet can connect to it.

> **Never** run `tailscale funnel` on port 8443, or point a tunnel at port 8000. Serve and Funnel share ports, and whichever command ran last decides whether a port is private or public. `tailscale serve status` and `tailscale funnel status` show what's what.

## 7. Check it

**From the outside.** On your phone, turn Wi-Fi off and disconnect the Tailscale app, so you're on mobile data like a client:

- a share link (`https://homebox.tail1234.ts.net/s/…`) opens, with its images, video and notes;
- `https://homebox.tail1234.ts.net/` and `/login` say "Not Found": the public app has no admin pages;
- `https://homebox.tail1234.ts.net:8443` doesn't load at all.

Open the Activity page afterwards: the visit should show your phone's mobile-network address, not `127.0.0.1`.

**The headers.** Scan the public address with [Mozilla Observatory](https://developer.mozilla.org/en-US/observatory). It should rate it **A or better**: a strict Content-Security-Policy with no inline scripts, HSTS, `nosniff`, framing blocked (`frame-ancestors 'none'`) and `Referrer-Policy: no-referrer`. The page it scans (`/`) is a 404 in the public app; it carries the same headers as every other response. You can also look yourself:

```bash
curl -sI https://homebox.tail1234.ts.net/s/anything | grep -iE 'content-security|strict-transport|x-content-type|referrer|permissions'
```

## Backups

`make backup` saves the database and media into a new `sendy-backup-<time>` folder (see the [backup notes](#restoring) below). To run it every night and keep 30 days:

```bash
cd ~/sendy-birdy
APP="$PWD/backend"

cat > ~/.config/systemd/user/sendy-backup.service <<EOF
[Unit]
Description=Back up Sendy Birdy

[Service]
Type=oneshot
WorkingDirectory=$APP
ExecStart=$APP/.venv/bin/python -m app.cli backup %h/sendy-backups
# Old backups (and any interrupted .partial folder) go after 30 days.
ExecStartPost=/usr/bin/find %h/sendy-backups -mindepth 1 -maxdepth 1 -type d -name 'sendy-backup-*' -mtime +30 -exec rm -rf -- {} +
EOF

cat > ~/.config/systemd/user/sendy-backup.timer <<EOF
[Unit]
Description=Back up Sendy Birdy every night

[Timer]
OnCalendar=*-*-* 03:30
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now sendy-backup.timer
systemctl --user start sendy-backup        # try one now
ls -l ~/sendy-backups
```

A backup on the same disk only protects you from mistakes. **Copy `~/sendy-backups` to another machine or disk** (an external drive, another computer with `rsync`, encrypted cloud storage). The backups contain everything, password hashes included, so keep the copies private.

### Restoring

Restore goes only into an empty library, so it can never overwrite anything. On a new machine, do steps 1 to 3 (without `create-admin`), then:

```bash
cd ~/sendy-birdy/backend
uv run python -m app.cli restore ~/sendy-backups/sendy-backup-20261103-033000
```

It checks the backup before changing anything, restores it, and then checks every file against its recorded SHA-256. Your old admin password works again.

## Updating

```bash
cd ~/sendy-birdy
make backup                     # just in case
git pull
make install                    # new dependencies, if any
make build                      # the new frontend
systemctl --user restart sendy-admin sendy-public    # admin migrates first, then public starts
```

Keep the rest of the system updated too: the operating system (`unattended-upgrades` on Ubuntu/Debian), PostgreSQL's minor releases, and Tailscale (`sudo tailscale set --auto-update`).

## Checklist

- [ ] **Your internet provider's terms.** Some residential plans forbid running servers. A tunnel makes only outgoing connections, but the traffic is still yours. Read your plan's acceptable use policy.
- [ ] **The tunnel provider's terms.** Tailscale Funnel has bandwidth limits that you can't configure, so a client downloading large videos may be slow. Cloudflare's free plans restrict video (see option B).
- [ ] **Only the public app is exposed.** `tailscale funnel status` lists only port 443 → `127.0.0.1:8001`, and your router forwards no ports to this machine.
- [ ] **Nightly backups run, and copies leave the machine.** `systemctl --user list-timers` shows `sendy-backup.timer`. Try a restore once, on another machine, so you know it works before you need it.
- [ ] **`.env` is saved** in your password manager.
- [ ] **Updates:** you know how to update the app (above), and the system updates itself.
- [ ] **Log retention.** Visits are logged with IP address, browser and time for `LOG_RETENTION_DAYS` days (default 90), then deleted automatically. The share page tells clients exactly that, with your number. Pick the shortest period that's useful to you; if your clients are in the EU, a short, stated period helps you meet the GDPR.
- [ ] **Disk space.** Originals, thumbnails and backups all grow. Check now and then with `du -sh ~/sendy-birdy/data ~/sendy-backups`.
- [ ] **The machine stays on**, doesn't sleep, and comes back after a power cut (check your BIOS's "restore on AC power loss" setting).
