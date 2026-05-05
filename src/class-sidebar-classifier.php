<?php
/**
 * Builds the immutable nav model from $menu / $submenu.
 *
 * Hooked at `in_admin_header` priority 1. We deliberately do NOT hook on
 * `admin_menu` at any priority: real-world plugins register at very late
 * priorities (e.g., WooCommerce Navigation at admin_menu PHP_INT_MAX, and
 * managed-host integrations like WordPress.com's mu-plugins run late
 * mutators at priority 999999). Reading inside admin_menu is therefore
 * non-deterministic; reading at in_admin_header priority 1 is after every
 * admin_menu callback has finished and before the sidebar is rendered.
 *
 * @package WP_Admin_Sidebar
 */

if ( ! defined( 'ABSPATH' ) ) {
	return;
}

if ( class_exists( 'Sidebar_Classifier' ) ) {
	return;
}

// Note: registry.php is required from the bootstrap, not here. Keeping the
// dependency at the bootstrap level makes the load order explicit and avoids
// hidden cross-file dependencies that opcache caches separately — a stale
// require_once inside one file can silently break a downstream call.

/**
 * Sidebar classifier. Stateless except for the singleton-style `$nav_model`
 * cached on first read so the data planner can pick it up at priority 2
 * without rebuilding.
 */
class Sidebar_Classifier {

	/**
	 * The most recently built nav model. Set by build_nav_model(), read by the
	 * data planner. Reset across requests; this is a per-request cache only.
	 *
	 * @var array|null
	 */
	private static $nav_model = null;

	/**
	 * Read $menu / $submenu, normalize, classify, build the nav model.
	 *
	 * Wired to `in_admin_header` priority 1. Skips work entirely if the
	 * `wp_admin_sidebar_enabled` filter resolves to false (dark-deploy default).
	 */
	public static function build_nav_model(): void {
		$user_id = get_current_user_id();
		if ( ! $user_id ) {
			return;
		}

		// Default: false. Host adapter flips it true when its predicate agrees
		// (e.g., a per-blog feature sticker on a managed host). Plain-WP
		// bootstrap flips it true based on the per-user opt-in admin-bar toggle.
		$enabled = apply_filters( 'wp_admin_sidebar_enabled', false, $user_id );
		// Legacy alias bridge — drop in v0.2.x.
		$enabled = apply_filters_deprecated(
			'wpcom_admin_sidebar_enabled',
			array( $enabled, $user_id ),
			'0.1.0',
			'wp_admin_sidebar_enabled'
		);
		if ( ! $enabled ) {
			return;
		}

		global $menu, $submenu;

		$normalized = Sidebar_Normalizer::normalize(
			is_array( $menu ) ? $menu : array(),
			is_array( $submenu ) ? $submenu : array()
		);

		$registry = wp_admin_sidebar_default_registry();
		$registry = (array) apply_filters( 'wp_admin_sidebar_registry', $registry );
		// Legacy alias bridge — drop in v0.2.x.
		$registry = (array) apply_filters_deprecated(
			'wpcom_admin_sidebar_registry',
			array( $registry ),
			'0.1.0',
			'wp_admin_sidebar_registry'
		);

		$nav_items = array();
		foreach ( $normalized['top_level'] as $row ) {
			$built = self::build_item( $row, null, $registry, $normalized['submenu'] );
			if ( null !== $built ) {
				$nav_items[] = $built;
			}
		}

		$groups    = array();
		$top_level = array();
		foreach ( $nav_items as $item ) {
			$group_id = $item['default_group'] ?? null;
			if ( null === $group_id ) {
				$top_level[] = $item;
				continue;
			}
			if ( ! isset( $groups[ $group_id ] ) ) {
				$groups[ $group_id ] = array(
					'id'       => $group_id,
					'title'    => self::group_title( $group_id ),
					'icon'     => null,
					'children' => array(),
				);
			}
			$groups[ $group_id ]['children'][] = $item;
		}

		// Stable ordering by default_weight, then itemId.
		foreach ( $groups as &$group ) {
			usort(
				$group['children'],
				static function ( $a, $b ) {
					$wa = (int) ( $a['_weight'] ?? 999 );
					$wb = (int) ( $b['_weight'] ?? 999 );
					if ( $wa === $wb ) {
						return strcmp( (string) $a['itemId'], (string) $b['itemId'] );
					}
					return $wa <=> $wb;
				}
			);
			// Compute group signal aggregation (plan 03-contracts.md § 5).
			$attention = false;
			$count     = 0;
			foreach ( $group['children'] as $child ) {
				if ( ! empty( $child['signal']['attention'] ) ) {
					$attention = true;
				}
				$count += (int) ( $child['signal']['count'] ?? 0 );
				$count += (int) ( $child['signal']['numeric_badge'] ?? 0 );
			}
			$group['signal'] = array(
				'attention' => $attention,
				'count'     => $count,
			);
			// Drop the internal weight field once sorting is done.
			foreach ( $group['children'] as &$child ) {
				unset( $child['_weight'] );
			}
			unset( $child );
		}
		unset( $group );

		usort(
			$top_level,
			static function ( $a, $b ) {
				$wa = (int) ( $a['_weight'] ?? 0 );
				$wb = (int) ( $b['_weight'] ?? 0 );
				if ( $wa === $wb ) {
					return strcmp( (string) $a['itemId'], (string) $b['itemId'] );
				}
				return $wa <=> $wb;
			}
		);
		foreach ( $top_level as &$item ) {
			unset( $item['_weight'] );
		}
		unset( $item );

		self::$nav_model = array(
			'version'      => 1,
			'generated_at' => time(),
			'site_id'      => (int) get_current_blog_id(),
			'user_id'      => $user_id,
			'groups'       => array_values( $groups ),
			'top_level'    => $top_level,
		);
	}

