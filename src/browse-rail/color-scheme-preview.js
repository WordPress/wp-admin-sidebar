/**
 * Adopt wp-admin's native colour scheme accent at runtime — saved and
 * during live preview.
 *
 * The redesigned sidebar's accent (group label, customize icon, chevron,
 * focus rings, customizer buttons, drag indicator) should match whichever admin
 * colour scheme the user has active, including third-party schemes
 * registered via `wp_admin_css_color()`. Hard-coding per-scheme hex
 * values in our CSS would duplicate the values WP already ships in
 * `wp-admin/css/colors/<scheme>/colors.min.css` and would silently
 * mismatch for any scheme we hadn't enumerated.
 *
 * Strategy: extract the accent from a wp-admin native element that's
 * painted per-scheme — specifically `.button-primary`'s `background-
 * color`, which is the canonical "scheme highlight" wp-admin uses for
 * primary buttons, sidebar current-item background, and link colours.
 * Write that into two CSS custom properties on `:root`:
 *
 *   --wp-admin-sidebar-group-label-fg
 *   --wp-admin-sidebar-customizer-theme
 *
 * Our `styles.css` defines those tokens with Fresh-scheme defaults; the
 * runtime probe overrides them once we know the actual current value.
 *
 * Preview support: the Profile screen's colour-picker swaps the
 * `<link id="colors-css">` href when the user clicks any scheme
 * option (radio click, label click, swatch click — all funnel through
 * the same href swap). A `MutationObserver` on that link's `href`
 * attribute catches every variant. We re-probe after the new stylesheet's
 * `load` event when it fires, with a short timeout fallback for cached
 * stylesheets, so the tokens update regardless of which DOM target the
 * user clicked.
 *
 * Listening to the radios' `change` event alone (an earlier attempt)
 * was unreliable because WP's `color-picker.js` sets `radio.prop(
 * 'checked', true )` from a `.color-option` click handler, and a
 * programmatic `prop()` does NOT fire `change` in jQuery. Watching the
 * stylesheet swap is the single trigger that catches every path.
 *
 * @package WP_Admin_Sidebar
 */

const TOKEN_GROUP_LABEL = '--wp-admin-sidebar-group-label-fg';
const TOKEN_CUSTOMIZER  = '--wp-admin-sidebar-customizer-theme';
const COLORS_LINK_ID    = 'colors-css';
const SYNC_FALLBACK_DELAYS = [ 100, 500, 1000 ];

/**
 * Wire scheme accent extraction and live-preview tracking.
 *
 * Safe to call on any admin page; no-ops cleanly when `.button-primary`
 * or `#colors-css` aren't available.
 */
export function applyColorSchemePreview() {
	syncAccentFromNative();

	const colorsLink = document.getElementById( COLORS_LINK_ID );
	if ( ! ( colorsLink instanceof HTMLLinkElement ) ) {
		return;
	}

	// Watch the colour-picker's href swap. `load` covers uncached stylesheets
	// when it fires; delayed fallbacks cover cached swaps and missed load
	// events. All paths are idempotent.
	const observer = new MutationObserver( () => syncAccentAfterStylesheetSwap( colorsLink ) );
	observer.observe( colorsLink, { attributes: true, attributeFilter: [ 'href' ] } );
}

/**
 * Schedule accent re-syncs after a colour stylesheet href swap.
 *
 * @param {HTMLLinkElement} colorsLink
 */
function syncAccentAfterStylesheetSwap( colorsLink ) {
	colorsLink.addEventListener( 'load', syncAccentFromNative, { once: true } );
	SYNC_FALLBACK_DELAYS.forEach( ( delay ) => setTimeout( syncAccentFromNative, delay ) );
}

/**
 * Read wp-admin's current scheme accent from `.button-primary` and
 * write it into our two accent tokens on `:root`.
 *
 * Uses a hidden probe button so we don't depend on a `.button-primary`
 * being on the page (it isn't, on most admin screens). The probe is
 * inserted, measured, and removed synchronously — no layout impact.
 */
function syncAccentFromNative() {
	const probe = document.createElement( 'button' );
	probe.type = 'button';
	probe.className = 'button button-primary';
	probe.tabIndex = -1;
	probe.setAttribute( 'aria-hidden', 'true' );
	probe.style.position = 'fixed';
	probe.style.left = '-9999px';
	probe.style.top = '-9999px';
	probe.style.pointerEvents = 'none';
	probe.style.visibility = 'hidden';
	document.body.appendChild( probe );
	const accent = window.getComputedStyle( probe ).backgroundColor;
	probe.remove();

	if ( ! accent || accent === 'rgba(0, 0, 0, 0)' || accent === 'transparent' ) {
		return;
	}
	document.documentElement.style.setProperty( TOKEN_GROUP_LABEL, accent );
	document.documentElement.style.setProperty( TOKEN_CUSTOMIZER, accent );
}
