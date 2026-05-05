<?php
/**
 * Curated default classification registry.
 *
 * The registry is the source of truth for default grouping. A.1's default ships
 * a single group, `plugins`, into which plugin-sourced items default. Core items
 * have `default_group: null` and render flat at top-level in their core position.
 *
 * The set of group ids is open and configurable: extend by registry-data PR
 * alone — no contract or architectural change. See plan 01-decisions.md § 2.
 *
 * Canonical filters: `wp_admin_sidebar_registry` (amend the registry) and
 * `wp_admin_sidebar_classify` (classify single items not in the registry).
 * Legacy `wpcom_admin_sidebar_*` aliases fire one cycle via
 * `apply_filters_deprecated` for back-compat; drop in v0.2.x.
 *
 * Contract reference: plan 03-contracts.md § 1.
 *
 * @package WP_Admin_Sidebar
 */

if ( ! defined( 'ABSPATH' ) ) {
	return;
}

if ( ! function_exists( 'wp_admin_sidebar_default_registry' ) ) {

	/**
	 * Return the curated default classification registry, keyed by compound itemId.
	 *
	 * @return array<string, array> Map of itemId → ClassificationEntry. See plan
	 *                              03-contracts.md § 1 for the entry shape.
	 */
	function wp_admin_sidebar_default_registry(): array {

		// Core items: default_group is null (render flat at top-level).
		// reassignable: false (Phase 2 UI only exposes plugin items as sources).
		$core = array(
			'core:core:-:index.php'                => array( 'menu_slug' => 'index.php', 'label' => 'Dashboard' ),
			'core:core:-:edit.php'                 => array( 'menu_slug' => 'edit.php', 'label' => 'Posts' ),
			'core:core:-:upload.php'               => array( 'menu_slug' => 'upload.php', 'label' => 'Media' ),
			'core:core:-:edit.php?post_type=page'  => array( 'menu_slug' => 'edit.php?post_type=page', 'label' => 'Pages' ),
			'core:core:-:edit-comments.php'        => array( 'menu_slug' => 'edit-comments.php', 'label' => 'Comments' ),
			'core:core:-:themes.php'               => array( 'menu_slug' => 'themes.php', 'label' => 'Appearance' ),
			'core:core:-:plugins.php'              => array( 'menu_slug' => 'plugins.php', 'label' => 'Plugins' ),
			'core:core:-:users.php'                => array( 'menu_slug' => 'users.php', 'label' => 'Users' ),
			'core:core:-:tools.php'                => array( 'menu_slug' => 'tools.php', 'label' => 'Tools' ),
			'core:core:-:options-general.php'      => array( 'menu_slug' => 'options-general.php', 'label' => 'Settings' ),
		);

		$registry = array();
		foreach ( $core as $item_id => $bits ) {
			$registry[ $item_id ] = array(
				'itemId'         => $item_id,
				'sourceKind'     => 'core',
				'sourceRef'      => 'core',
				'parentMenuSlug' => null,
				'menuSlug'       => $bits['menu_slug'],
				'source'         => 'core',
				'default_group'  => null,
				'default_weight' => 0,
				'reassignable'   => false,
				'labels'         => array( 'canonical' => $bits['label'] ),
			);
		}

		// Curated plugin entries. A small seed set of well-known plugins so the
		// default Plugins group recognises common items out of the box; everything
		// else falls through to the `wp_admin_sidebar_classify` filter and
		// ultimately the unknown-item default below.
		$plugins = array(
			array(
				'item_id'   => 'plugin:woocommerce/woocommerce.php:-:woocommerce',
				'source_ref' => 'woocommerce/woocommerce.php',
				'menu_slug' => 'woocommerce',
				'label'     => 'WooCommerce',
				'weight'    => 100,
			),
			array(
				'item_id'   => 'plugin:jetpack/jetpack.php:-:jetpack',
				'source_ref' => 'jetpack/jetpack.php',
				'menu_slug' => 'jetpack',
				'label'     => 'Jetpack',
				'weight'    => 110,
			),
			array(
				'item_id'   => 'plugin:akismet/akismet.php:-:akismet-key-config',
				'source_ref' => 'akismet/akismet.php',
				'menu_slug' => 'akismet-key-config',
				'label'     => 'Akismet',
				'weight'    => 120,
			),
		);

		foreach ( $plugins as $entry ) {
			$registry[ $entry['item_id'] ] = array(
				'itemId'         => $entry['item_id'],
				'sourceKind'     => 'plugin',
				'sourceRef'      => $entry['source_ref'],
				'parentMenuSlug' => null,
				'menuSlug'       => $entry['menu_slug'],
				'source'         => 'plugin',
				'default_group'  => 'plugins',
				'default_weight' => $entry['weight'],
				'reassignable'   => true,
				'labels'         => array( 'canonical' => $entry['label'] ),
			);
		}

		return $registry;
	}
}

