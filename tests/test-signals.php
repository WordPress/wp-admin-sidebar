<?php
/**
 * Sidebar_Signals tests.
 *
 * Two layers exercised:
 *
 *   1. extract_raw() — covers each of the four supported markup patterns
 *      (count-N, inline-text, inline-icon, awaiting-mod) the source endpoint
 *      parses (the Calypso admin-menu REST endpoint shipped in
 *      jetpack-mu-wpcom). The shape and field-presence semantics should
 *      match its parse_menu_item().
 *
 *   2. map_to_nav() — derives snake_case nav-model fields from the camelCase
 *      raw shape, including numeric_badge and attention.
 *
 * Run from this directory: php tests/test-signals.php
 *
 * @package WP_Admin_Sidebar\Tests
 */

// CLI-only script: WordPress.Security.EscapeOutput is for HTML browser output, not stdout.
// phpcs:disable WordPress.Security.EscapeOutput.OutputNotEscaped

require_once __DIR__ . '/bootstrap.php';

$results = array();

/**
 * Trivial assert helper. Keeps the test file dependency-free; no PHPUnit
 * needed for the inner-loop runs.
 *
 * @param string $name     Test name.
 * @param mixed  $expected Expected value.
 * @param mixed  $actual   Actual value.
 */
function ts_assert_equals( string $name, $expected, $actual ): void {
	global $results;
	$results[] = array(
		'name'   => $name,
		'pass'   => $expected === $actual,
		'expect' => $expected,
		'actual' => $actual,
	);
}

// ─── extract_raw() ──────────────────────────────────────────────────────

ts_assert_equals(
	'extract_raw: plain title strips to bare title',
	array( 'title' => 'Posts' ),
	Sidebar_Signals::extract_raw( 'Posts' )
);

ts_assert_equals(
	'extract_raw: count-N pattern captures int, removes markup',
	array(
		'count' => 3,
		'title' => 'Comments',
	),
	Sidebar_Signals::extract_raw( 'Comments <span class="awaiting-mod count-3"><span class="pending-count">3</span></span>' )
);

ts_assert_equals(
	'extract_raw: count-0 is skipped (never set)',
	array( 'title' => 'Comments' ),
	Sidebar_Signals::extract_raw( 'Comments <span class="awaiting-mod count-0"><span class="pending-count">0</span></span>' )
);

ts_assert_equals(
	'extract_raw: inline-text marker captures text + strips',
	array(
		'inlineText' => 'NEW',
		'title'      => 'Jetpack',
	),
	Sidebar_Signals::extract_raw( 'Jetpack <span class="inline-text" style="color:red">NEW</span>' )
);

ts_assert_equals(
	'extract_raw: inline-icon captures dashicon slug',
	array(
		'inlineIcon' => 'dashicons-warning',
		'title'      => 'Updates',
	),
	Sidebar_Signals::extract_raw( 'Updates <span class="inline-icon dashicons dashicons-warning" aria-hidden="true"></span>' )
);

ts_assert_equals(
	'extract_raw: awaiting-mod with text becomes badge (text, not HTML)',
	array(
		'badge' => 'New',
		'title' => 'Sensei',
	),
	Sidebar_Signals::extract_raw( 'Sensei <span class="awaiting-mod">New</span>' )
);

ts_assert_equals(
	'extract_raw: ucfirst applied to remaining title',
	array( 'title' => 'Posts' ),
	Sidebar_Signals::extract_raw( 'posts' )
);

ts_assert_equals(
	'extract_raw: non-string input returns empty array',
	array(),
	Sidebar_Signals::extract_raw( 12345 )
);

// ─── map_to_nav() ───────────────────────────────────────────────────────

ts_assert_equals(
	'map_to_nav: empty raw → all-null nav signal, attention false',
	array(
		'count'         => null,
		'numeric_badge' => null,
		'inline_text'   => null,
		'inline_icon'   => null,
		'badge'         => null,
		'attention'     => false,
	),
	Sidebar_Signals::map_to_nav( array( 'title' => 'Posts' ) )
);

ts_assert_equals(
	'map_to_nav: count > 0 sets attention',
	array(
		'count'         => 3,
		'numeric_badge' => null,
		'inline_text'   => null,
		'inline_icon'   => null,
		'badge'         => null,
		'attention'     => true,
	),
	Sidebar_Signals::map_to_nav(
		array(
			'count' => 3,
			'title' => 'Comments',
		)
	)
);

ts_assert_equals(
	'map_to_nav: numeric badge derives from awaiting-mod numeric (Sensei pattern)',
	array(
		'count'         => null,
		'numeric_badge' => 5,
		'inline_text'   => null,
		'inline_icon'   => null,
		'badge'         => '5',
		'attention'     => true,
	),
	Sidebar_Signals::map_to_nav(
		array(
			'badge' => '5',
			'title' => 'Grading',
		)
	)
);

ts_assert_equals(
	'map_to_nav: badge with non-numeric text leaves numeric_badge null, badge populated',
	array(
		'count'         => null,
		'numeric_badge' => null,
		'inline_text'   => null,
		'inline_icon'   => null,
		'badge'         => 'New',
		'attention'     => true,
	),
	Sidebar_Signals::map_to_nav(
		array(
			'badge' => 'New',
			'title' => 'Sensei',
		)
	)
);

ts_assert_equals(
	'map_to_nav: inline_text alone does NOT trigger attention (decorative label)',
	array(
		'count'         => null,
		'numeric_badge' => null,
		'inline_text'   => 'BETA',
		'inline_icon'   => null,
		'badge'         => null,
		'attention'     => false,
	),
	Sidebar_Signals::map_to_nav(
		array(
			'inlineText' => 'BETA',
			'title'      => 'Jetpack',
		)
	)
);

// ─── Report ─────────────────────────────────────────────────────────────

$pass = 0;
$fail = 0;
foreach ( $results as $r ) {
	if ( $r['pass'] ) {
		++$pass;
		echo 'PASS: ' . $r['name'] . "\n";
	} else {
		++$fail;
		echo 'FAIL: ' . $r['name'] . "\n";
		echo '  expected: ' . var_export( $r['expect'], true ) . "\n";
		echo '  actual:   ' . var_export( $r['actual'], true ) . "\n";
	}
}
echo "\n{$pass} passed, {$fail} failed\n";
exit( $fail > 0 ? 1 : 0 );
