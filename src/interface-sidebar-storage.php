<?php
/**
 * Storage abstraction for per-user sidebar layout data.
 *
 * Lives in /src/ — universal, host-neutral. The default implementation
 * (WP_User_Meta_Storage) ships alongside. Host adapters supply their own
 * implementation (e.g. WPCOM_User_Attribute_Storage in the wpcom integration
 * mu-plugin) by binding via the `wp_admin_sidebar_storage` filter.
 *
 * Code that reads or writes layouts MUST go through this filter so the same
 * call-site works on every host.
 *
 * Contract reference: plan 03-contracts.md § 9.
 *
 * @package WP_Admin_Sidebar
 */

if ( ! defined( 'ABSPATH' ) ) {
	return;
}

if ( interface_exists( 'Sidebar_Layout_Storage' ) ) {
	return;
}

/**
 * Abstract read/write access to per-user sidebar layout data.
 *
 * All implementations MUST return the map shape defined in plan 03-contracts.md § 3
 * (LayoutDelta keyed by site_id). Implementations on single-site installs (Phase B,
 * generic WordPress) SHOULD still use a map keyed by get_current_blog_id() so the
 * data shape stays identical across environments.
 */
interface Sidebar_Layout_Storage {

	/**
	 * Read the full map of layouts for a user across every site they've customized.
	 *
	 * @param int $user_id WordPress user id.
	 * @return array<int, array> Site-id → LayoutDelta map. Empty array if nothing stored.
	 */
	public function get_layouts( int $user_id ): array;

	/**
	 * Persist the full map of layouts for a user. Caller has already applied
	 * read-modify-write to merge any per-site changes.
	 *
	 * @param int                $user_id WordPress user id.
	 * @param array<int, array>  $layouts Full map to persist.
	 * @return bool True on success.
	 */
	public function put_layouts( int $user_id, array $layouts ): bool;
}
