<?php
/**
 * Sidebar_Rest::validate_delta() tests.
 *
 * Covers the validation rules from plan 03-contracts.md § 4 — schema shape,
 * malformed itemIds, non-reassignable items, position structure, max overrides.
 *
 * Pure unit tests on the validator itself. Full GET/POST round-trip lives in
 * the JN smoke test (real REST runtime needed for register_rest_route / nonces).
 *
 * @package WP_Admin_Sidebar\Tests
 */

// CLI-only test script with WP shims defined inline; rules below target production HTML output
// and one-class-per-file conventions that don't apply to test scaffolding.
// phpcs:disable WordPress.Security.EscapeOutput.OutputNotEscaped, Universal.Files.SeparateFunctionsFromOO.Mixed, Generic.Files.OneObjectStructurePerFile.MultipleFound

require_once __DIR__ . '/bootstrap.php';

if ( ! class_exists( 'WP_Error' ) ) {
	/**
	 * Minimal WP_Error shim for tests.
	 */
	class WP_Error {
		private $code;
		private $message;
		private $data;
		public function __construct( $code = '', $message = '', $data = null ) {
			$this->code    = $code;
			$this->message = $message;
			$this->data    = $data;
		}
		public function get_error_code() {
			return $this->code;
		}
		public function get_error_message() {
			return $this->message;
		}
		public function get_error_data() {
			return $this->data;
		}
	}
}

if ( ! function_exists( 'is_wp_error' ) ) {
	function is_wp_error( $thing ): bool {
		return $thing instanceof WP_Error;
	}
}

if ( ! function_exists( 'apply_filters' ) ) {
	function apply_filters( $tag, $value ) {
		return $value;
	}
}

if ( ! function_exists( 'apply_filters_deprecated' ) ) {
	function apply_filters_deprecated( $tag, $args, $version, $replacement = '' ) {
		return $args[0] ?? null;
	}
}

if ( ! function_exists( 'add_action' ) ) {
	function add_action( $tag, $callable, $priority = 10, $accepted_args = 1 ): bool {
		return true;
	}
}

if ( ! function_exists( '_deprecated_function' ) ) {
	function _deprecated_function( $function_name, $version, $replacement = '' ): void {
		// no-op shim
	}
}

if ( ! function_exists( '_deprecated_hook' ) ) {
	function _deprecated_hook( $hook_name, $version, $replacement = '', $message = '' ): void {
		// no-op shim
	}
}

if ( ! class_exists( 'WP_REST_Server' ) ) {
	class WP_REST_Server {
		const READABLE  = 'GET';
		const CREATABLE = 'POST';
	}
}

require_once dirname( __DIR__ ) . '/src/class-sidebar-rest.php';

$results = array();

function tr_assert_equals( string $name, $expected, $actual ): void {
	global $results;
	$results[] = array(
		'name' => $name,
		'pass' => $expected === $actual,
	);
}

function tr_assert_error( string $name, $value, string $expected_code ): void {
	global $results;
	$ok = is_wp_error( $value ) && $value->get_error_code() === $expected_code;
	$results[] = array(
		'name' => $name,
		'pass' => $ok,
	);
}

function tr_assert_ok( string $name, $value ): void {
	global $results;
	$results[] = array(
		'name' => $name,
		'pass' => is_array( $value ) && ! is_wp_error( $value ),
	);
}

// ─── Schema-level checks ─────────────────────────────────────────────────

tr_assert_error(
	'reject: missing version',
	Sidebar_Rest::validate_delta( array( 'overrides' => array() ) ),
	'invalid_version'
);

tr_assert_error(
	'reject: non-int version',
	Sidebar_Rest::validate_delta( array( 'version' => '1', 'overrides' => array() ) ),
	'invalid_version'
);

tr_assert_error(
	'reject: version < 1',
	Sidebar_Rest::validate_delta( array( 'version' => 0, 'overrides' => array() ) ),
	'invalid_version'
);

tr_assert_error(
	'reject: missing overrides',
	Sidebar_Rest::validate_delta( array( 'version' => 1 ) ),
	'invalid_overrides'
);

tr_assert_error(
	'reject: non-array overrides',
	Sidebar_Rest::validate_delta( array( 'version' => 1, 'overrides' => 'not an array' ) ),
	'invalid_overrides'
);

tr_assert_error(
	'reject: negative updated_at',
	Sidebar_Rest::validate_delta( array( 'version' => 1, 'updated_at' => -1, 'overrides' => array() ) ),
	'invalid_updated_at'
);

// ─── Empty delta passes ──────────────────────────────────────────────────

$ok = Sidebar_Rest::validate_delta( array( 'version' => 1, 'overrides' => array() ) );
tr_assert_ok( 'accept: minimal valid delta', $ok );
tr_assert_equals( 'accept: empty overrides preserved', array(), $ok['overrides'] );
tr_assert_equals( 'accept: version cast to int', 1, $ok['version'] );

// ─── Single override, top_level position ─────────────────────────────────

$ok = Sidebar_Rest::validate_delta(
	array(
		'version'   => 1,
		'overrides' => array(
			array(
				'itemId'   => 'plugin:woocommerce/woocommerce.php:-:woocommerce',
				'position' => array( 'kind' => 'top_level', 'index' => 0 ),
			),
		),
	)
);
tr_assert_ok( 'accept: woocommerce → top_level', $ok );
tr_assert_equals( 'accept: top_level index preserved', 0, $ok['overrides'][0]['position']['index'] );
tr_assert_equals( 'accept: top_level kind preserved', 'top_level', $ok['overrides'][0]['position']['kind'] );

