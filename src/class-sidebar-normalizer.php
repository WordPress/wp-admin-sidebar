<?php
/**
 * Raw input normalization for $menu / $submenu globals.
 *
 * The classifier needs a clean, predictable input shape. WordPress's $menu /
 * $submenu globals carry well-known pathologies — null/false submenu rows,
 * hidden items, missing capabilities — that the Calypso admin-menu REST
 * endpoint (shipped in jetpack-mu-wpcom on WordPress.com) guards against in
 * its own preparation phase. We mirror those guards here so the classifier
 * never has to.
 *
 * @package WP_Admin_Sidebar
 */

if ( ! defined( 'ABSPATH' ) ) {
	return;
}

if ( class_exists( 'Sidebar_Normalizer' ) ) {
	return;
}

/**
 * Pure-function normalizer over the $menu / $submenu globals.
 *
 * Input: the two arrays in the shape WordPress builds during admin_menu.
 * Output: a NormalizedMenu structure with surviving rows, drop rules applied.
 *
 * The output is the input to Sidebar_Classifier::build_nav_model().
 */
class Sidebar_Normalizer {

	/**
	 * Normalize $menu and $submenu down to rows we will classify.
	 *
	 * Drop rules applied in order:
	 *
	 *   1. Non-array submenu rows (null / false from broken plugin combos)
	 *   2. `hide-if-js` items (CSS class on position 4)
	 *   3. Null or empty title without a usable slug+url fallback
	 *   4. Missing capability index (malformed registration)
	 *
	 * Separators (`wp-menu-separator` CSS class) survive intact and are flagged
	 * for the classifier.
	 *
	 * @param array $menu    The $menu global. Top-level rows.
	 * @param array $submenu The $submenu global. Map of parent slug → list of submenu rows.
	 * @return array{top_level: array, submenu: array<string, array>}
	 */
	public static function normalize( array $menu, array $submenu ): array {
		$normalized_top    = array();
		$normalized_submenu = array();

		foreach ( $menu as $position => $menu_item ) {
			if ( ! self::is_valid_menu_row( $menu_item ) ) {
				continue;
			}
			$normalized_top[ $position ] = $menu_item;
		}

		foreach ( $submenu as $parent_slug => $items ) {
			if ( ! is_array( $items ) ) {
				continue;
			}

			$kept = array();
			foreach ( $items as $position => $submenu_item ) {
				// Plugin combinations occasionally produce null/false entries — see
				// the endpoint's defensive guard at :137-142.
				if ( ! is_array( $submenu_item ) ) {
					continue;
				}
				if ( ! self::is_valid_submenu_row( $submenu_item ) ) {
					continue;
				}
				$kept[ $position ] = $submenu_item;
			}

			if ( ! empty( $kept ) ) {
				$normalized_submenu[ $parent_slug ] = $kept;
			}
		}

		return array(
			'top_level' => array_values( $normalized_top ),
			'submenu'   => $normalized_submenu,
		);
	}

	/**
	 * Apply the drop rules for a single $menu row.
	 *
	 * @param mixed $row Candidate row from $menu.
	 */
	private static function is_valid_menu_row( $row ): bool {
		if ( ! is_array( $row ) ) {
			return false;
		}
		// $menu rows must have at least: [0]=title, [1]=cap, [2]=slug, [3]=page-title,
		// [4]=class, [5]=hookname, [6]=icon. Missing required indices = malformed.
		if ( ! isset( $row[1], $row[2] ) ) {
			return false;
		}

		// `hide-if-js` items vanish from the nav model entirely (not just hidden in render).
		if ( isset( $row[4] ) && is_string( $row[4] ) && str_contains( $row[4], 'hide-if-js' ) ) {
			return false;
		}

		// Separators pass through; the classifier flags them.
		if ( isset( $row[4] ) && is_string( $row[4] ) && str_contains( $row[4], 'wp-menu-separator' ) ) {
			return true;
		}

		// Null/empty title is OK only if a usable slug + non-empty target exists. The
		// classifier registry's labels.canonical fills the display label later. Examples:
		// WooCommerce hidden submenu at class-wc-admin-menus.php:226-229,
		// Gutenberg edit-site routes at edit-site-routes-backwards-compat.php:29-31.
		$title       = isset( $row[0] ) ? (string) $row[0] : '';
		$slug        = (string) $row[2];
		$has_useable = '' !== sanitize_title( $title ) || ( '' !== $slug );
		if ( ! $has_useable ) {
			return false;
		}

		return true;
	}

	/**
	 * Apply the drop rules for a single $submenu row.
	 *
	 * @param array $row Candidate row from $submenu[$parent_slug].
	 */
	private static function is_valid_submenu_row( array $row ): bool {
		if ( ! isset( $row[1], $row[2] ) ) {
			return false;
		}

		if ( isset( $row[4] ) && is_string( $row[4] ) && str_contains( $row[4], 'hide-if-js' ) ) {
			return false;
		}

		// Submenu rows can have empty title when the slug+url is meaningful (see
		// the endpoint guards at :320-322 — they only check hide-if-js, not empty
		// titles, so we follow the same liberal acceptance here).
		return true;
	}
}
