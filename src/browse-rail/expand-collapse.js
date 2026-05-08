/**
 * Group expand / collapse state.
 *
 * Behaviour:
 *
 *   - Default: every group is collapsed.
 *   - Auto-expand: the group whose children include the current URL's item
 *     starts expanded, regardless of stored state.
 *   - Persistence: per-group expanded / collapsed state survives navigation
 *     within the same browser tab via sessionStorage. New tab → no carry-over.
 *
 * sessionStorage shape (keyed per site so multi-blog admins don't collide):
 *
 *   wp-admin-sidebar:groups:<site_id> = { "plugins": true, ... }
 *
 * Reduced-motion respect is in CSS (chevron rotation animation suppressed
 * when prefers-reduced-motion: reduce).
 *
 * Contract reference: plan 04-interaction-spec.md.
 *
 * @package WP_Admin_Sidebar
 */

const STORAGE_PREFIX = 'wp-admin-sidebar:groups:';

/**
 * Wire the expand/collapse behaviour for every group container in the sidebar.
 *
 * @param {HTMLUListElement} sidebar
 * @param {Object} navModel
 * @param {{ currentUrl: string, siteId: number }} ctx
 */
export function applyExpandCollapse( sidebar, navModel, ctx ) {
	const stored = readStoredState( ctx.siteId );
	const autoExpandGroup = findAutoExpandGroup( navModel, ctx.currentUrl );

	const groups = sidebar.querySelectorAll( '.wp-admin-sidebar-group' );
	for ( const groupEl of groups ) {
		if ( ! ( groupEl instanceof HTMLElement ) ) {
			continue;
		}
		const groupId = groupEl.getAttribute( 'data-group' ) || '';
		const expanded = decideInitialState( groupId, stored, autoExpandGroup );
		applyState( groupEl, expanded );

		const toggle = groupEl.querySelector( '.wp-admin-sidebar-group__toggle' );
		if ( toggle instanceof HTMLButtonElement ) {
			toggle.addEventListener( 'click', () => {
				const next = ! ( groupEl.getAttribute( 'data-expanded' ) === 'true' );
				applyState( groupEl, next );
				stored[ groupId ] = next;
				writeStoredState( ctx.siteId, stored );
				notifyMenuHeightChanged();
			} );
		}
	}

	// Initial state above changes the menu height; tell wp-admin to recompute
	// position once after we settle (issue #43). Without this, if our auto-
	// expand runs after WP's adminmenu init, the sticky-menu position would
	// be off by the auto-expanded group's height.
	notifyMenuHeightChanged();
}

/**
 * Trigger wp-admin's sticky-menu recalculation. wp-admin/js/common.js's
 * setMenuPosition listens on window resize/scroll to keep the sidebar's
 * vertical position aligned with the visible menu range on long pages.
 * Toggling our group's data-expanded changes the menu height (the children
 * UL switches between max-height: 0 and max-height: none) but doesn't
 * fire either of those events on its own — so without this nudge the
 * sidebar stays positioned for the old height and a band of empty space
 * appears at the top.
 */
function notifyMenuHeightChanged() {
	if ( typeof window === 'undefined' ) {
		return;
	}
	window.dispatchEvent( new Event( 'resize' ) );
}

/**
 * Decide whether a group starts expanded.
 *
 *   - If it's the auto-expand group (current URL is one of its children),
 *     expand regardless of stored state.
 *   - Else, if storage records a state for it, follow that.
 *   - Else, default to collapsed.
 *
 * @param {string} groupId
 * @param {Record<string, boolean>} stored
 * @param {string|null} autoExpandGroup
 * @returns {boolean}
 */
function decideInitialState( groupId, stored, autoExpandGroup ) {
	if ( autoExpandGroup === groupId ) {
		return true;
	}
	if ( Object.prototype.hasOwnProperty.call( stored, groupId ) ) {
		return !! stored[ groupId ];
	}
	return false;
}

/**
 * Find the group whose children list contains the current URL's matching
 * item. Used for auto-expand.
 *
 * Match strategy: any child whose `menuSlug` substring shows up in the
 * current URL. That's a coarse match — fine for the common cases (edit.php
 * matches /wp-admin/edit.php, jetpack matches admin.php?page=jetpack) and
 * intentionally tolerant of query-string variations. We also try the
 * percent-decoded URL so WooCommerce-style slugs registered as
 * `wc-admin&path=/analytics/overview` still match when the browser URL
 * arrives as `path=%2Fanalytics%2Foverview`.
 *
 * @param {Object} navModel
 * @param {string} currentUrl
 * @returns {string|null}
 */
function findAutoExpandGroup( navModel, currentUrl ) {
	let decodedUrl = currentUrl;
	try {
		decodedUrl = decodeURIComponent( currentUrl );
	} catch ( e ) {
		// malformed encoding — keep decodedUrl = currentUrl and let the
		// raw-URL substring match still get its turn.
	}
	for ( const group of navModel.groups || [] ) {
		for ( const child of group.children || [] ) {
			if ( ! child.menuSlug ) continue;
			if ( currentUrl.includes( child.menuSlug ) || decodedUrl.includes( child.menuSlug ) ) {
				return group.id;
			}
		}
	}
	return null;
}

/**
 * Mutate the group container's data-expanded attribute and the toggle's
 * aria-expanded. CSS handles the visual response (chevron rotation, children
 * visibility).
 *
 * The children-UL also takes the `inert` attribute when collapsed so it's
 * removed from sequential focus and the accessibility tree. CSS alone
 * (`max-height: 0; overflow: hidden`) hides the descendants visually but
 * leaves the links focusable — keyboard users could tab into invisible
 * rows. `inert` is supported in Chrome 102+ / Firefox 112+ / Safari 15.5+.
 *
 * @param {HTMLElement} groupEl
 * @param {boolean} expanded
 */
function applyState( groupEl, expanded ) {
	groupEl.setAttribute( 'data-expanded', expanded ? 'true' : 'false' );
	const toggle = groupEl.querySelector( '.wp-admin-sidebar-group__toggle' );
	if ( toggle instanceof HTMLButtonElement ) {
		toggle.setAttribute( 'aria-expanded', expanded ? 'true' : 'false' );
	}
	const children = groupEl.querySelector( ':scope > .wp-admin-sidebar-group__children' );
	if ( children instanceof HTMLElement ) {
		if ( expanded ) {
			children.removeAttribute( 'inert' );
		} else {
			children.setAttribute( 'inert', '' );
		}
	}
}

/**
 * Read stored state for the current site. Returns an empty object on first
 * visit, on storage-disabled environments, or on any read failure.
 *
 * @param {number} siteId
 * @returns {Record<string, boolean>}
 */
function readStoredState( siteId ) {
	try {
		const raw = window.sessionStorage.getItem( STORAGE_PREFIX + siteId );
		if ( ! raw ) {
			return {};
		}
		const parsed = JSON.parse( raw );
		return parsed && typeof parsed === 'object' && ! Array.isArray( parsed ) ? parsed : {};
	} catch ( e ) {
		return {};
	}
}

/**
 * Persist stored state. Silent on failure (private-mode browsers, quota errors).
 *
 * @param {number} siteId
 * @param {Record<string, boolean>} state
 */
function writeStoredState( siteId, state ) {
	try {
		window.sessionStorage.setItem( STORAGE_PREFIX + siteId, JSON.stringify( state ) );
	} catch ( e ) {
		// Private mode or quota — fail silently. State will reset to defaults
		// on the next page load.
	}
}

// Exported for unit tests.
export { decideInitialState, findAutoExpandGroup, applyState };
