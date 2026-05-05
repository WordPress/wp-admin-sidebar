<?php
/**
 * REST handler for the per-user, per-site sidebar layout.
 *
 * Registers `GET /wp-admin-sidebar/v1/layout` and `POST /wp-admin-sidebar/v1/layout`
 * on `rest_api_init`. On WPCOM, the same handlers are exposed under
 * `wpcom/v2/wp-admin-sidebar/layout` by the WPCOM REST endpoint plugin at
 * `wp-content/rest-api-plugins/endpoints/wp-admin-sidebar.php`. See plan
 * 03-contracts.md § 10 for the namespace abstraction; the WPCOM-specific
 * route exists because `register_rest_route` calls from a regular mu-plugin
 * do not surface in WPCOM's centralized REST API dispatcher.
 *
 * Read/write goes through the bound `Sidebar_Layout_Storage`, never through
 * a concrete user-meta or user-attribute call directly. The default in the
 * core layer is `WP_User_Meta_Storage`; on WPCOM the bootstrap binds the
 * WPCOM user-attribute implementation instead (lives in /src/wpcom-integration/).
 *
 * Contract reference: plan 03-contracts.md § 3 (LayoutDelta), § 4 (REST surface),
 *                     § 9 (Storage abstraction).
 *
 * @package WPCOM_Admin_Sidebar
 */

if ( ! defined( 'ABSPATH' ) ) {
	return;
}

if ( class_exists( 'Sidebar_Rest' ) ) {
	return;
}

/**
 * Layout REST handler. Stateless. Validation lives here so the WPCOM alias can
 * pass requests through unchanged.
 */
class Sidebar_Rest {

	public const NAMESPACE = 'wp-admin-sidebar/v1';
	public const ROUTE     = '/layout';

	/**
	 * Hard cap on per-delta overrides. Prevents abuse and bounds storage growth.
	 * Plan 03-contracts.md § 4.
	 */
	public const MAX_OVERRIDES = 64;

	/**
	 * Pattern for a compound itemId: <kind>:<ref>:<parent>:<slug>. Each segment
	 * is non-empty; parent uses `-` as the null sentinel. See plan
	 * 03-contracts.md § 1 for the identity rule.
	 */
	private const ITEM_ID_PATTERN = '~^[a-z]+:[A-Za-z0-9._/+\-]+:[A-Za-z0-9._?=&\-/+]+:[A-Za-z0-9._?=&\-/+%]+$~';

	/**
	 * Hook the route registrations + the admin-ajax fallback handler.
	 *
	 * The admin-ajax surface exists because WPCOM disables /wp-json/ on user
	 * blogs (only public-api.wordpress.com and a handful of allow-listed
	 * environments expose it), and public-api itself uses OAuth2 / proxy-
	 * request auth that is not natively reachable from wp-admin pages with
	 * the wp_rest cookie nonce. admin-ajax.php is same-origin with wp-admin
	 * on every environment, accepts the same cookie nonce, and is the
	 * pragmatic surface for the customizer save POST. The same handler logic
	 * runs here as on the REST route.
	 */
	public static function register(): void {
		add_action( 'rest_api_init', array( __CLASS__, 'register_routes' ) );
		// Canonical admin-ajax handler. The legacy `wp_ajax_wpcom_admin_sidebar_layout_save`
		// hook is also bound for one cycle so a host adapter that hasn't migrated
		// its `wp_admin_sidebar_layout_rest_url` URL still works. Drop in v0.2.x.
		add_action( 'wp_ajax_wp_admin_sidebar_layout_save', array( __CLASS__, 'handle_admin_ajax_save' ) );
		add_action( 'wp_ajax_wpcom_admin_sidebar_layout_save', array( __CLASS__, 'handle_admin_ajax_save_legacy' ) );
	}

	/**
	 * Legacy admin-ajax bridge. Emits a deprecation notice, then routes to the
	 * canonical handler. Drop in v0.2.x alongside the canonical action above.
	 */
	public static function handle_admin_ajax_save_legacy(): void {
		_deprecated_hook(
			'wp_ajax_wpcom_admin_sidebar_layout_save',
			'0.1.0',
			'wp_ajax_wp_admin_sidebar_layout_save'
		);
		self::handle_admin_ajax_save();
	}

