# Host extension API

This document is for **host authors** — managed-WordPress hosts (WP Engine, Pressable, Kinsta, WordPress.com, etc.) who want to extend the sidebar with their own group of items, change defaults, or rebind storage. It is also the reference for **plugin authors** who want their plugin item placed in a specific group by default.

The plugin's runtime is built around five filters and two actions. Hosts hook them from a separate plugin (or mu-plugin); this plugin never branches on host detection.

> **Filter naming note.** This document uses both the legacy `wpcom_admin_sidebar_*` filter names and the canonical `wp_admin_sidebar_*` aliases. Both fire side-by-side for one deprecation cycle (v0.1.x → v0.2.x). The legacy names will be dropped in v0.3.x. New code should hook the `wp_admin_sidebar_*` form.

## Filters

### `wp_admin_sidebar_enabled`

Gate the entire feature for the current user.

```php
apply_filters( 'wp_admin_sidebar_enabled', bool $enabled, int $user_id ): bool
```

The plugin's default returns `false` unless the per-user `wp_admin_sidebar_enabled` user-meta flag is set to `1`. v0.1.x intentionally ships no UI for flipping that flag; sites flip it via wp-cli (`wp user meta update <id> wp_admin_sidebar_enabled 1`) or via a host adapter that binds this filter directly. A host can force on/off with this filter. The filter runs at every relevant hook: `in_admin_header` (data-pipeline gate), `admin_enqueue_scripts` (asset-enqueue gate), `admin_body_class` (CSS scope gate), and on REST + admin-ajax permission checks.

**WordPress.com binding (illustrative):**

```php
add_filter( 'wp_admin_sidebar_enabled', function ( $enabled, $user_id ) {
    if ( ! function_exists( 'has_blog_sticker' ) ) {
        return $enabled;
    }
    if ( ! has_blog_sticker( 'wp-admin-sidebar-redesign', get_current_blog_id() ) ) {
        return false;
    }
    // Sticker is on. Pass through to the user-meta-driven default.
    return $enabled;
}, 10, 2 );
```

### `wp_admin_sidebar_storage`

Provide the storage implementation. Default is `WP_User_Meta_Storage` (writes to `user_meta`).

```php
apply_filters( 'wp_admin_sidebar_storage', Sidebar_Layout_Storage $storage ): Sidebar_Layout_Storage
```

The contract is the `Sidebar_Layout_Storage` interface in `src/interface-sidebar-storage.php`:

```php
interface Sidebar_Layout_Storage {
    /** @return array<int, LayoutDelta> Site-id → LayoutDelta map. */
    public function get_layouts( int $user_id ): array;

    /** @param array<int, LayoutDelta> $layouts */
    public function put_layouts( int $user_id, array $layouts ): bool;
}
```

A `LayoutDelta` is an associative array with `version: int`, `updated_at: int`, `overrides: list<array{itemId: string, position: array}>`. The `position` shape is either `{kind: 'top_level', index: int}` or `{kind: 'in_group', group_id: string, index: int}`. See `src/class-sidebar-rest.php::validate_delta()` for the full schema.

**Use-case:** WordPress.com binds a `WPCOM_User_Attribute_Storage` that writes to a global user attribute (instead of per-site user_meta) so a user's saved layouts roam across their connected sites.

### `wp_admin_sidebar_registry`

Amend the curated classification registry in one pass.

```php
apply_filters( 'wp_admin_sidebar_registry', array<string, array> $registry ): array
```

Each entry is keyed by an `itemId` (compound key `<kind>:<ref>:<parent>:<slug>`) and holds metadata used by the classifier. Hosts can add entries for their own items, override defaults for known items, or remove entries they don't want surfaced.

