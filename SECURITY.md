# Security policy

## Reporting a vulnerability

Do not open a public issue for a security problem. Use GitHub's private vulnerability reporting: [report a vulnerability](https://github.com/cristoslc/bb-plugin-activity-overview/security/advisories/new).

Include the affected Activity Overview version, the bb version, the steps to reproduce, and what an attacker gains. Quote any output verbatim.

## Supported versions

Only the latest release on `main` receives fixes. Activity Overview is installed by tag, so upgrading is a semver-range bump in bb.

## Scope

Activity Overview runs inside bb as a plugin and keeps no state of its own. Its backend is one stateless read that samples token usage; the aggregate views run entirely in the frontend and write nothing. Reports about the plugin's code, its reads, and anything it sends are in scope. Problems in bb itself belong with the bb project.