// ─── Single override, in_group position ──────────────────────────────────

$ok = Sidebar_Rest::validate_delta(
	array(
		'version'   => 1,
		'overrides' => array(
			array(
				'itemId'   => 'plugin:unknown:-:wpseo_dashboard',
				'position' => array( 'kind' => 'in_group', 'group_id' => 'plugins', 'index' => 5 ),
			),
		),
	)
);
tr_assert_ok( 'accept: yoast → in_group plugins', $ok );
tr_assert_equals( 'accept: in_group group_id preserved', 'plugins', $ok['overrides'][0]['position']['group_id'] );

// ─── Position validation ────────────────────────────────────────────────

tr_assert_error(
	'reject: missing kind',
	Sidebar_Rest::validate_delta(
		array(
			'version'   => 1,
			'overrides' => array(
				array( 'itemId' => 'plugin:unknown:-:foo', 'position' => array( 'index' => 0 ) ),
			),
		)
	),
	'invalid_position'
);

tr_assert_error(
	'reject: non-int index',
	Sidebar_Rest::validate_delta(
		array(
			'version'   => 1,
			'overrides' => array(
				array( 'itemId' => 'plugin:unknown:-:foo', 'position' => array( 'kind' => 'top_level', 'index' => '0' ) ),
			),
		)
	),
	'invalid_position_index'
);

tr_assert_error(
	'reject: index out of range',
	Sidebar_Rest::validate_delta(
		array(
			'version'   => 1,
			'overrides' => array(
				array( 'itemId' => 'plugin:unknown:-:foo', 'position' => array( 'kind' => 'top_level', 'index' => 1000 ) ),
			),
		)
	),
	'invalid_position_index'
);

tr_assert_error(
	'reject: bogus position kind',
	Sidebar_Rest::validate_delta(
		array(
			'version'   => 1,
			'overrides' => array(
				array( 'itemId' => 'plugin:unknown:-:foo', 'position' => array( 'kind' => 'sideways', 'index' => 0 ) ),
			),
		)
	),
	'invalid_position_kind'
);

tr_assert_error(
	'reject: malformed group_id',
	Sidebar_Rest::validate_delta(
		array(
			'version'   => 1,
			'overrides' => array(
				array( 'itemId' => 'plugin:unknown:-:foo', 'position' => array( 'kind' => 'in_group', 'group_id' => 'Plugins!', 'index' => 0 ) ),
			),
		)
	),
	'invalid_group_id'
);

// ─── itemId validation ──────────────────────────────────────────────────

tr_assert_error(
	'reject: malformed itemId (no colons)',
	Sidebar_Rest::validate_delta(
		array(
			'version'   => 1,
			'overrides' => array(
				array( 'itemId' => 'jetpack', 'position' => array( 'kind' => 'top_level', 'index' => 0 ) ),
			),
		)
	),
	'invalid_item_id'
);

tr_assert_error(
	'reject: empty itemId',
	Sidebar_Rest::validate_delta(
		array(
			'version'   => 1,
			'overrides' => array(
				array( 'itemId' => '', 'position' => array( 'kind' => 'top_level', 'index' => 0 ) ),
			),
		)
	),
	'invalid_item_id'
);

tr_assert_error(
	'reject: itemId longer than 256',
	Sidebar_Rest::validate_delta(
		array(
			'version'   => 1,
			'overrides' => array(
				array( 'itemId' => 'plugin:woo:-:' . str_repeat( 'x', 256 ), 'position' => array( 'kind' => 'top_level', 'index' => 0 ) ),
			),
		)
	),
	'invalid_item_id'
);

// ─── Reassignable=false rejection ────────────────────────────────────────
// Core Dashboard is in the registry with reassignable: false.

tr_assert_error(
	'reject: core item not reassignable',
	Sidebar_Rest::validate_delta(
		array(
			'version'   => 1,
			'overrides' => array(
				array( 'itemId' => 'core:core:-:index.php', 'position' => array( 'kind' => 'in_group', 'group_id' => 'plugins', 'index' => 0 ) ),
			),
		)
	),
	'item_not_reassignable'
);

// ─── Too many overrides ─────────────────────────────────────────────────

$big = array();
for ( $i = 0; $i < 65; $i++ ) {
	$big[] = array(
		'itemId'   => sprintf( 'plugin:unknown:-:slug%d', $i ),
		'position' => array( 'kind' => 'top_level', 'index' => $i ),
	);
}
tr_assert_error(
	'reject: > 64 overrides',
	Sidebar_Rest::validate_delta( array( 'version' => 1, 'overrides' => $big ) ),
	'too_many_overrides'
);

// Boundary: exactly 64 passes.
$big = array();
for ( $i = 0; $i < 64; $i++ ) {
	$big[] = array(
		'itemId'   => sprintf( 'plugin:unknown:-:slug%d', $i ),
		'position' => array( 'kind' => 'top_level', 'index' => $i ),
	);
}
tr_assert_ok( 'accept: exactly 64 overrides', Sidebar_Rest::validate_delta( array( 'version' => 1, 'overrides' => $big ) ) );

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
	}
}

echo "\n";
echo $pass . ' passed, ' . $fail . " failed\n";

exit( $fail > 0 ? 1 : 0 );
