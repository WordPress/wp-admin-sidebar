# WP Admin Sidebar

> A grouped, customisable left navigation for any WordPress site.

[![License: GPL-2.0+](https://img.shields.io/badge/license-GPL--2.0%2B-blue.svg)](LICENSE)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

The wp-admin sidebar gets crowded fast. Install half a dozen plugins and the left nav balloons from twelve items to twenty-five, with WooCommerce, Yoast, Jetpack, and other plugin-added items competing with core. **WP Admin Sidebar** is a small WordPress plugin that improves the wp-admin sidebar, starting with personal rearrangement of items and a curated **Plugins** group that consolidates plugin-added entries at the bottom. Per-user, opt-in via an admin-bar toggle, fully reverts on deactivation. Drag, keyboard-reorder, or use a "Move to" menu to reposition any item; positions persist across sessions, per-site for each user.

![Personalizing the wp-admin sidebar: drag a plugin item out of the Plugins group to any position you like, then save.](https://raw.githubusercontent.com/WordPress/wp-admin-sidebar/trunk/.github/assets/plugins-reorder.png)

It is built incrementally on top of wp-admin: plain ES modules, no React, no Gutenberg surface — a thin layer of JavaScript over server-rendered HTML, and a small set of PHP filter hooks for hosts and adapter authors to shape the experience for their environments.

## Status

This is **v0.1.x — early prototype, public from day 1**. Inspired by Matt Mullenweg's ["Rethinking left navigation"](https://make.wordpress.org/core/2026/03/24/rethinking-left-navigation/) Make/Core post and the WordPress design teams' explorations. We are pairing with the WordPress.com / Automattic engineering effort that ships this same code as a managed-WordPress experience first.

The plugin is functional and shipping behind a sticker on a subset of WordPress.com sites today. The public-installable plugin shape is what this repo is for. See [`docs/roadmap.md`](docs/roadmap.md) for what's locked, what's open, and what's next.

## Try it

The fastest way is the WordPress Playground demo (no install, no setup):

> 🔗 **[Try in WordPress Playground →](https://playground.wordpress.net/?blueprint-url=https://raw.githubusercontent.com/WordPress/wp-admin-sidebar/trunk/.wordpress-org/blueprints/blueprint.json)**

The blueprint boots WordPress with a representative plugin set (WooCommerce, Contact Form 7, Classic Editor, Query Monitor), activates this plugin, and drops you in `wp-admin/`. Click **"Try the new sidebar"** in the admin bar to opt in.

To install on your own WordPress site:

1. Clone this repo into `wp-content/plugins/wp-admin-sidebar/`, or download the latest [release zip](https://github.com/WordPress/wp-admin-sidebar/releases) and upload via wp-admin Plugins → Add New → Upload Plugin.
2. Activate. The plugin is dormant until you opt in.
3. Click the **"Try the new sidebar"** item in the admin bar at the top of any wp-admin page. The page reloads with the redesigned sidebar.
4. Click again to switch back. Your saved layouts persist across opt-out / opt-in.

## How it works

- **Grouping.** Plugin-added top-level menu items get classified into a curated **Plugins** group at the bottom of the sidebar. Core items (Dashboard, Posts, Media, Pages, Comments, Appearance, Plugins, Users, Tools, Settings) keep their core positions. The classification is data-driven by a registry of common wp.org plugins (see [`src/registry.php`](src/registry.php)) plus a fall-through rule for everything else.
- **Per-user reorder.** Click the customize button next to a group to enter customizer mode. Drag any item, use keyboard reordering (arrows after focusing the grip), or use the **Move to** menu (3-dot trigger). Save persists the layout in `user_meta` for the current site.
- **Reset to default.** Customizer's "Reset to default" returns an item to its baseline group + position from the classifier.
- **Per-site, per-user.** Each user's saved layouts are scoped per site — a multi-site network or WordPress.com user with several sites gets independent layouts.
- **No core changes.** The plugin runs entirely as a wp-admin overlay: it reads `$menu`/`$submenu`, classifies, then reorders DOM nodes client-side with the server's pre-classified data block.
- **Accessibility.** Keyboard-navigable end-to-end (tab, focus visible, screen-reader live region for moves). WCAG AA conformance is the README-promised target.
- **Performance.** Browse-rail bundle ≤ 12 KB gzipped (CI gate). Customizer bundle ≤ 60 KB. Plain ES modules, no build step, no React. The classifier runs once per admin request (`in_admin_header` priority 1) and is short-circuited when the gate is off — non-opted-in users see no overhead beyond a sub-millisecond filter check.

For the architectural details — `/src/` layout, file responsibilities, contracts — see [`docs/architecture.md`](docs/architecture.md).

For host-adapter authors (e.g., a managed-WordPress host wanting to add a "Hosting" group with their own items): [`docs/host-extension-api.md`](docs/host-extension-api.md). The full filter API is documented there with three worked examples.

For prior art and how this plugin relates to other community efforts: [`docs/related-work.md`](docs/related-work.md).

## Roadmap

| Phase | What | Status |
|---|---|---|
| **v0.1.x** | Public scaffold, in-the-open development, early adopters | active (now) |
| **v0.2.x** | Stable host-adapter API, WordPress.com vendor cutover, Make/Core announcement, Reddit launch | next |
| **v0.3.x** | Submission to wordpress.org plugin directory, percentage-rollout on WordPress.com | following |
| **v1.0** | API stability promise, deprecation policy locked, broader rollout | when public extension API has soaked |
| **future** | Make/Core proposal for upstream — what core could adopt from the prototype | gated by community signal |

See [`docs/roadmap.md`](docs/roadmap.md) for milestone-by-milestone detail.

## Contributing

Bug reports, design feedback, and host-adapter questions all welcome.

- **Engineering work**: GitHub Issues + PRs. Run `composer install`, `npm install`, `npm run lint`, `php tests/test-grep-no-wpcom-tokens.php` before opening a PR. See [`CONTRIBUTING.md`](CONTRIBUTING.md).
- **UX / design feedback / "should we…?" questions**: GitHub Discussions.
- **Security issues**: see [`SECURITY.md`](SECURITY.md). Don't open a public issue.
- **Host-adapter authoring**: read [`docs/host-extension-api.md`](docs/host-extension-api.md), then ask in the **Host Adapters** Discussion category.

## License

[GPL-2.0-or-later](LICENSE). Copyright the contributors. By submitting a contribution you license it under GPL-2.0+.

## Maintainers

See [`MAINTAINERS.md`](MAINTAINERS.md). Initial maintainer set: Christos Koumenides ([@chriskmnds](https://github.com/chriskmnds)) and Lucas Mendes ([@lucasmdo](https://github.com/lucasmdo)).
