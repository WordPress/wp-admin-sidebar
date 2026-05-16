# Roadmap

A milestone-by-milestone view of where the plugin is going. Updated as we ship.

> See also the prose framing in [`README.md` § Status](../README.md#status), the architectural commitments in [`docs/architecture.md`](architecture.md), and the host-extension contract in [`docs/host-extension-api.md`](host-extension-api.md).

## v0.1.x — public scaffold (current)

**Status: in flight.** What this milestone delivers:

- This repo, public from day 1, GPL-2.0+, GitHub Issues + Discussions enabled.
- The portable plugin source (`/src/`) — verbatim copy from where the code was incubated as a WordPress.com mu-plugin. Plain ES modules, plain PHP, no build step, no React.
- Bootstrap `wp-admin-sidebar.php`: plugin header, four constants, mid-deploy file_exists guards, hooks, default storage binding, enablement gate (default: enabled for any logged-in user — install is the opt-in; hosts can override the `wp_admin_sidebar_enabled` filter for per-blog/per-user/percentage control).
- Documented filter API + host-extension guide ([`docs/host-extension-api.md`](host-extension-api.md)).
- Repo metadata: README, CONTRIBUTING, SECURITY, MAINTAINERS, LICENSE.
- Issue templates + Discussions categories.
- WordPress Playground blueprint: try-without-installing demo.

**Exit criteria:** repo discoverable by anyone reading Matt's "Rethinking left navigation" Make/Core post; a WordPress contributor unfamiliar with the project can clone, install, and exercise the plugin in under 5 minutes.

## v0.2.x — vendor cutover + public launch

The WordPress.com version of this plugin migrates from its in-tree mu-plugin form to consuming this published release wholesale, via an in-tree-copy synced from a tagged release. Concurrently, we announce publicly.

**Deliverables:**

- WordPress.com integration mu-plugin: a small (~500 LOC) adapter that hooks `wp_admin_sidebar_storage`, `wp_admin_sidebar_enabled`, `wp_admin_sidebar_layout_rest_url`, and the `wp_admin_sidebar_layout_saved` action. The previous in-tree-mu-plugin content is removed at the same cutover; the host now consumes this public release as in-tree-copy.
- Make/Core post: announce the plugin, link to the Playground demo, ask for feedback. Cross-link to Joen's, Kelly's, James's prototypes — frame as complementary rather than competing.
- Reddit `/r/WordPress` launch post: same spirit, audience-tailored to site owners and small agencies.
- Stable host-adapter API in `docs/host-extension-api.md` v2 (we document any breaking changes from v0.1 here, but expect none — the API is already what we want).
- Filter alias deprecation cycle: `wp_admin_sidebar_*` is canonical, `wpcom_admin_sidebar_*` aliased through this milestone.

(A WordPress Slack channel for ongoing public conversation may make sense once the project's volume warrants it. We'll evaluate the need based on the post-launch traffic pattern rather than committing now.)

**Exit criteria:** WordPress.com rollout has the new in-tree-copy plugin running in production for ≥ 1 week with no open regressions; Make/Core post live; Reddit post live; community feedback channels active.

## v0.3.x — wp.org submission + percentage rollout

**Deliverables:**

- Submit to wordpress.org/plugins/. ~2-4 week review window. `readme.txt` (already in repo) documents external services (none), screenshots, FAQ.
- Drop the legacy `wpcom_admin_sidebar_*` filter aliases. Hosts who haven't migrated by this point break loudly; the migration is a one-line search-and-replace.
- WordPress.com sticker progression: 10% → 50% → 100% percentage rollout (re-introduces the percentage-rollout primitive that was dialed back during incubation).
- WP-CLI commands: `wp admin-sidebar enable/disable/reset --user=N`.

**Exit criteria:** plugin is installable from wordpress.org/plugins; A8C rollout is at 100%; no open critical issues; first usability-test results in (positive or with a clear list of follow-ups).

## v1.0 — API stability promise

**Deliverables:**

- Lock the filter API: signatures frozen, breaking changes only across major versions with a documented deprecation window.
- Pin the public extension API in `docs/host-extension-api.md` as v1.
- Publish the API stability promise in the README.

**Exit criteria:** plugin has had a sustained period of stable rollout (≥ 1 month at 100% on a large managed-WordPress host, plus active in the wp.org plugin directory), no open critical issues, host adapters in use beyond just WordPress.com (or the API is deemed ready regardless).

## v2 — full-sidebar personalization

**Gated by design sign-off + community signal.** v0.1 through v1.0 deliberately scope reorder to plugin-added items inside the curated Plugins group. The May 2026 usability round (3 testers) and the Reddit launch thread independently asked for the whole sidebar to be personalizable, not just the Plugins group. v2 is where that scope expansion is evaluated and, if the design holds up, delivered.

**Candidate scope:**

- Reorder or move *any* sidebar item, not only plugin-added ones ([#68](https://github.com/WordPress/wp-admin-sidebar/issues/68)).
- Broader ordering options: alphabetical, per-user custom, scoped vs. global ([#14](https://github.com/WordPress/wp-admin-sidebar/issues/14)).
- One built-in, user-managed "More" group as a lower-priority destination, with no arbitrary user-defined groups yet ([#13](https://github.com/WordPress/wp-admin-sidebar/issues/13)).

**Why it's gated, not committed.** Core item positions are load-bearing: wp-admin internals, plugins, documentation, and screenshots assume them. Making them user-movable needs a design pass plus stable identifiers for core items, an all-items "reset to default", and a persistence model that extends beyond today's plugin-slug keys. The stored layout contract already supports arbitrary placement, so this is a UI-scope and design decision, not a storage migration.

**Exit criteria:** design sign-off on the full-sidebar interaction and reset model; the three tracked issues resolved or explicitly descoped; no regression to the default (unconfigured) sidebar, which still preserves core positions.

## Future — Make/Core proposal

**Gated by community signal.** If the plugin gains traction in the public WordPress space (real users, not just A8C-internal), we open a Make/Core proposal extracting the core-portable parts:

- A typed group-classification model.
- A typed signal API (so plugins stop injecting HTML into menu titles).
- A user-level sanctioned layout API (so persistent reordering doesn't depend on an external plugin).

This is **Track A** of Phase C in the project's planning. Track B (engineering PR campaign for upstream adoption) is gated by Track A's reception.

## What's not on the roadmap

We deliberately don't have plans for:

- **A radical IA reimagining** (Joen / Kelly / James are exploring those; we stay incremental and complementary).
- **A React or Gutenberg-component rewrite** (the sidenav is a "sprinkle of JS on top of server rendering" surface — we keep it that way for the foreseeable future, per Sergio Gomes' guidance and our own perf budgets).
- **Mobile-specific sidebar UI** (out of scope until a separate design pass; the current sidebar inherits wp-admin's mobile behavior unchanged).
- **A vertical-tabs / collapsed-core information architecture** (we won't restructure core into a different IA, and the default sidebar never moves or hides core items on the user's behalf). Note: *user-initiated* full-sidebar personalization is a different thing, and is no longer a non-goal. It is now tracked as the gated **v2 — full-sidebar personalization** milestone above.

If you want to argue any of these on, open a Discussion. We listen.

## Tracking

- **GitHub Milestones**: the version phases above map to GitHub Milestones on this repo. `v0.3 — wp.org submission + rollout hardening` and `v2 — full-sidebar personalization` are open; issues are filed against them as scope firms up.
- **Public roadmap board**: GitHub Projects (V2) — columns mirror the milestones above.
- **Internal coordination**: Linear DES-* project (private, A8C-internal) tracks WordPress.com rollout-specific items.
- **Public docs**: this file is authoritative for milestone scope; PRs that reshape the roadmap touch this file.
