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
 * Render item-level signal (numeric_badge, inline_text, inline_icon) into the
 * item's `<a>` link. count is intentionally not rendered at item level when
 * grouped — group aggregation absorbs it; the individual item shows badge /
 * inline text / inline icon only.
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
	// Strip core-emitted signal spans before painting our own. The signal
	// data was extracted into the nav model in PHP (Sidebar_Signals); leaving
	// core's markup in place would double-paint the badge / count next to
	// our own span on items that ship with one of these patterns (WooCommerce
	// pending counts, plugin-update counters, comment-moderation counts).
	// Selectors match what extract_raw() reads from.
	link.querySelectorAll( '.awaiting-mod, .update-plugins, .menu-counter' ).forEach( ( el ) => el.remove() );
	const sig = item.signal || {};

	// Numeric badge — primary signal for plugin items (Sensei, WooCommerce
	// pending counts, etc.). Renders even when the group is collapsed since
	// the item itself isn't visible in that state, so we layer the badge into
	// the group-header signal too at aggregation time.
	const numericBadge = typeof sig.numeric_badge === 'number' && sig.numeric_badge > 0
		? sig.numeric_badge
		: null;
	if ( numericBadge !== null ) {
		ensureBadge( link, CLASS_ITEM_BADGE, String( numericBadge ) );
	}

	if ( typeof sig.inline_text === 'string' && sig.inline_text.length > 0 ) {
		ensureBadge( link, CLASS_ITEM_INLINE_TEXT, sig.inline_text );
	}
	if ( typeof sig.inline_icon === 'string' && sig.inline_icon.length > 0 ) {
		ensureIcon( link, CLASS_ITEM_INLINE_ICON, sig.inline_icon );
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