	/**
	 * Read the cached nav model from this request. Returns null if no model has
	 * been built (gating denied, classifier not yet hooked, etc.).
	 */
	public static function get_nav_model(): ?array {
		return self::$nav_model;
	}

	/**
	 * Build one NavItem (with children if it has submenu rows). Returns null
	 * if the item is a separator or otherwise doesn't belong in the nav model.
	 *
	 * @param array      $row      One normalized $menu or $submenu row.
	 * @param ?string    $parent   Parent menu slug (null for top-level).
	 * @param array      $registry Active classification registry.
	 * @param array      $submenu  Map of parent slug → list of submenu rows.
	 */
	private static function build_item( array $row, ?string $parent, array $registry, array $submenu ): ?array {
		// Skip separators — they're presentational and not part of the nav model.
		if ( isset( $row[4] ) && is_string( $row[4] ) && str_contains( $row[4], 'wp-menu-separator' ) ) {
			return null;
		}

		$menu_slug = isset( $row[2] ) ? (string) $row[2] : '';
		if ( '' === $menu_slug ) {
			return null;
		}

		$cap = isset( $row[1] ) ? (string) $row[1] : '';

		// Pull the title through the signal extractor; the cleaned title is what
		// goes on the nav item; the signal pieces become item.signal.
		$raw_signal = Sidebar_Signals::extract_raw( isset( $row[0] ) ? (string) $row[0] : '' );
		$title      = isset( $raw_signal['title'] ) ? (string) $raw_signal['title'] : '';
		$signal     = Sidebar_Signals::map_to_nav( $raw_signal );

		$item_id = self::build_item_id( $menu_slug, $parent );

		$entry = $registry[ $item_id ] ?? null;
		if ( null === $entry ) {
			$entry = apply_filters( 'wp_admin_sidebar_classify', null, $item_id, $row );
			// Legacy alias bridge — drop in v0.2.x.
			$entry = apply_filters_deprecated(
				'wpcom_admin_sidebar_classify',
				array( $entry, $item_id, $row ),
				'0.1.0',
				'wp_admin_sidebar_classify'
			);
			if ( ! is_array( $entry ) || empty( $entry['itemId'] ) ) {
				$entry = wp_admin_sidebar_unknown_default( $item_id, $menu_slug, $title );
			}
		}

		// Prefer the registry's canonical label when our parsed title is empty
		// (e.g., WooCommerce hidden submenu, Gutenberg edit-site routes).
		if ( '' === $title ) {
			$title = isset( $entry['labels']['canonical'] ) ? (string) $entry['labels']['canonical'] : $menu_slug;
		}

		$children = array();
		if ( null === $parent && ! empty( $submenu[ $menu_slug ] ) ) {
			foreach ( $submenu[ $menu_slug ] as $sub_row ) {
				$built = self::build_item( $sub_row, $menu_slug, $registry, $submenu );
				if ( null !== $built ) {
					$children[] = $built;
				}
			}
		}

		return array(
			'itemId'        => $item_id,
			'menuSlug'      => $menu_slug,
			'url'           => self::resolve_url( $menu_slug, $parent ),
			'title'         => $title,
			'icon'          => isset( $row[6] ) && is_string( $row[6] ) ? $row[6] : null,
			'cap'           => $cap,
			'parent'        => $parent,
			'children'      => $children,
			'signal'        => $signal,
			'sourceKind'    => (string) ( $entry['sourceKind'] ?? 'unknown' ),
			'sourceRef'     => (string) ( $entry['sourceRef'] ?? 'unknown' ),
			'source'        => (string) ( $entry['source'] ?? 'plugin' ),
			'reassignable'  => (bool) ( $entry['reassignable'] ?? false ),
			'default_group' => $entry['default_group'] ?? null,
			// Internal-only field used for stable sort; stripped before emit.
			'_weight'       => (int) ( $entry['default_weight'] ?? 999 ),
		);
	}

