<?php
/**
 * Plugin Name:       WP Admin Sidebar
 * Plugin URI:        https://github.com/Automattic/wp-admin-sidebar
 * Description:       A grouped, customisable left navigation for any WordPress site. Plugin items collapse into a single "Plugins" group at the bottom of the sidebar; per-user reorder via drag, keyboard, or a "Move to" menu, persisted across sessions. Opt-in per user via an admin bar toggle. Doesn't change core, fully reverts on deactivation.
 * Version:           0.1.0
 * Requires at least: 6.5
 * Requires PHP:      8.0
 * Author:            Christos Koumenides, Lucas Mendes
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       wp-admin-sidebar
 *
 * Note: this repo is currently staging at github.com/Automattic/wp-admin-sidebar.
 * Will transfer to github.com/WordPress/wp-admin-sidebar (community-branded) once
 * a WordPress-org Owner accepts the inbound transfer. Plugin URI updates at that
 * point. See docs/roadmap.md for the migration sequence.
 *
 * @package WP_Admin_Sidebar
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

// ─── Constants ─────────────────────────────────────────────────────────────
define( 'WP_ADMIN_SIDEBAR_VERSION', '0.1.0' );
define( 'WP_ADMIN_SIDEBAR_FILE', __FILE__ );
define( 'WP_ADMIN_SIDEBAR_DIR', plugin_dir_path( __FILE__ ) );
define( 'WP_ADMIN_SIDEBAR_URL', plugin_dir_url( __FILE__ ) );

// ─── Mid-deploy / partial-load safety ──────────────────────────────────────
// Verify all required files are present before requiring them. Mirrors the
// pattern from the wpcom mu-plugin (where rsync deploys files non-deterministically).
// Defensive on plain WP too.
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

// Opt-in gate: per-user, default off. Admin bar toggle flips a user_meta flag.
// Mirrors the pattern in WordPress/desktop-mode: opt-in per user, default off,
// no settings page in v0.1 — a single admin-bar item flips the flag.
add_filter(
	'wp_admin_sidebar_enabled',
	static function ( $enabled, $user_id ) {
		if ( defined( 'WP_ADMIN_SIDEBAR_FORCE_DISABLED' ) && WP_ADMIN_SIDEBAR_FORCE_DISABLED ) {
			return false;
		}
		if ( defined( 'WP_ADMIN_SIDEBAR_FORCE_ENABLED' ) && WP_ADMIN_SIDEBAR_FORCE_ENABLED ) {
			return true;
		}
		if ( ! $user_id ) {
			return false;
		}
		// User-meta flag toggled by the admin-bar item below. Default 0 = off.
		return (bool) get_user_meta( $user_id, 'wp_admin_sidebar_enabled', true );
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
			'wpcom-admin-sidebar-browse-rail',
			$dir . 'src/browse-rail/styles.css',
			array(),
			$ver . '.' . ( file_exists( $styles_path ) ? filemtime( $styles_path ) : '0' )
		);

		wp_enqueue_script(
			'wpcom-admin-sidebar-browse-rail',
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
		if ( 'wpcom-admin-sidebar-browse-rail' !== $handle ) {
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
		$classes .= ' wpcom-sidebar-active';

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
				$classes .= ' wpcom-sidebar-pending-delta';
			}
		}

		return $classes;
	}
);

// ─── Admin-bar opt-in toggle ───────────────────────────────────────────────
//
// Mirrors WordPress/desktop-mode: the user clicks the admin-bar item to flip
// `wp_admin_sidebar_enabled` user meta on; the page reloads and the sidebar
// redesign is active. Click again to flip off.
add_action(
	'admin_bar_menu',
	static function ( $bar ) {
		if ( ! is_user_logged_in() ) {
			return;
		}
		$user_id  = get_current_user_id();
		$enabled  = (bool) get_user_meta( $user_id, 'wp_admin_sidebar_enabled', true );
		$nonce    = wp_create_nonce( 'wp_admin_sidebar_toggle' );
		$toggle_url = add_query_arg(
			array(
				'wp_admin_sidebar_toggle' => $enabled ? '0' : '1',
				'_wpnonce'                => $nonce,
			),
			admin_url()
		);
		$bar->add_node(
			array(
				'id'    => 'wp-admin-sidebar-toggle',
				'title' => $enabled ? __( 'Restore default sidebar', 'wp-admin-sidebar' ) : __( 'Try the new sidebar', 'wp-admin-sidebar' ),
				'href'  => $toggle_url,
				'meta'  => array(
					'title' => $enabled
						? __( 'Switch back to the standard wp-admin sidebar.', 'wp-admin-sidebar' )
						: __( 'Switch to the grouped, customisable sidebar.', 'wp-admin-sidebar' ),
				),
			)
		);
	},
	999
);

add_action(
	'admin_init',
	static function () {
		if ( ! isset( $_GET['wp_admin_sidebar_toggle'] ) || ! isset( $_GET['_wpnonce'] ) ) {
			return;
		}
		if ( ! is_user_logged_in() ) {
			return;
		}
		$nonce = sanitize_text_field( wp_unslash( $_GET['_wpnonce'] ) );
		if ( ! wp_verify_nonce( $nonce, 'wp_admin_sidebar_toggle' ) ) {
			return;
		}
		$user_id  = get_current_user_id();
		$enabled  = '1' === sanitize_text_field( wp_unslash( $_GET['wp_admin_sidebar_toggle'] ) );
		update_user_meta( $user_id, 'wp_admin_sidebar_enabled', $enabled ? '1' : '0' );
		wp_safe_redirect( remove_query_arg( array( 'wp_admin_sidebar_toggle', '_wpnonce' ) ) );
		exit;
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
