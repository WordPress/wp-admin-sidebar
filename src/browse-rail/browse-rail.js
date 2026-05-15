/**
 * Browse-rail entry point.
 *
 * Reads the inline `wpAdminSidebarData` payload emitted by the data planner,
 * wraps core's flat `<li>` items into group `<ul>` containers, attaches expand /
 * collapse state, renders signal data on group headers and item badges. All on
 * `DOMContentLoaded`.
 *
 * Bundle target: ≤ 12 KB gzipped (browse rail ships on every wp-admin page).
 *
 * Contract reference: plan 03-contracts.md § 2 (NavModel) and § 8 (group render shell).
 *
 * @package WP_Admin_Sidebar
 */

// Sub-modules are loaded dynamically so the entry-script cache-bust query
// (driven by the PHP enqueue's filemtime suffix) flows through to the
// imports as well. Without this, browsers cache the static imports
// independently from the entry and stale code lingers across deploys —
// painful in dev when there's no build pipeline yet. The dev-tools
// "Disable cache" toggle works too, but only when DevTools is open.

/**
 * @typedef {Object} NavItem
 * @property {string} itemId
 * @property {string} menuSlug
 * @property {string} title
 * @property {string} url
 * @property {Object} signal
 *
 * @typedef {Object} NavGroup
 * @property {string} id
 * @property {string} title
 * @property {NavItem[]} children
 * @property {Object} signal
 *
 * @typedef {Object} NavModel
 * @property {NavGroup[]} groups
 * @property {NavItem[]} top_level
 *
 * @typedef {Object} BrowseRailData
 * @property {NavModel} navModel
 * @property {Object|null} layoutDelta
 * @property {Object} meta
 */

const DATA_GLOBAL = 'wpAdminSidebarData';
const SIDEBAR_SELECTOR = '#adminmenu';

/**
 * Read the inline data global. Returns null if absent or malformed — the
 * browse rail no-ops in that case (data planner skipped emit because gating
 * denied the user, classifier ran on an empty $menu, etc.).
 *
 * @returns {BrowseRailData|null}
 */
function readData() {
	const raw = /** @type {*} */ ( window )[ DATA_GLOBAL ];
	if ( ! raw || typeof raw !== 'object' ) {
		return null;
	}
	const navModel = raw.navModel;
	if ( ! navModel || ! Array.isArray( navModel.groups ) || ! Array.isArray( navModel.top_level ) ) {
		return null;
	}
	return raw;
}

/**
 * Locate the wp-admin sidebar `<nav>` and return its `<ul id="adminmenu">`.
 * Returns null if the sidebar isn't on the page (login screens, customizer
 * iframes, etc.).
 *
 * @returns {HTMLUListElement|null}
 */
function findSidebar() {
	const el = document.querySelector( SIDEBAR_SELECTOR );
	return el instanceof HTMLUListElement ? el : null;
}

/**
 * Resolve the cache-bust suffix the PHP enqueue gave us. Without this,
 * dynamic imports of sibling modules would hit the browser cache.
 *
 * The entry script's URL looks like
 *   .../browse-rail.js?ver=0.1.0.<filemtime>
 * Pull the suffix off our own <script src> and pass it through.
 */
function resolveBust() {
	try {
		const url = new URL( import.meta.url );
		return url.searchParams.get( 'ver' ) || String( Date.now() );
	} catch ( e ) {
		return String( Date.now() );
	}
}

/**
 * Bootstrap the browse rail. Async because sub-modules load via dynamic
 * import (see header). Idempotent — DOMContentLoaded only fires once.
 */
