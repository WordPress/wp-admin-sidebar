# Architecture

A short tour of how the plugin is laid out and why. This page is for someone who's read the README and wants to understand the code before opening a PR.

For the host-adapter contract — filters, actions, interfaces — see [`docs/host-extension-api.md`](host-extension-api.md).
For the data contracts — `navModel`, `LayoutDelta`, classification entries — see [`docs/contracts.md`](contracts.md).

## Layout

```
wp-admin-sidebar.php                    Plugin bootstrap. Plugin header, four constants,
                                        require_once chain, hooks, default storage binding,
                                        enablement gate (default: enabled for any logged-in user).
src/
├── interface-sidebar-storage.php       The storage contract: get_layouts / put_layouts.
├── class-user-meta-storage.php         Default storage. Writes to user_meta keyed per site.
├── class-sidebar-normalizer.php        Normalizes raw $menu/$submenu into a stable shape.
├── class-sidebar-signals.php           Extracts attention/badge/count signals from menu titles.
├── class-sidebar-classifier.php        Reads $menu/$submenu, classifies items into the registry,
                                        builds the navModel that the JS consumes.
├── class-sidebar-data-planner.php      Emits the inline `wpAdminSidebarData` JSON block
                                        in the page head, with navModel + saved layout delta + meta.
├── class-sidebar-rest.php              REST endpoints + admin-ajax fallback handler.
                                        Validates the LayoutDelta, persists via the storage interface.
├── registry.php                        Curated classification registry: ~200 wp.org plugins
                                        with their default group + display label.
├── browse-rail/                        Default-mode JS. Wraps items into the grouped sidebar,
                                        attaches expand/collapse, paints signals.
│   ├── browse-rail.js                  Entry point.
│   ├── grouping.js                     DOM mutation: wraps plugin items into the Plugins group.
│   ├── expand-collapse.js              Group toggle behavior.
│   ├── signal.js                       Renders the per-item attention dot.
│   ├── styles.css                      Group + signal CSS.
│   └── icons/                          Inline SVG sources used by the rail.
└── customizer/                         Customizer-mode JS. Loaded lazily on customize-button click.
    ├── customizer.js                   Entry point. enterCustomizer, exitCustomizer, auto-save, undo.
    ├── draft-state.js                  Pure state: createState, moveItem, resetItem, saved/working deltas.
    ├── drag-drop.js                    Drag with synthetic ghost + drop indicator.
    ├── keyboard-reorder.js             Arrow keys + Enter/Space-to-pick semantics.
    ├── move-menu.js                    3-dot trigger + "Move to" popup.
    └── customizer.css                  Customizer-mode CSS scoped under body.wp-admin-sidebar-mode-customize.

tests/
├── bootstrap.php                       Test scaffolding: minimal WP shims for CLI runs.
├── test-grep-no-wpcom-tokens.php       CI gate: no host-specific tokens in /src/.
├── test-rest.php                       validate_delta unit tests.
├── test-signals.php                    Signals extraction unit tests.
└── test-normalizer.php                 Normalizer unit tests.
```

## Data flow (one wp-admin page request)

```
[admin_menu]                          ← wp-admin builds $menu/$submenu (other plugins hook here)
↓
[in_admin_header priority 1]
Sidebar_Classifier::build_nav_model()  ← reads $menu/$submenu, classifies via registry,
                                         builds the navModel (groups + items)
↓
[in_admin_header priority 2]
Sidebar_Data_Planner::emit()           ← emits inline <script id="wp-admin-sidebar-data">
                                         containing { navModel, layoutDelta, meta }
↓
[browser receives HTML]
↓
[DOMContentLoaded]
browse-rail.js entry script runs       ← reads wpAdminSidebarData,
                                         wraps DOM into groups,
                                         applies saved layout overrides,
                                         attaches expand/collapse handlers
↓
[user clicks customize button]
customizer.js dynamic-imported         ← lazy-loaded; entry into customizer mode
↓
[user moves an item]
POST /wp-json/wp-admin-sidebar/v1/layout (or admin-ajax fallback)
↓
[Sidebar_Rest::handle_post]
validate_delta + storage->put_layouts  ← persists to user_meta (or host-bound storage)
↓
[user clicks Done]
exitCustomizer()                       ← back to default mode, body class restored
```

