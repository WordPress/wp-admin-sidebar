<?php
/**
 * Two-layer signal extraction.
 *
 * Layer 1 (extract_raw): byte-for-byte mirror of the parsing rules used by the
 * Calypso admin-menu REST endpoint shipped in jetpack-mu-wpcom on WordPress.com.
 * That endpoint is the de-facto source of truth for how WP `$menu` / `$submenu`
 * structures get decoded into a typed signal shape; we mirror it here so the
 * sidebar can reuse the same shape, and an equivalence test (run on hosts with
 * the endpoint installed) asserts byte-identical output.
 *
 * Layer 2 (map_to_nav): converts the camelCase raw shape into the snake_case
 * nav-model ItemSignal, with derived numeric_badge and attention fields. This
 * mapping is sidebar-specific and does not need to match the endpoint.
 *
 * @package WP_Admin_Sidebar
 */

if ( ! defined( 'ABSPATH' ) ) {
	return;
}

if ( class_exists( 'Sidebar_Signals' ) ) {
	return;
}

/**
 * Static helpers for extracting and mapping per-item signal data from menu titles.
 */
class Sidebar_Signals {

	/**
	 * Layer 1: raw signal extraction. Mirrors the endpoint exactly.
	 *
	 * Returns a sparse, camelCase shape. Only set fields are present.
	 *
	 * Extraction order (matches endpoint :456-528 line-for-line):
	 *
	 *   1. <span class="… count-N …">…</span></span>  → count: int (only when N > 0)
	 *   2. <span class="inline-text" …>TEXT</span>    → inlineText: string
	 *   3. <span class="inline-icon dashicons-X" …></span> → inlineIcon: 'dashicons-X'
	 *   4. <span class="awaiting-mod">TEXT</span>     → badge: string (text, not raw HTML)
	 *
	 * Remaining title is passed through wp_strip_all_tags + ucfirst.
	 *
	 * @param string $title Menu title (may include signal markup).
	 * @return array{
	 *     count?: int,
	 *     inlineText?: string,
	 *     inlineIcon?: string,
	 *     badge?: string,
	 *     title: string,
	 * }
	 */
	public static function extract_raw( $title ): array {
		if ( ! is_string( $title ) ) {
			return array();
		}

		$item = array();

		if (
			str_contains( $title, 'count-' )
			&& preg_match( '/<span class=".+\s?count-(\d*).+\s?<\/span><\/span>/', $title, $matches )
		) {
			$count = (int) ( $matches[1] );
			if ( $count > 0 ) {
				$item['count'] = $count;
			}
			$title = trim( str_replace( $matches[0], '', $title ) );
		}

		if (
			str_contains( $title, 'inline-text' )
			&& preg_match( '/<span class="inline-text".+\s?>(.+)<\/span>/', $title, $matches )
		) {
			$text = $matches[1];
			if ( $text ) {
				$item['inlineText'] = $text;
			}
			$title = trim( str_replace( $matches[0], '', $title ) );
		}

		if (
			str_contains( $title, 'inline-icon' )
			&& preg_match( '/<span class="inline-icon dashicons (dashicons-[^"]+)"[^>]*><\/span>/', $title, $matches )
		) {
			$icon = $matches[1];
			if ( $icon ) {
				$item['inlineIcon'] = $icon;
			}
			$title = trim( str_replace( $matches[0], '', $title ) );
		}

		if (
			str_contains( $title, 'awaiting-mod' )
			&& preg_match( '/<span class="awaiting-mod">(.+)<\/span>/', $title, $matches )
		) {
			$text = $matches[1];
			if ( $text ) {
				$item['badge'] = $text;
			}
			$title = trim( str_replace( $matches[0], '', $title ) );
		}

		// Sanitize the remaining title last, after parsing data.
		$item['title'] = ucfirst( wp_strip_all_tags( $title ) );

		return $item;
	}

	/**
	 * Layer 2: map raw camelCase shape to nav-model ItemSignal (snake_case + derived fields).
	 *
	 * - Fills missing fields with null (nav model always has all keys present).
	 * - Derives numeric_badge from awaiting-mod text when it parses as a non-negative int.
	 * - Derives attention as the OR of count > 0, numeric_badge > 0, badge non-empty.
	 *   `inline_text` is intentionally NOT in the OR — it carries decorative
	 *   plan/tier labels like "Premium" / "BETA" / "NEW" which are not
	 *   "needs your attention" indicators. See the inline comment in the
	 *   implementation for the sandbox-tier verification that surfaced this.
	 *
	 * Pure function on the raw shape; mapper-specific tests, no endpoint equivalence.
	 *
	 * @param array $raw Output of extract_raw().
	 * @return array{
	 *     count: ?int,
	 *     numeric_badge: ?int,
	 *     inline_text: ?string,
	 *     inline_icon: ?string,
	 *     badge: ?string,
	 *     attention: bool,
	 * }
	 */
	public static function map_to_nav( array $raw ): array {
		$count        = isset( $raw['count'] ) ? (int) $raw['count'] : null;
		$inline_text  = isset( $raw['inlineText'] ) ? (string) $raw['inlineText'] : null;
		$inline_icon  = isset( $raw['inlineIcon'] ) ? (string) $raw['inlineIcon'] : null;
		$badge        = isset( $raw['badge'] ) ? (string) $raw['badge'] : null;

		// Sensei Home, Sensei Grading, Sensei Groups (etc.) put numeric strings inside
		// awaiting-mod; pull those out so group-level aggregation can sum them.
		$numeric_badge = null;
		if ( null !== $badge && '' !== $badge && ctype_digit( $badge ) ) {
			$numeric_badge = (int) $badge;
		}

		// `inline_text` is intentionally NOT in the attention OR. It marks plan-tier
		// or status labels like "Premium" / "BETA" / "NEW" which are decorative,
		// not "this needs your attention" indicators. Field-found regression: a
		// host's "Upgrades" entry that carries an inline-text "Premium" tag would
		// otherwise bubble up to a group-level red dot even though no item under
		// it had a real notification.
		$attention = ( null !== $count && $count > 0 )
			|| ( null !== $numeric_badge && $numeric_badge > 0 )
			|| ( null !== $badge && '' !== $badge );

		return array(
			'count'         => $count,
			'numeric_badge' => $numeric_badge,
			'inline_text'   => $inline_text,
			'inline_icon'   => $inline_icon,
			'badge'         => $badge,
			'attention'     => $attention,
		);
	}
}