```php
add_filter( 'wp_admin_sidebar_registry', function ( $registry ) {
    $registry['plugin:my-host/backups.php:-:my-host-backups'] = array(
        'itemId'         => 'plugin:my-host/backups.php:-:my-host-backups',
        'sourceKind'     => 'plugin',
        'sourceRef'      => 'my-host/backups.php',
        'menuSlug'       => 'my-host-backups',
        'parentMenuSlug' => null,
        'source'         => 'plugin',
        'default_group'  => 'plugins',
        'default_weight' => 200,
        'reassignable'   => true,
        'labels'         => array( 'canonical' => __( 'Backups', 'my-host' ) ),
    );
    return $registry;
} );
```

### `wp_admin_sidebar_classify`

Classify a single menu item that's not in the curated registry. Runs as a fall-through after the registry lookup misses.

```php
apply_filters( 'wp_admin_sidebar_classify', ?array $entry, string $itemId, array $menu_item ): array
```

Plugin authors who want their plugin item to land in a specific group by default can hook this filter from their plugin's bootstrap.

### `wp_admin_sidebar_top_groups`

The list of top-level groups present in the sidebar. The default contains just the `plugins` group; hosts (and only hosts) append their own groups to this list.

```php
apply_filters( 'wp_admin_sidebar_top_groups', array<int, array{
    id: string,
    label: string,
    icon: ?string,
    weight: int,
    items: list<ClassificationEntry>,
}> $groups ): array
```

**WP Engine adding a "Hosting" group (worked example):**

```php
<?php
/**
 * Plugin Name: WP Engine — Admin Sidebar Integration
 */

add_filter( 'wp_admin_sidebar_top_groups', function ( $groups ) {
    $groups[] = array(
        'id'     => 'hosting-wpengine',
        'label'  => __( 'WP Engine', 'wpengine-admin-sidebar' ),
        'icon'   => 'dashicons-cloud',
        'weight' => 5,
        'items'  => array(
            array(
                'itemId'       => 'wpengine:hosting:-:wpengine-domains',
                'sourceKind'   => 'wpcom',
                'menuSlug'     => 'wpengine-domains',
                'url'          => admin_url( 'admin.php?page=wpengine-domains' ),
                'cap'          => 'manage_options',
                'labels'       => array( 'canonical' => __( 'Domains', 'wpengine-admin-sidebar' ) ),
                'reassignable' => true,
            ),
            array(
                'itemId'       => 'wpengine:hosting:-:wpengine-cdn',
                'sourceKind'   => 'wpcom',
                'menuSlug'     => 'wpengine-cdn',
                'url'          => admin_url( 'admin.php?page=wpengine-cdn' ),
                'cap'          => 'manage_options',
                'labels'       => array( 'canonical' => __( 'CDN', 'wpengine-admin-sidebar' ) ),
                'reassignable' => true,
            ),
        ),
    );
    return $groups;
} );
```

**Group-id namespace convention.** Hosts conventionally namespace their group id with a `hosting-<host>` prefix (`hosting-wpcom`, `hosting-wpengine`, `hosting-pressable`, …). The bare `hosting` is reserved for an eventual core proposal. The plugin de-dups by id at runtime: if two hosts register the same id, the last-filtered wins and a `WP_DEBUG` warning is logged. The convention keeps collisions rare; the warning is the diagnostic.

**Renaming a previously-registered group** (e.g., a meta-host overrides the label):

```php
add_filter( 'wp_admin_sidebar_top_groups', function ( $groups ) {
    foreach ( $groups as &$group ) {
        if ( 'hosting-wpengine' === $group['id'] ) {
            $group['label'] = __( 'WPE Tools', 'wpengine-admin-sidebar' );
        }
    }
    return $groups;
}, 100 );
```

### `wp_admin_sidebar_layout_rest_url`

The customizer's save-URL for the per-user layout. Default is the same-origin `/wp-json/wp-admin-sidebar/v1/layout`. Hosts where `/wp-json/` is not directly reachable can rebind to a same-origin admin-ajax fallback or a host-specific REST proxy.

```php
apply_filters( 'wp_admin_sidebar_layout_rest_url', string $url ): string
```

WordPress.com binding (illustrative):

