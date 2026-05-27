<?php
/**
 * Sidebar_Data_Planner URL resolution tests.
 *
 * @package WP_Admin_Sidebar\Tests
 */

// CLI-only test script with WP shims defined inline.
// phpcs:disable WordPress.Security.EscapeOutput.OutputNotEscaped, Universal.Files.SeparateFunctionsFromOO.Mixed

require_once __DIR__ . '/bootstrap.php';

$filters = array();

if ( ! function_exists( 'rest_url' ) ) {
	function rest_url( $path = '' ): string {
		return 'http://example.test/index.php?rest_route=/' . ltrim( (string) $path, '/' );
	}
}

if ( ! function_exists( 'home_url' ) ) {
	function home_url( $path = '' ): string {
		return 'http://example.test/wp-json-is-not-active' . (string) $path;
	}
}

if ( ! function_exists( 'apply_filters' ) ) {
	function apply_filters( $tag, $value ) {
		global $filters;
		return array_key_exists( $tag, $filters ) ? $filters[ $tag ] : $value;
	}
}

if ( ! function_exists( 'apply_filters_deprecated' ) ) {
	function apply_filters_deprecated( $tag, $args, $version, $replacement = '' ) {
		global $filters;
		$value = $args[0] ?? null;
		return array_key_exists( $tag, $filters ) ? $filters[ $tag ] : $value;
	}
}

require_once dirname( __DIR__ ) . '/src/class-sidebar-data-planner.php';

$results = array();

function tdp_assert_equals( string $name, $expected, $actual ): void {
	global $results;
	$results[] = array(
		'name' => $name,
		'pass' => $expected === $actual,
	);
}

$method = new ReflectionMethod( 'Sidebar_Data_Planner', 'resolve_rest_url' );

tdp_assert_equals(
	'default uses rest_url fallback-aware endpoint',
	'http://example.test/index.php?rest_route=/wp-admin-sidebar/v1/layout',
	$method->invoke( null )
);

$filters['wp_admin_sidebar_layout_rest_url'] = 'http://example.test/custom-layout-endpoint';
tdp_assert_equals(
	'new filter overrides default endpoint',
	'http://example.test/custom-layout-endpoint',
	$method->invoke( null )
);

$filters['wpcom_admin_sidebar_layout_rest_url'] = 'http://example.test/legacy-layout-endpoint';
tdp_assert_equals(
	'legacy filter still overrides after new filter',
	'http://example.test/legacy-layout-endpoint',
	$method->invoke( null )
);

$failed = 0;
foreach ( $results as $result ) {
	if ( $result['pass'] ) {
		echo 'PASS: ' . $result['name'] . PHP_EOL;
		continue;
	}
	echo 'FAIL: ' . $result['name'] . PHP_EOL;
	$failed++;
}

$total = count( $results );
echo PHP_EOL . sprintf( '%d passed, %d failed', $total - $failed, $failed ) . PHP_EOL;
exit( $failed > 0 ? 1 : 0 );