	/**
	 * Compose the compound itemId from a menu slug + optional parent slug.
	 *
	 * Format: <sourceKind>:<sourceRef>:<parentMenuSlug ?? '-'>:<menuSlug>
	 *
	 * `sourceKind` and `sourceRef` are inferred at runtime (best effort). Core items
	 * derive cleanly; plugin items rely on a registration tracker which is out of
	 * scope for v0 — `unknown` is the common fallback per plan 03-contracts.md § 1.
	 */
	private static function build_item_id( string $menu_slug, ?string $parent ): string {
		$source_kind = self::infer_source_kind( $menu_slug, $parent );
		$source_ref  = 'core' === $source_kind ? 'core' : 'unknown';
		return sprintf( '%s:%s:%s:%s', $source_kind, $source_ref, $parent ?? '-', $menu_slug );
	}

	/**
	 * Best-effort source-kind inference from a slug.
	 *
	 * Core items have a closed set of well-known slugs (the registry's `core` rows
	 * cover the canonical set). Anything else is treated as `plugin` until we have
	 * a more reliable registration tracker.
	 */
	private static function infer_source_kind( string $menu_slug, ?string $parent ): string {
		$core_slugs = array(
			'index.php',
			'edit.php',
			'edit.php?post_type=page',
			'edit-comments.php',
			'upload.php',
			'themes.php',
			'plugins.php',
			'users.php',
			'tools.php',
			'options-general.php',
			'options-writing.php',
			'options-reading.php',
			'options-discussion.php',
			'options-media.php',
			'options-permalink.php',
			'options-privacy.php',
			'profile.php',
		);
		if ( in_array( $menu_slug, $core_slugs, true ) ) {
			return 'core';
		}
		if ( null !== $parent && in_array( $parent, $core_slugs, true ) ) {
			return 'core';
		}
		return 'plugin';
	}

	/**
	 * Resolve a menu slug into its admin URL. Mirrors the pattern in the existing
	 * REST endpoint (admin URL for top-level slugs, query-string-aware for plugin slugs).
	 */
	private static function resolve_url( string $menu_slug, ?string $parent ): string {
		// URL-shaped menu slugs (e.g., add_menu_page() called with a Calypso
		// link as the slug — `https://wordpress.com/home/<site>`) are absolute
		// destinations already. Wrapping them in admin_url() produces malformed
		// `/wp-admin/admin.php?page=https://…` strings. Mirrors the detection
		// in registry.php's classify_top_level().
		if ( str_starts_with( $menu_slug, 'http://' ) || str_starts_with( $menu_slug, 'https://' ) ) {
			return $menu_slug;
		}

		if ( null !== $parent ) {
			// Submenu: the slug is either a file (relative to admin) or a query
			// (admin.php?page=…). Mirror core's menu-header behaviour.
			if ( str_contains( $menu_slug, '.php' ) ) {
				return admin_url( $menu_slug );
			}
			return admin_url( 'admin.php?page=' . $menu_slug );
		}

		if ( str_contains( $menu_slug, '.php' ) ) {
			return admin_url( $menu_slug );
		}
		return admin_url( 'admin.php?page=' . $menu_slug );
	}

	/**
	 * Localised group title. A.1 only ships `plugins`; future groups added by the
	 * registry get default-cased titles unless a translator overrides via filter.
	 */
	private static function group_title( string $group_id ): string {
		$titles = array(
			'plugins' => __( 'Plugins', 'wp-admin-sidebar' ),
		);
		if ( isset( $titles[ $group_id ] ) ) {
			return $titles[ $group_id ];
		}
		return ucfirst( str_replace( array( '-', '_' ), ' ', $group_id ) );
	}
}