export async function bootstrap() {
	const data = readData();
	if ( ! data ) {
		return;
	}
	const sidebar = findSidebar();
	if ( ! sidebar ) {
		return;
	}
	if ( sidebar.dataset.wpAdminSidebarReady === '1' ) {
		return;
	}

	const bust = resolveBust();
	const [ grouping, signal, expandCollapse, colorSchemePreview ] = await Promise.all( [
		import( `./grouping.js?ver=${ bust }` ),
		import( `./signal.js?ver=${ bust }` ),
		import( `./expand-collapse.js?ver=${ bust }` ),
		import( `./color-scheme-preview.js?ver=${ bust }` ),
	] );

	const { navModel, layoutDelta, meta } = data;

	// Phase 1: wrap classified items into group containers. Items not
	// classified (default_group: null) and post-`adminmenu` notices stay as
	// top-level siblings of the new group containers.
	grouping.wrapIntoGroups( sidebar, navModel, layoutDelta );

	// Phase 1.5: apply the saved layout delta on top of the wrapped sidebar.
	// Reassignable items already carry data-wp-admin-sidebar-item-id from the wrap pass,
	// so we can resolve each override to a real <li> and reposition it.
	// Stale overrides (itemId not in DOM) skip silently — see the function's
	// docblock for the stale-item-preservation contract.
	grouping.applyLayoutDelta( sidebar, layoutDelta );

	// Phase 2: render group-header signal (attention dot, count) and item
	// badges (numeric_badge, inline_text, inline_icon).
	signal.renderSignals( sidebar, navModel );

	// Phase 3: attach expand/collapse state. Groups default to collapsed
	// except the one containing the current URL (auto-expand). State persists
	// across same-tab navigations via sessionStorage; no cross-tab persistence.
	expandCollapse.applyExpandCollapse( sidebar, navModel, {
		currentUrl: window.location.pathname + window.location.search,
		siteId: meta && typeof meta.siteId === 'number' ? meta.siteId : 0,
	} );

	sidebar.dataset.wpAdminSidebarReady = '1';
	document.body.classList.add( 'wp-admin-sidebar-active' );

	// Live-preview the admin colour scheme on Profile / Edit User screens
	// so our per-scheme accent tokens follow the colour-picker preview
	// instead of staying stuck on the saved scheme. No-ops elsewhere.
	colorSchemePreview.applyColorSchemePreview();

	// Phase 4: customizer entry. Each group's customize button dynamically
	// loads the customizer chunk on first click; the customizer module owns
	// state, drag-drop, keyboard reorder, save/cancel.
	wireCustomizeButtons( sidebar, navModel, layoutDelta, meta, bust );
}

/**
 * Attach a click handler on each group's customize button that lazy-loads
 * the customizer chunk and enters customizer mode. The chunk is fetched
 * once and cached in module memory for subsequent enters.
 */
function wireCustomizeButtons( sidebar, navModel, layoutDelta, meta, bust ) {
	const buttons = sidebar.querySelectorAll( '.wp-admin-sidebar-group__customize' );
	if ( ! buttons.length ) {
		return;
	}
	let customizerModulePromise = null;
	let customizerCssLoaded = false;

	const ensureCss = () => {
		if ( customizerCssLoaded ) return;
		customizerCssLoaded = true;
		// Derive the customizer.css URL from the entry script's own URL (the
		// only stable anchor we have without a build step). browse-rail.js
		// lives at .../src/core/browse-rail/browse-rail.js — strip the basename
		// to get the directory, then jump up one level to ../customizer/.
		let cssUrl;
		try {
			const here = new URL( import.meta.url );
			cssUrl = new URL( `../customizer/customizer.css?ver=${ bust }`, here ).href;
		} catch ( _ ) {
			cssUrl = `../customizer/customizer.css?ver=${ bust }`;
		}
		const link = document.createElement( 'link' );
		link.rel = 'stylesheet';
		link.href = cssUrl;
		document.head.appendChild( link );
	};

	const ensureModule = () => {
		if ( ! customizerModulePromise ) {
			customizerModulePromise = import( `../customizer/customizer.js?ver=${ bust }` );
		}
		return customizerModulePromise;
	};

	for ( const button of buttons ) {
		// A.1 left these inert. The customizer hook makes them live.
		button.disabled = false;
		button.addEventListener( 'click', async ( ev ) => {
			ev.preventDefault();
			ev.stopPropagation();
			ensureCss();
			const mod = await ensureModule();
			const restRoot = ( meta && meta.restRoot ) || ( window.wpApiSettings && window.wpApiSettings.root ) || '/wp-json/';
			const restUrl = ( meta && meta.restUrl ) || '';
			const nonce = ( meta && meta.restNonce ) || ( window.wpApiSettings && window.wpApiSettings.nonce ) || '';
			// Read layoutDelta FRESH on each click. The closure-captured
			// `layoutDelta` from wireCustomizeButtons() is the page-load
			// snapshot; on Save, the customizer publishes the saved delta
			// back to `window.wpAdminSidebarData.layoutDelta`, so a
			// same-page Customize → Save → Customize sequence sees the
			// latest state without a reload. Falls back to the captured
			// value on environments without the data global (defensive).
			const liveDelta =
				( typeof window !== 'undefined' &&
					window.wpAdminSidebarData &&
					window.wpAdminSidebarData.layoutDelta ) ||
				layoutDelta;
			await mod.enterCustomizer( sidebar, navModel, liveDelta, {
				restRoot,
				restUrl,
				nonce,
				onExit() {
					button.focus();
				},
			} );
		} );
	}
}

if ( document.readyState === 'loading' ) {
	document.addEventListener( 'DOMContentLoaded', bootstrap, { once: true } );
} else {
	bootstrap();
}
