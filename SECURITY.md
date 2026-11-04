# Security policy

Sendy Birdy is self-hosted: every instance is run by its owner, on their own machine. A vulnerability here can expose files people sent to their clients, so reports are very welcome.

## Supported versions

Fixes go into the latest release. Please check the issue still happens on it before reporting.

| Version | Supported |
|---|---|
| 1.x (latest) | Yes |
| Older | No |

## Reporting a vulnerability

**Please don't open a public issue.** Report it privately through GitHub instead: on the repository's **Security** tab, choose **Report a vulnerability** ([direct link](../../security/advisories/new)).

Include what you can of:

- what an attacker can do, and what they need first (a share link, the admin password, network access…);
- steps to reproduce, or a proof of concept;
- the version or commit, and whether you used Docker or the self-hosting guide.

You'll get an answer within 7 days. Once the issue is confirmed, a fix is released as soon as possible, with an advisory that credits you (unless you'd rather not be named).

## Scope

Especially interesting:

- reaching anything of the admin app (API, files, sign-in) through the public app;
- opening a share link's content without its token, after it expired or was revoked, or without its password;
- getting around the upload checks (type detection, size limit, image size limit) or the stripping of photo metadata;
- XSS, CSRF, or a way around the Content-Security-Policy;
- leaking the session or unlock cookies, password hashes or the activity log.

Out of scope:

- a client saving what they can see while downloads are off (that's a [documented limit](README.md#security-model));
- problems that need the admin's own machine or account to already be compromised;
- an instance exposed in a way the [self-hosting guide](docs/self-hosting.md) warns against, such as putting the admin app on the internet;
- denial of service by sheer traffic, and reports from automated scanners without a demonstrated impact.
