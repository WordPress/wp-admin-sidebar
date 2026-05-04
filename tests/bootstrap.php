<?php
/**
 * Minimal test bootstrap for the wpcom-admin-sidebar mu-plugin.
 *
 * Defines the WordPress shims the pure-function classes need (sanitize_title,
 * wp_strip_all_tags) so the unit tests run without booting all of WordPress.
 *
 * For full integration tests that exercise the classifier against $menu /
 * $submenu, run against a real WP install (sandbox) where all helpers are
 * available natively.
 *
 * @package WPCOM_Admin_Sidebar\Tests
 */

if ( ! defined( 'ABSPATH' ) ) {
	define( 'ABSPATH', __DIR__ . '/../../../../../' );
}

if ( ! function_exists( 'sanitize_title' ) ) {
	/**
	 * Test shim. Real WordPress implementation is more elaborate; for the
	 * normalizer's purposes the lowercase/strip behaviour is what matters.
	 *
	 * @param string $title Raw title.
	 */
	function sanitize_title( $title ): string {
		$title = strtolower( (string) $title );
		$title = preg_replace( '/[^a-z0-9_\-]/', '-', $title );
		$title = preg_replace( '/-+/', '-', $title );
		return trim( $title, '-' );
	}
}

if ( ! function_exists( 'wp_strip_all_tags' ) ) {
	/**
	 * Test shim. Strips HTML and (optionally) collapses whitespace.
	 *
	 * @param string $string Input.
	 */
	function wp_strip_all_tags( $string ): string {
		$string = preg_replace( '@<(script|style)[^>]*?>.*?</\\1>@si', '', (string) $string );
		$string = strip_tags( $string );
		return trim( preg_replace( '/[\s]+/', ' ', $string ) );
	}
}

if ( ! function_exists( 'str_contains' ) ) {
	function str_contains( string $haystack, string $needle ): bool {
		return '' === $needle || false !== strpos( $haystack, $needle );
	}
}

require_once dirname( __DIR__ ) . '/src/interface-sidebar-storage.php';
require_once dirname( __DIR__ ) . '/src/class-user-meta-storage.php';
require_once dirname( __DIR__ ) . '/src/class-sidebar-normalizer.php';
require_once dirname( __DIR__ ) . '/src/class-sidebar-signals.php';
require_once dirname( __DIR__ ) . '/src/registry.php';