	/**
	 * Register both GET and POST under the generic namespace.
	 */
	public static function register_routes(): void {
		register_rest_route(
			self::NAMESPACE,
			self::ROUTE,
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( __CLASS__, 'handle_get' ),
					'permission_callback' => array( __CLASS__, 'permission_check' ),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( __CLASS__, 'handle_post' ),
					'permission_callback' => array( __CLASS__, 'permission_check' ),
				),
			)
		);
	}

	/**
	 * Permission gate for both verbs. Two checks:
	 *
	 *   1. The feature must be enabled for the current user via the
	 *      `wp_admin_sidebar_enabled` filter (sticker on WPCOM, opt-in
	 *      toggle on plain WP). When the gate fails, return 401/403 from the
	 *      REST framework rather than 200 with empty data — defense-in-depth
	 *      so non-stickered blogs can't be probed via this endpoint, even
	 *      though the handlers themselves only operate on the calling user's
	 *      own data.
	 *   2. The caller must have read capability on the site. Mirror of the
	 *      existing admin-menu endpoint
	 *      (class-wpcom-rest-api-v2-endpoint-admin-menu.php:74).
	 *
	 * The feature gate also makes the platform-wide kill switch
	 * (`add_filter( 'wp_admin_sidebar_enabled', '__return_false', 999 )`)
	 * cover the REST surface as well as the UI surface.
	 */
	public static function permission_check(): bool {
		$user_id = get_current_user_id();
		$enabled = apply_filters( 'wp_admin_sidebar_enabled', false, $user_id );
		// Legacy alias bridge — drop in v0.2.x.
		$enabled = apply_filters_deprecated(
			'wpcom_admin_sidebar_enabled',
			array( $enabled, $user_id ),
			'0.1.0',
			'wp_admin_sidebar_enabled'
		);
		if ( ! $enabled ) {
			return false;
		}
		return current_user_can( 'read' );
	}

	/**
	 * GET /layout — return the current user's saved delta for this site.
	 * When nothing is stored, return the empty-delta shape so clients always
	 * see a well-formed object.
	 *
	 * @return WP_REST_Response
	 */
	public static function handle_get() {
		$user_id = get_current_user_id();
		$site_id = (int) get_current_blog_id();

		$delta = self::read_delta( $user_id, $site_id );
		if ( null === $delta ) {
			$delta = self::empty_delta();
		}

		return rest_ensure_response( $delta );
	}

	/**
	 * POST /layout — validate, then read-modify-write the per-site map.
	 *
	 * @param WP_REST_Request $request
	 * @return WP_REST_Response|WP_Error
	 */
	public static function handle_post( $request ) {
		$user_id = get_current_user_id();
		$site_id = (int) get_current_blog_id();

		$body = $request->get_json_params();
		if ( ! is_array( $body ) ) {
			return new WP_Error( 'invalid_body', 'Body must be a JSON object.', array( 'status' => 400 ) );
		}

		$validated = self::validate_delta( $body );
		if ( is_wp_error( $validated ) ) {
			return $validated;
		}

		$validated['updated_at'] = time();

		$storage = self::get_storage();
		$layouts = $storage->get_layouts( $user_id );
		if ( ! is_array( $layouts ) ) {
			$layouts = array();
		}
		$layouts[ $site_id ] = $validated;

		if ( ! $storage->put_layouts( $user_id, $layouts ) ) {
			return new WP_Error( 'storage_failure', 'Could not persist layout.', array( 'status' => 500 ) );
		}

		return rest_ensure_response( $validated );
	}

	/**
	 * Admin-ajax handler for the customizer save POST. Reads the JSON body off
	 * php://input, runs it through the same validation + storage path as
	 * `handle_post`, and returns the persisted delta as JSON. Used by the WPCOM-
	 * merge flow because /wp-json/ is disabled on user blogs there (see
	 * `register()` docblock).
	 */
	public static function handle_admin_ajax_save(): void {
		// Feature gate (matches permission_check on the REST routes). Defense-
		// in-depth — the handler's storage path only writes to the calling
		// user's own row, but skipping work on non-stickered blogs avoids
		// fingerprinting the sticker via a probing call and lets the
		// platform-wide kill switch cover this surface too.
		$user_id = get_current_user_id();
		$enabled = apply_filters( 'wp_admin_sidebar_enabled', false, $user_id );
		// Legacy alias bridge — drop in v0.2.x.
		$enabled = apply_filters_deprecated(
			'wpcom_admin_sidebar_enabled',
			array( $enabled, $user_id ),
			'0.1.0',
			'wp_admin_sidebar_enabled'
		);
		if ( ! $enabled ) {
			status_header( 401 );
			wp_send_json(
				array(
					'code'    => 'rest_forbidden',
					'message' => 'Sorry, you are not allowed to do that.',
					'data'    => array( 'status' => 401 ),
				)
			);
		}

		if ( ! current_user_can( 'read' ) ) {
			status_header( 401 );
			wp_send_json(
				array(
					'code'    => 'rest_forbidden',
					'message' => 'Sorry, you are not allowed to do that.',
					'data'    => array( 'status' => 401 ),
				)
			);
		}

		$nonce = isset( $_SERVER['HTTP_X_WP_NONCE'] ) ? sanitize_text_field( wp_unslash( $_SERVER['HTTP_X_WP_NONCE'] ) ) : '';
		if ( ! wp_verify_nonce( $nonce, 'wp_rest' ) ) {
			status_header( 403 );
			wp_send_json(
				array(
					'code'    => 'rest_cookie_invalid_nonce',
					'message' => 'Cookie nonce is invalid.',
					'data'    => array( 'status' => 403 ),
				)
			);
		}

		// phpcs:ignore WPCOM.FileGetContents.FileGetContents.file_get_contents -- php://input is the request body stream, not a remote file fetch; admin-ajax has no $request object to read it from.
		$raw  = file_get_contents( 'php://input' );
		$body = json_decode( (string) $raw, true );
		if ( ! is_array( $body ) ) {
			status_header( 400 );
			wp_send_json(
				array(
					'code'    => 'invalid_body',
					'message' => 'Body must be a JSON object.',
					'data'    => array( 'status' => 400 ),
				)
			);
		}

		// Reuse the REST handler so validation + storage stays in one place.
		$request = new WP_REST_Request( 'POST', '/' . self::NAMESPACE . self::ROUTE );
		$request->set_header( 'Content-Type', 'application/json' );
		$request->set_body( wp_json_encode( $body ) );

		$response = self::handle_post( $request );
		if ( is_wp_error( $response ) ) {
			$data   = $response->get_error_data();
			$status = is_array( $data ) && isset( $data['status'] ) ? (int) $data['status'] : 400;
			status_header( $status );
			wp_send_json(
				array(
					'code'    => $response->get_error_code(),
					'message' => $response->get_error_message(),
					'data'    => array( 'status' => $status ),
				)
			);
		}

		wp_send_json( $response->get_data() );
	}

	/**
	 * Validate an incoming LayoutDelta. Returns the cleaned delta on success or
	 * a WP_Error with code+message on failure. Validation rules are normative
	 * per plan 03-contracts.md § 4 — keep error codes stable, the client
	 * surfaces them in the live region.
	 *
	 * @param array $body Raw JSON body.
	 * @return array|WP_Error
	 */
	public static function validate_delta( array $body ) {
		// Schema-level checks first.
		if ( ! isset( $body['version'] ) || ! is_int( $body['version'] ) || $body['version'] < 1 ) {
			return new WP_Error( 'invalid_version', 'version must be an integer >= 1.', array( 'status' => 400 ) );
		}
		if ( isset( $body['updated_at'] ) && ( ! is_int( $body['updated_at'] ) || $body['updated_at'] < 0 ) ) {
			return new WP_Error( 'invalid_updated_at', 'updated_at must be a non-negative integer.', array( 'status' => 400 ) );
		}
		if ( ! isset( $body['overrides'] ) || ! is_array( $body['overrides'] ) ) {
			return new WP_Error( 'invalid_overrides', 'overrides must be an array.', array( 'status' => 400 ) );
		}

		$overrides = array_values( $body['overrides'] );
		if ( count( $overrides ) > self::MAX_OVERRIDES ) {
			return new WP_Error(
				'too_many_overrides',
				sprintf( 'overrides exceeds the maximum of %d.', self::MAX_OVERRIDES ),
				array( 'status' => 400 )
			);
		}

		$registry        = self::active_registry();
		$valid_group_ids = self::active_group_ids( $registry );

		$cleaned = array();
		foreach ( $overrides as $idx => $override ) {
			if ( ! is_array( $override ) ) {
				return new WP_Error(
					'invalid_override',
					sprintf( 'overrides[%d] must be an object.', $idx ),
					array( 'status' => 400 )
				);
			}

			$item_id  = isset( $override['itemId'] ) ? (string) $override['itemId'] : '';
			$position = isset( $override['position'] ) && is_array( $override['position'] ) ? $override['position'] : null;

			if ( '' === $item_id || strlen( $item_id ) > 256 || ! preg_match( self::ITEM_ID_PATTERN, $item_id ) ) {
				return new WP_Error(
					'invalid_item_id',
					sprintf( 'overrides[%d].itemId is malformed.', $idx ),
					array( 'status' => 400 )
				);
			}

			// reassignable=false items must not be moved. The v1 client UI never
			// surfaces these as drag sources, but the server defends anyway.
			if ( isset( $registry[ $item_id ]['reassignable'] ) && false === $registry[ $item_id ]['reassignable'] ) {
				return new WP_Error(
					'item_not_reassignable',
					sprintf( 'overrides[%d].itemId refers to a non-reassignable item.', $idx ),
					array( 'status' => 400 )
				);
			}

			$position = self::validate_position( $position, $valid_group_ids );
			if ( is_wp_error( $position ) ) {
				return new WP_Error(
					$position->get_error_code(),
					sprintf( 'overrides[%d].position: %s', $idx, $position->get_error_message() ),
					array( 'status' => 400 )
				);
			}

			$cleaned[] = array(
				'itemId'   => $item_id,
				'position' => $position,
			);
		}

		return array(
			'version'    => (int) $body['version'],
			'updated_at' => isset( $body['updated_at'] ) ? (int) $body['updated_at'] : 0,
			'overrides'  => $cleaned,
		);
	}

	/**
	 * Validate a Position. Returns the canonicalised position or WP_Error.
	 *
	 * @param mixed $position
	 * @param array $valid_group_ids Group ids defined by the active registry.
	 *                               When non-empty, `in_group` positions whose
	 *                               group_id is not in the set are rejected.
	 *                               When empty (test fixtures, registry-less
	 *                               environments) the membership check is
	 *                               skipped — the shape and slug-syntax checks
	 *                               still run.
	 * @return array|WP_Error
	 */
	private static function validate_position( $position, array $valid_group_ids = array() ) {
		if ( ! is_array( $position ) || ! isset( $position['kind'] ) ) {
			return new WP_Error( 'invalid_position', 'missing kind.' );
		}
		$kind  = (string) $position['kind'];
		$index = isset( $position['index'] ) ? $position['index'] : null;
		if ( ! is_int( $index ) || $index < 0 || $index > 999 ) {
			return new WP_Error( 'invalid_position_index', 'index must be an integer in [0, 999].' );
		}

		if ( 'top_level' === $kind ) {
			return array(
				'kind'  => 'top_level',
				'index' => $index,
			);
		}
		if ( 'in_group' === $kind ) {
			$group_id = isset( $position['group_id'] ) ? (string) $position['group_id'] : '';
			if ( '' === $group_id || strlen( $group_id ) > 64 || ! preg_match( '/^[a-z][a-z0-9_-]*$/', $group_id ) ) {
				return new WP_Error( 'invalid_group_id', 'group_id is malformed.' );
			}
			// Ghost-group rejection (Codex review feedback). When the active
			// registry defines a group set, `in_group` positions targeting a
			// group_id that isn't in that set get rejected — otherwise the
			// override silently no-ops at render time (no target container).
			// Stale-item preservation behavior for unknown itemIds is
			// intentionally separate (see validate_delta) — itemIds CAN be
			// unknown (deactivated plugin, will re-apply on reactivate),
			// group_ids cannot (groups are platform-stable).
			if ( ! empty( $valid_group_ids ) && ! in_array( $group_id, $valid_group_ids, true ) ) {
				return new WP_Error( 'unknown_group_id', sprintf( 'group_id "%s" is not in the active registry.', $group_id ) );
			}
			return array(
				'kind'     => 'in_group',
				'group_id' => $group_id,
				'index'    => $index,
			);
		}

		return new WP_Error( 'invalid_position_kind', 'kind must be top_level or in_group.' );
	}

	/**
	 * Extract the set of group ids from the active classification registry.
	 * Each registry entry's `default_group` field declares which group its
	 * item belongs to; the unique set of those values is the group registry
	 * for the current request.
	 *
	 * Returns an empty array when the registry is missing or has no
	 * `default_group` fields. validate_position() reads that as "skip the
	 * membership check" (lenient) so test fixtures and registry-less
	 * environments don't reject every `in_group` position.
	 *
	 * @param array $registry The result of self::active_registry().
	 * @return array<int,string> Unique group ids.
	 */
	private static function active_group_ids( array $registry ): array {
		$ids = array();
		foreach ( $registry as $entry ) {
			if ( ! is_array( $entry ) ) {
				continue;
			}
			if ( ! isset( $entry['default_group'] ) || ! is_string( $entry['default_group'] ) ) {
				continue;
			}
			if ( '' === $entry['default_group'] ) {
				continue;
			}
			$ids[ $entry['default_group'] ] = true;
		}
		return array_keys( $ids );
	}

	/**
	 * Read the current user's saved delta for this site, or null if none.
	 */
	private static function read_delta( int $user_id, int $site_id ): ?array {
		if ( ! $user_id ) {
			return null;
		}
		$layouts = self::get_storage()->get_layouts( $user_id );
		if ( ! isset( $layouts[ $site_id ] ) || ! is_array( $layouts[ $site_id ] ) ) {
			return null;
		}
		return $layouts[ $site_id ];
	}

	/**
	 * Resolve the active storage implementation. Mirrors Sidebar_Data_Planner.
	 */
	private static function get_storage(): Sidebar_Layout_Storage {
		$default = new WP_User_Meta_Storage();
		$bound   = apply_filters( 'wp_admin_sidebar_storage', $default );
		// Legacy alias bridge — drop in v0.2.x.
		$bound = apply_filters_deprecated(
			'wpcom_admin_sidebar_storage',
			array( $bound ),
			'0.1.0',
			'wp_admin_sidebar_storage'
		);
		return $bound instanceof Sidebar_Layout_Storage ? $bound : $default;
	}

	/**
	 * Resolve the registry the validator should defer to. Same pipeline as the
	 * classifier: defaults + amend filter.
	 */
	private static function active_registry(): array {
		$registry = function_exists( 'wp_admin_sidebar_default_registry' )
			? wp_admin_sidebar_default_registry()
			: array();
		$registry = (array) apply_filters( 'wp_admin_sidebar_registry', $registry );
		// Legacy alias bridge — drop in v0.2.x.
		$registry = (array) apply_filters_deprecated(
			'wpcom_admin_sidebar_registry',
			array( $registry ),
			'0.1.0',
			'wp_admin_sidebar_registry'
		);
		return $registry;
	}

	/**
	 * The empty-delta shape returned when a user has not customized this site.
	 */
	private static function empty_delta(): array {
		return array(
			'version'    => 1,
			'updated_at' => 0,
			'overrides'  => array(),
		);
	}
}
