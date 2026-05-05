<?php
/**
 * Emits the inline `wpcomAdminSidebarData` script.
 *
 * Hooked at `in_admin_header` priority 2 (after the classifier's priority 1
 * build). The browse-rail JS bundle reads this on DOMContentLoaded and wraps
 * core-emitted <li> items into group <ul> containers (A.1). The customizer
 * picks up the same global on entry to seed its baseline + saved-delta state
 * (A.2), so this single emit is the source of truth for both flows.
 *
 * Contract reference: plan 03-contracts.md § 2 (NavModel), § 3 (LayoutDelta),
 *                     § 9 (Storage).
 *
 * @package WPCOM_Admin_Sidebar
 */

if ( ! defined( 'ABSPATH' ) ) {
	return;
}

if ( class_exists( 'Sidebar_Data_Planner' ) ) {
	return;
}

/**
 * Inline-script emitter. Pulls the cached nav model from the classifier, reads
 * the saved layout delta via the bound storage, and prints both as a single
 * `wpcomAdminSidebarData` global.
 */
class Sidebar_Data_Planner {

	/**
	 * Emit the inline script. No-op when the classifier never built a model
	 * (gating denied, no current user, etc.).
	 */
	public static function emit(): void {
		$nav_model = Sidebar_Classifier::get_nav_model();
		if ( null === $nav_model ) {
			return;
		}

		$user_id = get_current_user_id();
		$site_id = (int) get_current_blog_id();

		$storage      = self::get_storage();
		$saved_layout = self::read_saved_layout( $storage, $user_id, $site_id );

		$payload = array(
			'navModel'    => $nav_model,
			'layoutDelta' => $saved_layout,
			'meta'        => array(
				'siteId'      => $site_id,
				'userId'      => $user_id,
				'generatedAt' => $nav_model['generated_at'] ?? time(),
				'version'     => 1,
				// REST consumed by the customizer (A.2).
				//
				// `restUrl` is the fully-resolved layout endpoint. The default is
				// the same-origin /wp-json/ path that resolves to the core
				// namespace `Sidebar_Rest::register_routes()` registers. Hosts
				// override via the `wp_admin_sidebar_layout_rest_url` filter
				// (the WPCOM adapter does this because rest_url() /
				// home_url('/wp-json/') is not routed on user blogs there;
				// the WPCOM-merge route lives under
				// `wpcom/v2/sites/<blog_id>/wp-admin-sidebar/layout` on
				// public-api.wordpress.com). The default works on plain WP.
				//
				// `restRoot` stays for back-compat with consumers that build
				// their own URL; the customizer prefers `restUrl` when present.
				'restRoot'    => esc_url_raw( home_url( '/wp-json/' ) ),
				'restUrl'     => esc_url_raw( self::resolve_rest_url() ),
				'restNonce'   => wp_create_nonce( 'wp_rest' ),
			),
		);

		$json = wp_json_encode( $payload );
		if ( false === $json ) {
			return;
		}

		printf(
			"<script id=\"wpcom-admin-sidebar-data\">window.wpcomAdminSidebarData = %s;</script>\n",
			// JSON output is for a JS variable assignment — the JSON encoder has
			// already escaped per RFC 8259, and we only need to neutralise the
			// </script close-tag pattern that JSON encoding doesn't catch.
			str_replace( '</', '<\/', $json ) // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped
		);
	}

	/**
	 * Resolve the layout endpoint URL the customizer should POST to.
	 *
	 * Default is the same-origin /wp-json/wp-admin-sidebar/v1/layout, which is
	 * what `Sidebar_Rest::register_routes()` exposes on plain WP installs.
	 * WPCOM hooks the filter to redirect the customizer at the public-api
	 * endpoint registered by the WPCOM REST endpoint plugin (see
	 * `wp-content/rest-api-plugins/endpoints/wp-admin-sidebar.php`).
	 *
	 * The path is hardcoded rather than referencing `Sidebar_Rest::NAMESPACE` /
	 * `::ROUTE` to remove the cross-class constant dependency that gherald
	 * MidDeployAtomicityRule flags during partial deploys (see PR #213545
	 * comment thread). The namespace is part of the stable REST contract
	 * (03-contracts.md § 10) and `Sidebar_Rest` is the canonical owner — if
	 * the namespace ever needs to change, update both call sites in lockstep.
	 */
	private static function resolve_rest_url(): string {
		$default = home_url( '/wp-json/wp-admin-sidebar/v1/layout' );
		$url     = (string) apply_filters( 'wp_admin_sidebar_layout_rest_url', $default );
		// Legacy alias bridge — drop in v0.2.x.
		$url = (string) apply_filters_deprecated(
			'wpcom_admin_sidebar_layout_rest_url',
			array( $url ),
			'0.1.0',
			'wp_admin_sidebar_layout_rest_url'
		);
		return $url;
	}

	/**
	 * Resolve the active storage implementation via filter. Defaults to the
	 * portable WP user-meta storage when nothing is bound.
	 */
	private static function get_storage(): Sidebar_Layout_Storage {
		$default = new WP_User_Meta_Storage();
		$bound   = apply_filters( 'wp_admin_sidebar_storage', $default );
		// Legacy alias bridge — drop in v0.2.x.
		$bound = apply_filters_deprecated(
			'wpcom_admin_sidebar_storage',
			array( $bound ),
			'0.1.0',
			'wp_admin_sidebar_storage'
		);
		return $bound instanceof Sidebar_Layout_Storage ? $bound : $default;
	}

	/**
	 * Read the saved LayoutDelta for the current site. Returns null when no
	 * delta exists for this site (the common case — most users haven't customized).
	 *
	 * @return array|null
	 */
	private static function read_saved_layout( Sidebar_Layout_Storage $storage, int $user_id, int $site_id ): ?array {
		if ( ! $user_id ) {
			return null;
		}
		$layouts = $storage->get_layouts( $user_id );
		if ( ! isset( $layouts[ $site_id ] ) ) {
			return null;
		}
		return is_array( $layouts[ $site_id ] ) ? $layouts[ $site_id ] : null;
	}
}
