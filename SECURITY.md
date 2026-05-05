# Security policy

## Reporting a vulnerability

Please report security issues privately, **not** as a public GitHub Issue.

**Preferred channel:** [GitHub Security Advisories](https://github.com/WordPress/wp-admin-sidebar/security/advisories/new) — opens a private discussion thread with the maintainers.

**Backup channel:** email `security@automattic.com` with the subject line `WP Admin Sidebar — security report`. The Automattic security team triages and forwards to this project's maintainers.

## What to include

- A description of the issue.
- Reproduction steps (or proof-of-concept code if you have one).
- The affected version of the plugin (run `php -r "require 'wp-admin-sidebar.php'; echo WP_ADMIN_SIDEBAR_VERSION;"` or check the plugin header).
- Your assessment of impact (privacy / integrity / availability).

## Response

- We aim to acknowledge within **48 hours** of receipt.
- We follow a **coordinated disclosure window of 90 days** from the acknowledgment. After 90 days, the report is published in the GitHub Security Advisory regardless of fix status, with a clear statement of mitigations and any user actions required.
- If the issue is also present in WordPress core or in a host-side adapter (e.g., the WordPress.com integration mu-plugin), we coordinate with those teams in private before public disclosure.

## Scope

In scope: this plugin's PHP source (`src/`, `wp-admin-sidebar.php`), JS source (`src/browse-rail/*`, `src/customizer/*`), tests, and documented filter API.

Out of scope: third-party host adapters that hook our filter API (those are the host's responsibility); WordPress core; downstream forks.

## Hall of fame

We acknowledge security researchers in advisory disclosures and (with permission) in the project's release notes.
