/**
 * Signal rendering.
 *
 * Two surfaces:
 *
 *   1. Group-header signal — attention dot only (per Lucas's Figma 3505:76964
 *      the design is dot-only; the count is conveyed via the dot's aria-label
 *      for assistive tech). Rendered inside the group toggle button so screen
 *      readers announce it via the button's accessible name. Visible only
 *      when the group is collapsed (dot hides once the user has the items
 *      in view).
 *
 *   2. Item-level signal — numeric badge ("2" next to WooCommerce), inline
 *      text ("BETA"), inline icon (dashicons-warning). Plain spans appended to
 *      the item's <a> link. Core-emitted signal markup (`.awaiting-mod`,
 *      `.update-plugins`, `.menu-counter`) inside the moved <li> is stripped
 *      first so the redesign owns the visual treatment without double-painting
 *      — `Sidebar_Signals::extract_raw()` in PHP already captured the data
 *      into the nav model.
 *
 * The nav model already carries the merged ItemSignal / GroupSignal shape;
 * this module just turns the data into DOM.
 *
 * Contract reference: plan 03-contracts.md § 5.
 *
 * @package WP_Admin_Sidebar
 */

const CLASS_GROUP_SIGNAL = 'wp-admin-sidebar-group__signal';
const CLASS_ITEM_BADGE   = 'wp-admin-sidebar-item__badge';
const CLASS_ITEM_INLINE_TEXT = 'wp-admin-sidebar-item__inline-text';
const CLASS_ITEM_INLINE_ICON = 'wp-admin-sidebar-item__inline-icon';

const SELECTOR_GROUP_TOGGLE = '.wp-admin-sidebar-group__toggle';

/**
 * Render group-level + item-level signal into the wrapped DOM.
 *
 * @param {HTMLUListElement} sidebar
 * @param {Object} navModel
 */
export function renderSignals( sidebar, navModel ) {
	for ( const group of navModel.groups || [] ) {
		renderGroupSignal( sidebar, group );
		for ( const child of group.children || [] ) {
			renderItemSignal( sidebar, child );
		}
	}
	for ( const item of navModel.top_level || [] ) {
		renderItemSignal( sidebar, item );
	}
}

/**
 * Render the group attention dot and count inside the group toggle button's
 * `.wp-admin-sidebar-group__signal` span.
 *
 * @param {HTMLUListElement} sidebar
 * @param {Object} group
 */
function renderGroupSignal( sidebar, group ) {
	const container = sidebar.querySelector( `.wp-admin-sidebar-group[data-group="${ cssEscape( group.id ) }"]` );
	if ( ! container ) {
		return;
	}
	const span = container.querySelector( `.${ CLASS_GROUP_SIGNAL }` );
	if ( ! span ) {
		return;
	}

	const sig = group.signal || {};
	const attention = !! sig.attention;
	const count     = typeof sig.count === 'number' && sig.count > 0 ? sig.count : 0;

	if ( ! attention && count === 0 ) {
		span.removeAttribute( 'data-attention' );
		span.removeAttribute( 'aria-label' );
		return;
	}

	span.setAttribute( 'data-attention', 'true' );
	if ( count > 0 ) {
		// Translators: aria label uses the count; runtime localisation comes from PHP later.
		span.setAttribute( 'aria-label', `${ count } items need attention` );
	} else {
		span.setAttribute( 'aria-label', 'Items need attention' );
	}
}

/**
 * Render item-level signal (numeric_badge / count / badge, inline_text,
 * inline_icon) into the item's `<a>` link.
 *
 * Badge text is chosen by priority — first non-empty wins:
 *
 *   1. numeric_badge — primary indicator for plugin items (Sensei, WooCommerce
 *      pending counts, etc.) carried via awaiting-mod with a digit text.
 *   2. count         — wp-admin's count-N span pattern (update-plugins,
 *      menu-counter). Items can fire attention solely via this field
 *      (Payments, Yoast SEO, WooCommerce updates …); without rendering it
 *      here, the group's aggregate dot fires but no child shows where the
 *      attention is coming from (issue #39).
 *   3. badge         — non-empty awaiting-mod text that didn't parse as a
 *      digit. Rare in the wild but still triggers attention in PHP
 *      Sidebar_Signals::map_to_nav, so render it for parity.
 *
 * @param {HTMLUListElement} sidebar
 * @param {Object} item
 */