```php
add_filter( 'wp_admin_sidebar_layout_rest_url', function () {
    return admin_url( 'admin-ajax.php?action=wp_admin_sidebar_layout_save' );
} );
```

## Actions

### `wp_admin_sidebar_layout_saved`

Fired once per successful save, post-validation, post-storage. Use for cache-flush listeners, audit logging, or custom analytics.

```php
do_action( 'wp_admin_sidebar_layout_saved', int $user_id, int $site_id, array $delta );
```

WordPress.com Atomic-cache integration (illustrative):

```php
add_action( 'wp_admin_sidebar_layout_saved', function ( $user_id, $site_id, $delta ) {
    if ( function_exists( 'flush_cache_user_connected_all_atomic_sites' ) ) {
        flush_cache_user_connected_all_atomic_sites( $user_id );
    }
}, 10, 3 );
```

### `wp_admin_sidebar_layout_reset`

Fired when the user resets to default (clears all overrides for the current site).

```php
do_action( 'wp_admin_sidebar_layout_reset', int $user_id, int $site_id );
```

## REST + admin-ajax surface

The plugin registers two write surfaces:

- `POST /wp-json/wp-admin-sidebar/v1/layout` — the canonical REST endpoint. Available on any WordPress install with `/wp-json/` reachable.
- `wp_ajax_wp_admin_sidebar_layout_save` — an admin-ajax fallback for hosts where `/wp-json/` is disabled (e.g., WordPress.com simple sites). Same handler logic, same validation. The legacy `wp_ajax_wpcom_admin_sidebar_layout_save` hook is also bound for one cycle (drops in v0.2.x).

Both routes' permission check verifies (a) the calling user has `read` capability on the site, and (b) the `wp_admin_sidebar_enabled` filter resolves true for them. A user who isn't opted in cannot probe the endpoint.

The validate-delta logic is shared (`Sidebar_Rest::validate_delta()`). Validation rules (excerpt — see source for full set):

- `version: int` ≥ 1
- `updated_at: int` ≥ 0
- `overrides: array` with at most 64 items (`Sidebar_Rest::MAX_OVERRIDES`)
- Each override's `itemId` matches the compound-id pattern.
- Each override's `position` either `{kind: 'top_level', index: 0..999}` or `{kind: 'in_group', group_id, index: 0..999}`.
- Unknown `itemId`s are accepted (preserved across deactivate/reactivate cycles for the originating plugin). Unknown `group_id`s are rejected (the registry is platform-stable; ghost group ids would silently no-op at render time).

## Constants

- `WP_ADMIN_SIDEBAR_VERSION` — current plugin version.
- `WP_ADMIN_SIDEBAR_FILE` — `__FILE__` of the bootstrap.
- `WP_ADMIN_SIDEBAR_DIR` — bootstrap's directory.
- `WP_ADMIN_SIDEBAR_URL` — bootstrap's URL.
- `WP_ADMIN_SIDEBAR_FORCE_ENABLED` — define to `true` to force the gate on for all users (overrides per-user opt-in).
- `WP_ADMIN_SIDEBAR_FORCE_DISABLED` — define to `true` to force the gate off (kill switch).

## Stability promise

Pre-1.0: the filter signatures listed here are stable in spirit but not contractually frozen. We avoid breaking changes within a minor version (`0.1.x` → `0.1.y` is safe), and document any breaking change between minors in the release notes + a deprecation cycle of one minor when feasible.

Post-1.0 (target: when the plugin has had ≥ 1 month of stable rollout on at least one large managed-WordPress host, plus passed wp.org plugin-directory review): we commit to filter-API stability across major versions, with a documented deprecation window for any breaking change.

## See also

- [`docs/architecture.md`](architecture.md) — internal layout, file responsibilities.
- [`docs/contracts.md`](contracts.md) — full data contracts for navModel, layoutDelta, classification entries.
- [`docs/related-work.md`](related-work.md) — prior art, why this plugin exists, how it differs.
- [`src/registry.php`](../src/registry.php) — the curated classification registry as code (self-documenting).
