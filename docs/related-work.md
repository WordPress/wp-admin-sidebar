# Related work

This plugin lives in a community conversation. Several explorations in WordPress.org spaces (and in adjacent commercial WordPress companies) have addressed the same pain — the wp-admin sidebar getting cluttered as plugins accumulate. This page lists those efforts with one-line characterizations and links, so that anyone arriving at this repo can place it in the broader landscape.

## The conversation

### Make/Core: "Rethinking left navigation" (Matt Mullenweg, 2026-03-24)

<https://make.wordpress.org/core/2026/03/24/rethinking-left-navigation/>

The post that kicked off the current wave of explorations. Frames the pain — install a few plugins and the sidebar's information hierarchy breaks — and invites the community to propose redesigns. The comment thread on that post is where most of the public ideas surfaced.

This plugin takes the **incremental** path: rather than a full information-architecture reimagining, ship something that works with the components wp-admin already has, today. We see ourselves as complementary to the more ambitious explorations below.

## Prior-art designs

### Joen Asmussen — `wp-leftbar` / `wp-topbar` prototypes

<https://dotorgdesign.wordpress.com/2026/04/02/wordpress-navigation-a-prototype/>

Joen's prototypes (on Joen's [dotorgdesign](https://dotorgdesign.wordpress.com/) P2) explore a fuller redesign of both the left bar and the top bar of wp-admin. They're broader in scope than this plugin and propose a different IA (drill-down navigation rather than grouping). Worth studying for the alternative information architecture.

### Kelly Choffman — full nav redesign

<https://make.wordpress.org/core/2026/03/24/rethinking-left-navigation/#comment-48618>

Kelly's prototype at [`lighthearted-zuccutto-8d284c.netlify.app`](https://lighthearted-zuccutto-8d284c.netlify.app/) reimagines the sidebar as a more minimal, search-first navigation. Different posture than this plugin (we keep the sidebar, just group it; Kelly's design replaces it).

### James Koster — navigation explorations

<https://make.wordpress.org/core/2026/03/24/rethinking-left-navigation/#comment-48597>

James's prototype at [`wordpress-navigation.vercel.app`](https://wordpress-navigation.vercel.app/) is in the design-system tradition — explores a full WP-component-based navigation. Useful reference for what wp-admin's nav could look like if it adopted Gutenberg components.

### Brian Coords — Playground blueprint navigation experiment

Brian shared a Playground blueprint that boots a representative WordPress install with multiple plugins so you can experience the plugin-sprawl problem firsthand. We borrow the blueprint pattern (see [`.wordpress-org/blueprints/blueprint.json`](../.wordpress-org/blueprints/blueprint.json)) so anyone can try this plugin in their browser without installing anything.

### Beau Lebens / WooCommerce — drill-down navigation

The WooCommerce team has been building a drill-down navigation pattern that consolidates WC's many top-level items (Products, Analytics, Payments, Marketing) under a single WooCommerce drill-down. Different solution to a related problem (Woo's many items vs. plugin-sprawl in general). The two designs are **compatible**: when WC's drill-down ships and is active, this plugin's classifier can detect it and treat the consolidated WC item as a single registry entry rather than five separate items. Discussion in the **Host Adapters** GitHub Discussion category.

## How this plugin differs

Compared to the prior-art designs, this plugin's posture is:

- **Incremental, not radical.** We keep wp-admin's existing nav structure and overlay a grouping behavior on top. Plugin items collapse into a "Plugins" group at the bottom; core items keep their core positions. A user who already knows wp-admin still finds Dashboard, Posts, Tools, Settings exactly where they always were.
- **Opt-in, not default.** Users opt in via an admin-bar toggle (mirroring [WordPress/desktop-mode](https://github.com/WordPress/desktop-mode)'s pattern). Default-off until the user clicks "Try the new sidebar."
- **Per-user, not per-site.** Each user customises their own layout, persisted per-site. A site has many users with different preferences; each manages their own.
- **Filter-API-driven, not Core-PR-driven.** Hosts and plugin authors integrate via documented filters. We're a layer on top of wp-admin, not a replacement for it. If/when Core wants to upstream parts of this, the filter contract is what would graduate.
- **Plain JS + PHP, no React, no Gutenberg.** The sidenav surface is a few hundred lines of vanilla ES modules and procedural PHP — small bundle, no build step, no framework lock-in.

## Other reference implementations and ecosystem

- **WordPress Desktop Mode** — [`github.com/WordPress/desktop-mode`](https://github.com/WordPress/desktop-mode). The shape we modeled this plugin's contribution model on. Same posture: opt-in per user, doesn't change Core, fully reverts on deactivation, lives under the WordPress GitHub org.
- **WordPress.com sidebar redesign rollout** — the WordPress.com team is shipping this same code as a managed-WordPress experience. The WordPress.com integration mu-plugin (`wp-admin-sidebar-integration`) consumes this plugin's filter API to add WordPress.com's sticker-based gating, user-attribute-backed storage, and Atomic-cache-flush behaviour. Other managed-WordPress hosts can follow the same pattern.

## Conversation channels

- **Make/Core thread on Matt's 2026-03-24 post** — the broadest design conversation; comment there if you have an alternative direction in mind.
- **GitHub Discussions** — code-focused, host-adapter-focused, and "should we…?" questions on this plugin specifically.
- **Reddit `/r/WordPress`** — we post launch + iteration updates here; the audience is hands-on site owners and small agencies, the people who feel the plugin-sprawl pain most.

If you've explored this space and your work isn't listed here, please open a PR adding it. We want this page to be a useful map of the conversation, not a curated subset.
