/**
 * Adopt wp-admin's native colour scheme accent at runtime — saved and
 * during live preview.
 *
 * The redesigned sidebar's accent (group label, customize icon, chevron,
 * focus rings, Save button, drag indicator) should match whichever admin
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
 * attribute catches every variant. After the new stylesheet's `load`
 * event fires we re-probe and update the tokens — works regardless of
 * which DOM target the user clicked.
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

	// Watch the colour-picker's href swap and re-sync after the browser
	// has had a chance to apply the new stylesheet. A small setTimeout
	// is more reliable than `link.load` because `load` doesn't fire on
	// the link element when the swapped-in stylesheet is already in the
	// HTTP cache (a common case once the user has previewed a scheme
	// once). The resync is idempotent — runs more often than strictly
	// needed in fast-path cases, but writes the same value either way.
	const observer = new MutationObserver( () => {
		setTimeout( syncAccentFromNative, 100 );
	} );
	observer.observe( colorsLink, { attributes: true, attributeFilter: [ 'href' ] } );
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
