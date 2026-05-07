<?php
/**
 * Plugin Name:       WP Admin Sidebar
 * Plugin URI:        https://github.com/WordPress/wp-admin-sidebar
 * Description:       Improves the wp-admin sidebar, starting with personal rearrangement of items and a curated "Plugins" group that consolidates plugin-added entries at the bottom. Per-user opt-in via the `wp_admin_sidebar_enabled` user-meta flag, fully reverts on deactivation.
 * Version:           0.1.3
 * Requires at least: 6.5
 * Requires PHP:      8.0
 * Author:            Christos Koumenides, Lucas Mendes
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       wp-admin-sidebar
 *
 * @package WP_Admin_Sidebar
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

// ─── Constants ─────────────────────────────────────────────────────────────
define( 'WP_ADMIN_SIDEBAR_VERSION', '0.1.3' );
define( 'WP_ADMIN_SIDEBAR_FILE', __FILE__ );
define( 'WP_ADMIN_SIDEBAR_DIR', plugin_dir_path( __FILE__ ) );
define( 'WP_ADMIN_SIDEBAR_URL', plugin_dir_url( __FILE__ ) );

// ─── Mid-deploy / partial-load safety ──────────────────────────────────────
// Verify all required files are present before requiring them. Defensive
// against rsync-style deploys where files land in non-deterministic order
// (so this top-level bootstrap can briefly be live before its required
// /src/ companions arrive). Cheap to do; protects against fatal mid-deploy.
$wp_admin_sidebar_required_files = array(
	__DIR__ . '/src/interface-sidebar-storage.php',
	__DIR__ . '/src/class-user-meta-storage.php',
	__DIR__ . '/src/class-sidebar-normalizer.php',
	__DIR__ . '/src/class-sidebar-signals.php',
	__DIR__ . '/src/registry.php',
	__DIR__ . '/src/class-sidebar-classifier.php',
	__DIR__ . '/src/class-sidebar-data-planner.php',
	__DIR__ . '/src/class-sidebar-rest.php',
);
foreach ( $wp_admin_sidebar_required_files as $wp_admin_sidebar_required_file ) {
	if ( ! file_exists( $wp_admin_sidebar_required_file ) ) {
		unset( $wp_admin_sidebar_required_files, $wp_admin_sidebar_required_file );
		return;
	}
}
unset( $wp_admin_sidebar_required_files, $wp_admin_sidebar_required_file );

// ─── Always-loaded portable layer ──────────────────────────────────────────
require_once __DIR__ . '/src/interface-sidebar-storage.php';
require_once __DIR__ . '/src/class-user-meta-storage.php';
require_once __DIR__ . '/src/class-sidebar-normalizer.php';
require_once __DIR__ . '/src/class-sidebar-signals.php';
require_once __DIR__ . '/src/registry.php';
require_once __DIR__ . '/src/class-sidebar-classifier.php';
require_once __DIR__ . '/src/class-sidebar-data-planner.php';
require_once __DIR__ . '/src/class-sidebar-rest.php';

// ─── Default storage + opt-in gating (plain WP) ────────────────────────────
//
// Storage default: WP user meta. Hosts can rebind via the canonical
// `wp_admin_sidebar_storage` filter. The legacy `wpcom_admin_sidebar_storage`
// alias still fires for one cycle via `apply_filters_deprecated` and emits a
// deprecation notice; remove in v0.2.x.
add_filter(
	'wp_admin_sidebar_storage',
	static function () {
		return new WP_User_Meta_Storage();
	}
);

// Enablement gate: install is the opt-in. The plugin defaults to enabled for
// any logged-in user on plain WP — activating the plugin is the opt-in
// signal, matching the original design (see plan 01-decisions.md § 9).
//
// Hosts that need finer control (per-blog, per-user, percentage rollout, …)
// override this filter from a host adapter. Two control levers ship in-tree
// for development convenience:
//
//   define( 'WP_ADMIN_SIDEBAR_FORCE_DISABLED', true );  // kill switch
//   define( 'WP_ADMIN_SIDEBAR_FORCE_ENABLED',  true );  // bypass gate
//
// A future deliberate opt-in/opt-out surface (admin-level toggle, per-user
// override, settings page, …) is tracked in
// https://github.com/WordPress/wp-admin-sidebar/issues/16.
add_filter(
	'wp_admin_sidebar_enabled',
	static function ( $enabled, $user_id ) {
		if ( defined( 'WP_ADMIN_SIDEBAR_FORCE_DISABLED' ) && WP_ADMIN_SIDEBAR_FORCE_DISABLED ) {
			return false;
		}
		if ( defined( 'WP_ADMIN_SIDEBAR_FORCE_ENABLED' ) && WP_ADMIN_SIDEBAR_FORCE_ENABLED ) {
			return true;
		}
		// Logged-in users get the redesign; logged-out / cron / cli requests do not.
		return (bool) $user_id;
	},
	10,
	2
);

// ─── Hook the data pipeline ────────────────────────────────────────────────
add_action( 'in_admin_header', array( Sidebar_Classifier::class, 'build_nav_model' ), 1 );
add_action( 'in_admin_header', array( Sidebar_Data_Planner::class, 'emit' ), 2 );

// ─── Register REST routes (with class_exists guard for mid-load safety) ────
if ( class_exists( 'Sidebar_Rest' ) ) {
	Sidebar_Rest::register();
}

// ─── Browse-rail JS + CSS (gated by the enabled filter) ────────────────────
add_action(
	'admin_enqueue_scripts',
	static function () {
		if ( ! is_admin() ) {
			return;
		}
		$user_id = get_current_user_id();
		if ( ! $user_id ) {
			return;
		}
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

		$dir              = WP_ADMIN_SIDEBAR_URL;
		$styles_path      = WP_ADMIN_SIDEBAR_DIR . 'src/browse-rail/styles.css';
		$browse_rail_path = WP_ADMIN_SIDEBAR_DIR . 'src/browse-rail/browse-rail.js';
		$bust_sources     = array(
			WP_ADMIN_SIDEBAR_DIR . 'src/browse-rail/browse-rail.js',
			WP_ADMIN_SIDEBAR_DIR . 'src/browse-rail/grouping.js',
			WP_ADMIN_SIDEBAR_DIR . 'src/browse-rail/signal.js',
			WP_ADMIN_SIDEBAR_DIR . 'src/browse-rail/expand-collapse.js',
			WP_ADMIN_SIDEBAR_DIR . 'src/customizer/customizer.js',
			WP_ADMIN_SIDEBAR_DIR . 'src/customizer/draft-state.js',
			WP_ADMIN_SIDEBAR_DIR . 'src/customizer/drag-drop.js',
			WP_ADMIN_SIDEBAR_DIR . 'src/customizer/keyboard-reorder.js',
			WP_ADMIN_SIDEBAR_DIR . 'src/customizer/move-menu.js',
			WP_ADMIN_SIDEBAR_DIR . 'src/customizer/customizer.css',
		);
		$max_mtime = 0;
		foreach ( $bust_sources as $path ) {
			if ( file_exists( $path ) ) {
				$max_mtime = max( $max_mtime, filemtime( $path ) );
			}
		}
		$ver = WP_ADMIN_SIDEBAR_VERSION;

		wp_enqueue_style(
			'wp-admin-sidebar-browse-rail',
			$dir . 'src/browse-rail/styles.css',
			array(),
			$ver . '.' . ( file_exists( $styles_path ) ? filemtime( $styles_path ) : '0' )
		);

		wp_enqueue_script(
			'wp-admin-sidebar-browse-rail',
			$dir . 'src/browse-rail/browse-rail.js',
			array(),
			$ver . '.' . $max_mtime,
			true
		);
	}
);

add_filter(
	'script_loader_tag',
	static function ( $tag, $handle ) {
		if ( 'wp-admin-sidebar-browse-rail' !== $handle ) {
			return $tag;
		}
		return str_replace( '<script ', '<script type="module" ', $tag );
	},
	10,
	2
);

add_filter(
	'admin_body_class',
	static function ( $classes ) {
		$user_id = get_current_user_id();
		if ( ! $user_id ) {
			return $classes;
		}
		$enabled = apply_filters( 'wp_admin_sidebar_enabled', false, $user_id );
		// Legacy alias bridge — drop in v0.2.x.
		$enabled = apply_filters_deprecated(
			'wpcom_admin_sidebar_enabled',
			array( $enabled, $user_id ),
			'0.1.0',
			'wp_admin_sidebar_enabled'
		);
		if ( ! $enabled ) {
			return $classes;
		}
		$classes .= ' wp-admin-sidebar-active';

		$storage = apply_filters( 'wp_admin_sidebar_storage', new WP_User_Meta_Storage() );
		// Legacy alias bridge — drop in v0.2.x.
		$storage = apply_filters_deprecated(
			'wpcom_admin_sidebar_storage',
			array( $storage ),
			'0.1.0',
			'wp_admin_sidebar_storage'
		);
		if ( $storage instanceof Sidebar_Layout_Storage ) {
			$layouts = $storage->get_layouts( $user_id );
			$site_id = (int) get_current_blog_id();
			if (
				is_array( $layouts ) &&
				! empty( $layouts[ $site_id ]['overrides'] ) &&
				is_array( $layouts[ $site_id ]['overrides'] )
			) {
				$classes .= ' wp-admin-sidebar-pending-delta';
			}
		}

		return $classes;
	}
);

// ─── Deactivation cleanup ──────────────────────────────────────────────────
//
// Data-preserving deactivation: the user-meta opt-in flag and the saved
// layouts both stay in user_meta across deactivate/reactivate cycles.
// Matches WordPress/desktop-mode's deactivation posture (the user's intent is
// a property of their account, not of the plugin install).
register_deactivation_hook(
	WP_ADMIN_SIDEBAR_FILE,
	static function () {
		// Intentional no-op. See the docblock above.
	}
);