if ( ! function_exists( 'wp_admin_sidebar_unknown_default' ) ) {

	/**
	 * Default classification for items not in the registry and not handled by the
	 * `wp_admin_sidebar_classify` filter. Routes uncurated plugin-shaped items
	 * into the `plugins` group so the default sidebar experience works without any
	 * plugin adopting the typed contract.
	 *
	 * @param string $item_id   The compound itemId for the unclassified item.
	 * @param string $menu_slug The raw menu slug (for menuSlug + parsing).
	 * @param string $title     The cleaned canonical title (post-signal extraction).
	 * @return array ClassificationEntry shape. See plan 03-contracts.md § 1.
	 */
	function wp_admin_sidebar_unknown_default( string $item_id, string $menu_slug, string $title ): array {
		// URL-shaped menu slugs (e.g., a managed host's admin shell injects
		// `add_menu_page()` entries whose slug is an external link such as
		// `https://wordpress.com/home/<site>`) are conceptually "site-level"
		// links, not "plugin items." The default classification keeps them at
		// top-level in their original $menu position. They stay reassignable
		// so a user can drag them into a group manually, but they don't land
		// in `plugins` by default.
		$is_url_slug = ( str_starts_with( $menu_slug, 'http://' ) || str_starts_with( $menu_slug, 'https://' ) );

		return array(
			'itemId'         => $item_id,
			'sourceKind'     => 'plugin',
			'sourceRef'      => 'unknown',
			'parentMenuSlug' => null,
			'menuSlug'       => $menu_slug,
			'source'         => 'plugin',
			'default_group'  => $is_url_slug ? null : 'plugins',
			'default_weight' => 999,
			'reassignable'   => true,
			'labels'         => array( 'canonical' => $title ),
		);
	}
}

// ─── Legacy function-name aliases ───────────────────────────────────────────
//
// One-cycle bridge for hosts (and host adapters) that call the legacy
// `wpcom_admin_sidebar_*` function names. Drop in v0.2.x. The wrappers emit a
// PHP deprecation notice via `_deprecated_function`.

if ( ! function_exists( 'wpcom_admin_sidebar_default_registry' ) ) {
	/**
	 * @deprecated 0.1.0 Use {@see wp_admin_sidebar_default_registry()} instead.
	 */
	function wpcom_admin_sidebar_default_registry(): array {
		_deprecated_function( __FUNCTION__, '0.1.0', 'wp_admin_sidebar_default_registry' );
		return wp_admin_sidebar_default_registry();
	}
}

if ( ! function_exists( 'wpcom_admin_sidebar_unknown_default' ) ) {
	/**
	 * @deprecated 0.1.0 Use {@see wp_admin_sidebar_unknown_default()} instead.
	 */
	function wpcom_admin_sidebar_unknown_default( string $item_id, string $menu_slug, string $title ): array {
		_deprecated_function( __FUNCTION__, '0.1.0', 'wp_admin_sidebar_unknown_default' );
		return wp_admin_sidebar_unknown_default( $item_id, $menu_slug, $title );
	}
}
