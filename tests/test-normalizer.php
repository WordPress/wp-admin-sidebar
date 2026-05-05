<?php
/**
 * Sidebar_Normalizer tests.
 *
 * Covers the drop rules from plan 03-contracts.md § 0:
 *   - Non-array submenu rows (null / false from broken plugin combos)
 *   - hide-if-js items (CSS class on position 4)
 *   - Missing capability index
 *   - Empty title without usable slug fallback
 *   - Separator pass-through
 *
 * @package WP_Admin_Sidebar\Tests
 */

// CLI-only script: WordPress.Security.EscapeOutput is for HTML browser output, not stdout.
// phpcs:disable WordPress.Security.EscapeOutput.OutputNotEscaped

require_once __DIR__ . '/bootstrap.php';

$results = array();

/**
 * @param string $name
 * @param mixed  $expected
 * @param mixed  $actual
 */
function tn_assert_equals( string $name, $expected, $actual ): void {
	global $results;
	$results[] = array(
		'name'   => $name,
		'pass'   => $expected === $actual,
		'expect' => $expected,
		'actual' => $actual,
	);
}

// Compact menu-row helper. WordPress uses positional-array rows of the form
// [ 0=>title, 1=>cap, 2=>slug, 3=>page-title, 4=>class, 5=>hookname, 6=>icon ].
$row = static function ( string $title, string $cap, string $slug, string $class = '' ): array {
	return array( $title, $cap, $slug, '', $class, '', '' );
};

// ─── Top-level drops ────────────────────────────────────────────────────

$normalized = Sidebar_Normalizer::normalize(
	array(
		$row( 'Posts', 'edit_posts', 'edit.php' ),
		$row( 'Hidden', 'manage_options', 'hidden.php', 'hide-if-js menu-top' ),
		$row( '', '', '' ),
		$row( 'Tools', 'edit_posts', 'tools.php' ),
	),
	array()
);

tn_assert_equals(
	'normalize: hide-if-js + missing-cap dropped, valid rows kept',
	2,
	count( $normalized['top_level'] )
);

tn_assert_equals(
	'normalize: surviving top-level rows preserve order',
	'edit.php',
	$normalized['top_level'][0][2]
);

tn_assert_equals(
	'normalize: surviving second row is tools.php',
	'tools.php',
	$normalized['top_level'][1][2]
);

// ─── Submenu drops (null/false rows from plugin combos) ─────────────────

$normalized = Sidebar_Normalizer::normalize(
	array(
		$row( 'Posts', 'edit_posts', 'edit.php' ),
	),
	array(
		'edit.php' => array(
			$row( 'All Posts', 'edit_posts', 'edit.php' ),
			null,
			false,
			$row( 'Add New', 'edit_posts', 'post-new.php' ),
			$row( 'Hidden', 'edit_posts', 'hidden-sub.php', 'hide-if-js' ),
		),
	)
);

tn_assert_equals(
	'normalize: null + false + hide-if-js submenu rows dropped',
	2,
	count( $normalized['submenu']['edit.php'] )
);

// ─── Separator pass-through ─────────────────────────────────────────────

$normalized = Sidebar_Normalizer::normalize(
	array(
		$row( '', '', 'separator1', 'wp-menu-separator' ),
		$row( 'Tools', 'edit_posts', 'tools.php' ),
	),
	array()
);

tn_assert_equals(
	'normalize: separator survives',
	2,
	count( $normalized['top_level'] )
);

tn_assert_equals(
	'normalize: separator preserves wp-menu-separator class',
	true,
	str_contains( (string) $normalized['top_level'][0][4], 'wp-menu-separator' )
);

// ─── Empty submenu after drops is removed entirely ──────────────────────

$normalized = Sidebar_Normalizer::normalize(
	array( $row( 'X', 'cap', 'x.php' ) ),
	array(
		'x.php' => array( null, false ),
	)
);

tn_assert_equals(
	'normalize: parent with all-dropped children gets no submenu key',
	false,
	isset( $normalized['submenu']['x.php'] )
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
