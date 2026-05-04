# Contributing to WP Admin Sidebar

Thanks for considering a contribution. This project follows the WordPress project's general code-contribution norms and the [WordPress Code of Conduct](https://make.wordpress.org/handbook/community-code-of-conduct/).

## Reporting bugs

Open a [GitHub Issue](https://github.com/Automattic/wp-admin-sidebar/issues) with:

- WordPress version, PHP version, browser
- List of active plugins (or a representative subset that reproduces the issue)
- Reproduction steps
- Expected behavior vs. observed behavior
- Console errors / screenshots if relevant

For **security issues**, see [SECURITY.md](SECURITY.md). Do not open a public issue.

## Design feedback / open questions

For UX questions, "should we…?" discussions, demo recordings, or feature ideas without a concrete acceptance criterion, use [GitHub Discussions](https://github.com/Automattic/wp-admin-sidebar/discussions). The **Ideas** and **Q&A** categories are the natural homes for early-stage design conversations.

## Code contributions

### Setup

```bash
git clone https://github.com/Automattic/wp-admin-sidebar.git
cd wp-admin-sidebar
npm install         # devDependencies (jest, jsdom)
composer install    # devDependencies (phpunit, polyfills) — when composer.json is added
```

Drop the repo into `wp-content/plugins/` of any WordPress site (a fresh [Playground](https://playground.wordpress.net/) instance works for quick checks; clone into a vanilla WP install for longer iteration).

### Before opening a PR

Run the local test suite:

```bash
php tests/test-grep-no-wpcom-tokens.php   # CI gate: no host-specific tokens in /src/
php tests/test-rest.php                    # REST validate_delta unit tests
php tests/test-signals.php                 # signal-extraction unit tests
php tests/test-normalizer.php              # normalizer unit tests
npm test                                   # Jest tests for browse-rail
```

All four PHP scripts exit 0 on success. The grep test is enforced in CI.

### Architecture and conventions

Read [`docs/architecture.md`](docs/architecture.md) for the layout, then [`docs/host-extension-api.md`](docs/host-extension-api.md) if your change touches anything filter-API-shaped.

Coding conventions:

- **PHP**: WordPress Coding Standards. PHP 8.0+ syntax features welcome (null-safe, named args, match expressions, typed properties). No PSR-4; we follow the WordPress plugin idiom of plain `require_once` + procedural class names (`Sidebar_Classifier`, `Sidebar_Rest`, etc.).
- **JS**: plain ES modules (`type="module"` in the page, dynamic import for siblings). No build step, no React, no `@wordpress/*` runtime dependencies. We rely on browser-supported ES2020+ syntax.
- **CSS**: vanilla CSS, scoped under `body.wpcom-sidebar-active` (and during customizer mode, `body.wpcom-sidebar-mode-customize`). No preprocessors.
- **Comments**: explain WHY, not WHAT. The codebase tries to keep load-bearing decisions documented inline rather than buried in commit messages.

### Pull requests

1. Fork the repo, create a feature branch off `trunk`.
2. Make your change. Keep PRs small and focused (one concern per PR).
3. Run the test suite locally; make sure CI is green.
4. Open the PR against `trunk`. Reference any related Discussion or Issue.

The first 5 PRs from a new contributor are reviewed by a maintainer regardless of CI status (sanity check the contribution flow). After 5 merged PRs, contributors can be invited to the `triage` team (issue-label management, no merge rights).

By submitting a contribution you license it under GPL-2.0-or-later. We don't require a CLA.

## Host-adapter authoring

If you maintain a managed-WordPress host (Pressable, WP Engine, Kinsta, etc.) and want to add a "Hosting" group with your own items, you don't need to fork or modify this plugin. Read [`docs/host-extension-api.md`](docs/host-extension-api.md) — it documents the filter API and shows three worked examples. Ask any clarifying questions in the **Host Adapters** Discussion category.

## Maintainers

See [`MAINTAINERS.md`](MAINTAINERS.md) for the current set + how to reach them.