function renderItemSignal( sidebar, item ) {
	const li = sidebar.querySelector( `[data-wp-admin-sidebar-item-id="${ cssEscape( item.itemId ) }"]` );
	if ( ! ( li instanceof HTMLElement ) ) {
		return;
	}
	const link = li.querySelector( ':scope > a' );
	if ( ! link ) {
		return;
	}

	// Append badges/icons inside `.wp-menu-name` (the label container), not
	// directly under `<a>`. wp-admin's `.wp-menu-name` is the inline-flow
	// element that already houses native badges like the "Updates 3" pill;
	// putting our spans there keeps them on the same line as the label text.
	// As a sibling of `.wp-menu-name` they would land on a second line in
	// normal sidebar mode (where `.wp-menu-name` is display: block with
	// padding-left for the icon column).
	const target = link.querySelector( ':scope > .wp-menu-name' ) || link;

	// Strip core-emitted signal spans before painting our own. The signal
	// data was extracted into the nav model in PHP (Sidebar_Signals); leaving
	// core's markup in place would double-paint the badge / count next to
	// our own span on items that ship with one of these patterns (WooCommerce
	// pending counts, plugin-update counters, comment-moderation counts).
	// Selectors match what extract_raw() reads from.
	target.querySelectorAll( '.awaiting-mod, .update-plugins, .menu-counter' ).forEach( ( el ) => el.remove() );
	const sig = item.signal || {};

	let badgeText = null;
	if ( typeof sig.numeric_badge === 'number' && sig.numeric_badge > 0 ) {
		badgeText = String( sig.numeric_badge );
	} else if ( typeof sig.count === 'number' && sig.count > 0 ) {
		badgeText = String( sig.count );
	} else if ( typeof sig.badge === 'string' && sig.badge.length > 0 ) {
		badgeText = sig.badge;
	}
	if ( badgeText !== null ) {
		ensureBadge( target, CLASS_ITEM_BADGE, badgeText );
	}

	if ( typeof sig.inline_text === 'string' && sig.inline_text.length > 0 ) {
		ensureBadge( target, CLASS_ITEM_INLINE_TEXT, sig.inline_text );
	}
	if ( typeof sig.inline_icon === 'string' && sig.inline_icon.length > 0 ) {
		ensureIcon( target, CLASS_ITEM_INLINE_ICON, sig.inline_icon );
	}
}

/**
 * Idempotent badge insert. Re-rendering is a no-op (we replace text content,
 * never duplicate the span).
 *
 * @param {Element} link
 * @param {string}  className
 * @param {string}  text
 */
function ensureBadge( link, className, text ) {
	let span = link.querySelector( `.${ className }` );
	if ( ! span ) {
		span = document.createElement( 'span' );
		span.classList.add( className );
		link.appendChild( span );
	}
	span.textContent = text;
}

/**
 * Idempotent dashicon insert. The icon span is empty and styled via CSS;
 * the dashicon class is what renders the glyph.
 *
 * @param {Element} link
 * @param {string}  className
 * @param {string}  dashicon Dashicon slug, e.g. 'dashicons-warning'.
 */
function ensureIcon( link, className, dashicon ) {
	let span = link.querySelector( `.${ className }` );
	if ( ! span ) {
		span = document.createElement( 'span' );
		span.classList.add( className, 'dashicons', dashicon );
		span.setAttribute( 'aria-hidden', 'true' );
		link.appendChild( span );
		return;
	}
	// Rotate the dashicon class on re-render.
	for ( const cls of Array.from( span.classList ) ) {
		if ( cls.startsWith( 'dashicons-' ) && cls !== 'dashicons' ) {
			span.classList.remove( cls );
		}
	}
	span.classList.add( dashicon );
}

/**
 * Minimal CSS.escape polyfill for environments that don't ship it (jsdom < 16).
 * Only handles the characters that show up in our itemIds (`:`, `/`, `.`, `-`).
 *
 * @param {string} s
 * @returns {string}
 */
function cssEscape( s ) {
	if ( typeof CSS !== 'undefined' && typeof CSS.escape === 'function' ) {
		return CSS.escape( s );
	}
	return s.replace( /([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1' );
}
