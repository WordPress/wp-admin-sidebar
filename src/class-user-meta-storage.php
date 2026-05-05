<?php
/**
 * Default Sidebar_Layout_Storage implementation.
 *
 * Portable to any WordPress install. Reads from / writes to the user_meta key
 * `wpcom_admin_sidebar_layouts`.
 *
 * The `wpcom_` prefix on the meta key is a backward-compat carry-over from the
 * plugin's incubation as a WordPress.com mu-plugin. Renaming the key would
 * orphan saved layouts on any install that already has data. A migration path
 * (read both keys, write the new one) is on the v0.2.x roadmap; until then,
 * the existing key is the durable identifier.
 *
 * @package WP_Admin_Sidebar
 */

if ( ! defined( 'ABSPATH' ) ) {
	return;
}

if ( class_exists( 'WP_User_Meta_Storage' ) ) {
	return;
}

/**
 * User-meta-backed default storage. Used as the fallback whenever no host
 * adapter overrides the `wp_admin_sidebar_storage` filter. Hosts that need
 * a different persistence model (e.g., a network-wide attribute that roams
 * across sites) can bind their own `Sidebar_Layout_Storage` implementation.
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
