<?php
/**
 * Default Sidebar_Layout_Storage implementation.
 *
 * Portable to any WordPress install. Reads from / writes to the user_meta key
 * `wpcom_admin_sidebar_layouts`. The `wpcom_` prefix is intentionally kept even
 * on generic WP installs (Phase B) so users who move between environments see
 * the same key; renaming is a Phase-B branding decision (plan open question 10).
 *
 * Contract reference: plan 03-contracts.md § 9.
 *
 * @package WPCOM_Admin_Sidebar
 */

if ( ! defined( 'ABSPATH' ) ) {
	return;
}

if ( class_exists( 'WP_User_Meta_Storage' ) ) {
	return;
}

/**
 * User-meta-backed default storage. Used on any non-WPCOM install and as the
 * fallback when no integration layer overrides the `wpcom_admin_sidebar_storage`
 * filter.
 */
class WP_User_Meta_Storage implements Sidebar_Layout_Storage {

	private const META_KEY = 'wpcom_admin_sidebar_layouts';

	/**
	 * @inheritDoc
	 */
	public function get_layouts( int $user_id ): array {
		$value = get_user_meta( $user_id, self::META_KEY, true );
		return is_array( $value ) ? $value : array();
	}

	/**
	 * @inheritDoc
	 */
	public function put_layouts( int $user_id, array $layouts ): bool {
		return (bool) update_user_meta( $user_id, self::META_KEY, $layouts );
	}
}