Every code path that produces user-visible behavior or data emission is gated by the `wp_admin_sidebar_enabled` filter. The default is `true` for any logged-in user (install is the opt-in). When a host adapter overrides the filter to `false` for a given user/blog, the classifier's `build_nav_model()` early-returns at the gate, the data planner finds null and early-returns, the asset enqueue closure returns, the body-class filter returns unchanged, the REST routes return 401 from `permission_check`. Net cost on a gate-disabled user: a few hundred microseconds for the filter check and the bootstrap's class-load pass.

## Key design decisions

### No build step

The plugin ships plain ES modules. `script_loader_tag` filter swaps the `<script>` tag to `type="module"` for the entry; sibling modules dynamic-import via `import.meta.url`-derived URLs (so the cache-bust suffix flows through). No bundler, no transpiler, no webpack, no Vite (yet). This keeps the contribution barrier low — a developer who knows wp-admin's PHP-and-jQuery world can read this codebase without setup.

A build step (target: Vite, lifted from `WordPress/desktop-mode`'s pattern) becomes load-bearing if/when bundle-size CI gates start failing without minification. Until then, plain ES2020+ syntax is the contract.

### Plain `require_once`, no PSR-4

Follows the convention used by `WordPress/desktop-mode` and the WordPress.com mu-plugin where this code was incubated. The bootstrap is a flat list of `require_once` calls; each class file declares a procedural-style class name (`Sidebar_Classifier`, `Sidebar_Rest`, …). No autoload, no namespace, no PSR-4. WordPress plugin idiom.

### Filter-API, not service container

Hosts integrate by hooking documented filters and actions, not by injecting services or extending classes. This is idiomatic WordPress and minimises cognitive overhead for plugin authors; if you've written a WordPress plugin before, you know how to extend this one.

### Mid-deploy safety

The bootstrap includes a `file_exists` guard around every required file before the require chain runs. On environments where deploys land files non-deterministically (rsync-style), a partial deploy in which `wp-admin-sidebar.php` arrives before `src/class-sidebar-rest.php` would fatal on `require_once` without the guard. Plus a per-call `file_exists` wrapper on the require line and a `class_exists` guard at the `Sidebar_Rest::register()` call site for static analyzers (gherald) that pattern-match on per-call wrapping.

### `/src/` portability

The `/src/` tree is the portable plugin source — no host-specific function calls, no `IS_WPCOM`, no `update_user_attribute`, no host-detection. The CI gate `tests/test-grep-no-wpcom-tokens.php` enforces this; the build fails if any token from a canonical host-only list appears under `/src/`. This is what makes the plugin runnable on plain WP, on managed hosts, on WordPress.com — same code, different filter bindings.

### Stale-item preservation, ghost-group rejection

`validate_delta` deliberately accepts override entries with unknown `itemId`s — this preserves a saved override for a deactivated plugin so it re-applies on reactivation. But it rejects unknown `group_id`s — groups are platform-stable (registered by the registry or by hosts via `wp_admin_sidebar_top_groups`), so a ghost id would silently no-op at render time. The rules were called out by Codex in PR review and codified in `Sidebar_Rest::active_group_ids()`.

## Where to read more

- **Filter signatures + worked host-adapter examples**: [`docs/host-extension-api.md`](host-extension-api.md).
- **Data contracts** (`navModel`, `LayoutDelta`, classification entries, REST schema): [`docs/contracts.md`](contracts.md).
- **Why this plugin exists vs. other prior art**: [`docs/related-work.md`](related-work.md).
- **Roadmap**: [`docs/roadmap.md`](roadmap.md).
