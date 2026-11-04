# Changelog

All notable changes to Sendy Birdy are listed here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-11-04

The first release: everything needed to send work to clients from your own machine.

### Library

- Upload images (PNG, JPEG, WebP, GIF) and videos (MP4, WebM, MOV) by picking, dragging and dropping, or pasting them. Several upload at once, with progress, cancel and retry, and they keep going while you use the rest of the app.
- Write notes in Markdown, with a live preview.
- Photos lose their EXIF and GPS data on upload and keep their colour profile. Videos get a poster frame and a duration when ffmpeg is installed.
- Browse everything in a grid with search and filters, open items in a full-screen viewer, rename them inline, and select several to share or delete at once.

### Sharing

- Turn a selection into a share link with a title, a Markdown message, your chosen order, an expiry date (or none), an optional password and a downloads on/off switch.
- Manage every link from the Shares page: status, views, copy, edit, change the expiry, revoke or delete.
- Clients open a share page made for phones, with no account. Password-protected links ask for the password first.

### Activity and privacy

- A log of link views, downloads, failed unlocks, sign-ins, revoked links and deleted items, with each visitor's IP address and browser. Entries are deleted after 90 days (`LOG_RETENTION_DAYS`), and share pages tell clients what's logged.

### Security

- Single admin account, managed from the command line; Argon2id passwords; cookie sessions with only a hash stored; CSRF protection.
- A separate public app that contains only the share pages, so the admin side never has to be on the internet.
- Rate limiting on sign-in and on link passwords.
- A strict Content-Security-Policy and security headers on every response.

### Running it

- `make` targets for development, checks, the production build and starting both apps.
- Backup and restore of the database and every file from the command line (`make backup`).
- A self-hosting guide: systemd user services, Tailscale Funnel or Cloudflare Tunnel, private admin access, nightly backups, updates and a checklist.
- A Docker image and a compose file for both apps and PostgreSQL.
- CI with linting, type checks, unit and API tests, browser tests with axe accessibility checks, and a Docker smoke test.

[1.0.0]: ../../releases/tag/v1.0.0
