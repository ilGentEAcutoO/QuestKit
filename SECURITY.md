# Security Policy

## Supported Versions

QuestKit is in pre-1.0 development. Only the latest `0.1.x` release line
receives security updates.

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1   | :x:                |

## Reporting a Vulnerability

**Please do not open a public GitHub issue for vulnerabilities.**

Report security issues privately to **security@questkit.dev** (placeholder —
update before public launch). Include:

- A description of the issue and its impact
- Steps to reproduce, or a proof-of-concept
- Any suggested fix
- Whether you would like credit in the changelog

You can expect:

- **Acknowledgement within 48 hours** of receipt
- A status update within 7 days with a preliminary assessment
- A fix or mitigation plan within 30 days for high-severity issues, longer
  for lower-severity issues

## Disclosure Policy

QuestKit follows responsible disclosure. We will work with you to validate
and reproduce the issue, ship a fix, and coordinate the public advisory.
Our default coordination window is **90 days** from initial report; we may
agree to a shorter or longer window depending on severity and complexity.

## Scope

In scope:

- The API Worker (`workers/api`)
- The webhook relay and consumer Workers
- The published `@questkit/*` npm packages
- The embed bundle (`@questkit/embed`)

Out of scope:

- The demo, docs, and playground sites (purely static, no auth)
- Cloudflare platform vulnerabilities (please report to Cloudflare directly)
- Issues in third-party dependencies (please report upstream; we will pull
  patched versions promptly)

## Hall of Fame

Researchers credited here once we receive the first valid report.
