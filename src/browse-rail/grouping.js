/**
 * Grouping algorithm.
 *
 * Wraps core's flat `<li>` items into `<ul class="wp-admin-sidebar-group__children">`
 * containers, one per group present in the nav model. Items not classified
 * (default_group: null) and post-`adminmenu` notice items stay as top-level
 * siblings of the new group containers.
 *
 * The group render shell follows plan 03-contracts.md § 8: a non-interactive
 * <div> wrapper with two sibling buttons (toggle + optional customize). The
 * customize button only renders for the `plugins` group; the toggle button
 * carries the label, the signal, and the chevron.
 *
 * @package WP_Admin_Sidebar
 */

const CLASS_GROUP        = 'wp-admin-sidebar-group';
const CLASS_GROUP_HEADER = 'wp-admin-sidebar-group__header';
const CLASS_GROUP_TOGGLE = 'wp-admin-sidebar-group__toggle';
const CLASS_GROUP_LABEL  = 'wp-admin-sidebar-group__label';
const CLASS_GROUP_SIGNAL = 'wp-admin-sidebar-group__signal';
const CLASS_GROUP_CHEVRON = 'wp-admin-sidebar-group__chevron';
const CLASS_GROUP_CHILDREN = 'wp-admin-sidebar-group__children';
const CLASS_GROUP_CUSTOMIZE = 'wp-admin-sidebar-group__customize';

const ATTR_ITEM_ID    = 'data-wp-admin-sidebar-item-id';
const ATTR_MENU_SLUG  = 'data-wp-admin-sidebar-menu-slug';

/**
 * Map menuSlug → DOM `<li>` element. Each `<li>` is indexed under every slug
 * candidate we can derive from its id and `<a>` href so the lookup can survive
 * the various forms WordPress uses to identify menu items.
 *
 * Forms observed in the wild (verified on a JN site with WC + Yoast + Jetpack):
 *
 *   - `id="toplevel_page_<slug>"` for plugin-registered top-level menus.
 *     Plain plugins (Jetpack, Yoast, Woo) work via id stripping alone.
 *   - `id="menu-<area>"` for core areas (Dashboard, Posts, Pages, etc.).
 *   - `id="menu-posts-<post_type>"` for custom-post-type top-level entries
 *     (the WooCommerce Products menu uses this — registered as edit.php?post_type=product).
 *   - `<a href>` is sometimes relative (`edit.php?post_type=product`) and
 *     sometimes absolute (`/wp-admin/admin.php?page=jetpack` or with full host).
 *   - WooCommerce's complex slugs (e.g., Payments, Analytics) register the
 *     entire query-string-shaped slug as `$menu_slug`, so the registered slug
 *     looks like `wc-settings&tab=checkout&from=PAYMENTS_MENU_ITEM` —
 *     equal to whatever sits after `admin.php?page=` in the href.
 *
 * @param {HTMLUListElement} sidebar
 * @returns {Map<string, HTMLLIElement>}
 */
function indexCoreItems( sidebar ) {
	/** @type {Map<string, HTMLLIElement>} */
	const bySlug = new Map();
	const items = sidebar.querySelectorAll( ':scope > li.menu-top' );
	for ( const item of items ) {
		if ( ! ( item instanceof HTMLLIElement ) ) {
			continue;
		}
		for ( const slug of inferSlugCandidates( item ) ) {
			// First-write-wins: the order in inferSlugCandidates is from most
			// specific (id-derived) to most permissive (page= alone), so on
			// collision we keep the most specific match.
			if ( ! bySlug.has( slug ) ) {
				bySlug.set( slug, item );
			}
		}
	}
	return bySlug;
}

/**
 * Derive every plausible slug for a top-level `<li>`. We over-generate
 * candidates so the lookup against the model's `menuSlug` succeeds regardless
 * of which form the registering plugin used.
 *
 * @param {HTMLLIElement} item
 * @returns {string[]}
 */
function inferSlugCandidates( item ) {
	const slugs = new Set();
	const id = item.id || '';

	// Plain plugin top-level: toplevel_page_<slug>.
	if ( id.startsWith( 'toplevel_page_' ) ) {
		slugs.add( id.substring( 'toplevel_page_'.length ) );
	}

	// Core post-type and CPT pattern: menu-posts → edit.php; menu-posts-X → edit.php?post_type=X.
	if ( id === 'menu-posts' ) {
		slugs.add( 'edit.php' );
	} else {
		const cpt = id.match( /^menu-posts-(.+)$/ );
		if ( cpt ) {
			slugs.add( 'edit.php?post_type=' + cpt[ 1 ] );
		}
	}

	const link = item.querySelector( ':scope > a' );
	if ( link instanceof HTMLAnchorElement ) {
		for ( const candidate of slugCandidatesFromHref( link.getAttribute( 'href' ) || '' ) ) {
			slugs.add( candidate );
		}
	}

	return [ ...slugs ];
}

/**
 * Generate slug candidates from an `<a>` href. The href may be:
 *
 *   - relative: `edit.php?post_type=product`
 *   - absolute: `/wp-admin/admin.php?page=jetpack`
 *   - fully-qualified: `https://site.test/wp-admin/admin.php?page=foo&tab=bar`
 *
 * Returns up to four candidates so the lookup survives whichever form the
 * registering plugin used as `$menu_slug`.
 *
 * @param {string} href
 * @returns {string[]}
 */
function slugCandidatesFromHref( href ) {
	if ( ! href ) {
		return [];
	}
	const out = [];

	// 1. The `?page=<X>` short form (clean plugin slugs like 'jetpack',
	// 'wpseo_dashboard'). This is the most common case so it leads.
	const pageShort = href.match( /[?&]page=([^&#]+)/ );
	if ( pageShort ) {
		try {
			out.push( decodeURIComponent( pageShort[ 1 ] ) );
		} catch ( e ) {
			out.push( pageShort[ 1 ] );
		}
	}

	// Strip protocol+host and any leading `/wp-admin/`. What remains mirrors
	// how `$menu_item[2]` looks for items registered with file-shaped slugs
	// (edit.php, edit-comments.php, edit.php?post_type=product, …).
	let stripped = href.replace( /^https?:\/\/[^/]+/, '' ).replace( /^\/?wp-admin\//, '' );
	if ( stripped && ! stripped.startsWith( '#' ) ) {
		// 2. The full content after `admin.php?page=` — covers WooCommerce-style
		// slugs registered as `wc-settings&tab=…&from=…` (Payments, Analytics).
		const pageFull = stripped.match( /^admin\.php\?page=(.+)$/ );
		if ( pageFull ) {
			out.push( pageFull[ 1 ] );
			try {
				const decoded = decodeURIComponent( pageFull[ 1 ] );
				if ( decoded !== pageFull[ 1 ] ) {
					out.push( decoded );
				}
			} catch ( e ) {
				// Malformed URI; ignore.
			}
		}

		// 3. The full admin-relative form — covers file slugs (edit.php,
		// edit.php?post_type=product) and any registration that didn't fit the
		// patterns above.
		out.push( stripped );
		try {
			const decoded = decodeURIComponent( stripped );
			if ( decoded !== stripped ) {
				out.push( decoded );
			}
		} catch ( e ) {
			// Malformed URI; ignore.
		}
	}

	return out;
}

/**
 * Back-compat shim: returns the single primary slug for a `<li>`. Kept for
 * tests that exercise the legacy single-key path; new code uses
 * `inferSlugCandidates` and the multi-key index above.
 *
 * @param {HTMLLIElement} item
 * @returns {string|null}
 */
function inferSlug( item ) {
	const candidates = inferSlugCandidates( item );
	return candidates.length > 0 ? candidates[ 0 ] : null;
}

/**
 * Back-compat shim for the old single-result helper.
 *
 * @param {string} href
 * @returns {string|null}
 */
function slugFromHref( href ) {
	const candidates = slugCandidatesFromHref( href );
	return candidates.length > 0 ? candidates[ 0 ] : null;
}

/**
 * Build the group container for a given NavGroup. The container is a sibling
 * of core's `<li>` items (it lives inside `<ul id="adminmenu">`), shaped per
 * the contract in plan 03-contracts.md § 8.
 *
 * @param {Object} group         NavGroup from the nav model.
 * @param {boolean} customizable Whether to render the customize entry button.
 * @returns {HTMLLIElement}
 */
function buildGroupContainer( group, customizable ) {
	const li = document.createElement( 'li' );
	li.classList.add( CLASS_GROUP, 'menu-top' );
	li.setAttribute( 'data-group', group.id );
	li.setAttribute( 'data-expanded', 'false' );

	const header = document.createElement( 'div' );
	header.classList.add( CLASS_GROUP_HEADER );

	const childrenId = `wp-admin-sidebar-group-${ group.id }`;

	const toggle = document.createElement( 'button' );
	toggle.type = 'button';
	toggle.classList.add( CLASS_GROUP_TOGGLE );
	toggle.setAttribute( 'aria-expanded', 'false' );
	toggle.setAttribute( 'aria-controls', childrenId );

	const label = document.createElement( 'span' );
	label.classList.add( CLASS_GROUP_LABEL );
	label.textContent = group.title || group.id;
	toggle.appendChild( label );

	const signalSpan = document.createElement( 'span' );
	signalSpan.classList.add( CLASS_GROUP_SIGNAL );
	toggle.appendChild( signalSpan );

	const chevron = document.createElement( 'span' );
	chevron.classList.add( CLASS_GROUP_CHEVRON );
	chevron.setAttribute( 'aria-hidden', 'true' );
	toggle.appendChild( chevron );

	header.appendChild( toggle );

	if ( customizable ) {
		const customize = document.createElement( 'button' );
		customize.type = 'button';
		customize.classList.add( CLASS_GROUP_CUSTOMIZE );
		// Translators: aria-label for the plugins-group customize button.
		// The customize button only renders for the `plugins` group (see
		// `customizable = group.id === 'plugins'` below), so "Customize plugins"
		// is accurate. `data-tooltip` mirrors the same string and is surfaced
		// visually by the CSS pseudo-element on hover/focus (see styles.css).
		customize.setAttribute( 'aria-label', 'Customize plugins' );
		customize.setAttribute( 'data-tooltip', 'Customize plugins' );
		// A.2 wires the click handler. In A.1 the button renders but is inert.
		customize.disabled = true;
		header.appendChild( customize );
	}

	const childrenUl = document.createElement( 'ul' );
	childrenUl.id = childrenId;
	childrenUl.classList.add( CLASS_GROUP_CHILDREN );

	li.appendChild( header );
	li.appendChild( childrenUl );
	return li;
}

/**
 * Wrap classified items into group containers per the nav model. Mutates the
 * sidebar in place. Items not in any group's children list (post-`adminmenu`
 * notices, unclassified items) stay as siblings.
 *
 * Returns a record describing what was wrapped, useful for tests and for
 * downstream renderers (signal, expand-collapse).
 *
 * The third argument is unused at wrap time; saved layout overrides apply via
 * `applyLayoutDelta` immediately after wrapping. Kept on the signature for
 * call-site stability so the tests in __tests__/grouping.test.js don't churn.
 *
 * @param {HTMLUListElement} sidebar
 * @param {Object} navModel
 * @param {Object|null} _layoutDelta  Unused; see applyLayoutDelta.
 * @returns {{ groups: Array<{ id: string, container: HTMLLIElement, items: HTMLLIElement[] }> }}
 */
export function wrapIntoGroups( sidebar, navModel, _layoutDelta ) {
	const indexedItems = indexCoreItems( sidebar );

	/** @type {Array<{ id: string, container: HTMLLIElement, items: HTMLLIElement[] }>} */
	const wrapped = [];

	for ( const group of navModel.groups || [] ) {
		const customizable = group.id === 'plugins';
		const container    = buildGroupContainer( group, customizable );
		/** @type {HTMLLIElement[]} */
		const moved        = [];

		// Find DOM items for each child in the group, move them into the
		// container's <ul>. Items that don't resolve in DOM (capability mismatch,
		// hide-if-js, plugin deactivated since the page rendered) are skipped
		// silently — the saved layout entry stays in storage per stale-item
		// preservation in plan 03-contracts.md § 3.
		for ( const child of group.children || [] ) {
			const li = indexedItems.get( child.menuSlug );
			if ( ! li ) {
				continue;
			}
			// Tag with the compound itemId + menu slug so the customizer client
			// can correlate DOM nodes with the nav model.
			li.setAttribute( ATTR_ITEM_ID, child.itemId );
			li.setAttribute( ATTR_MENU_SLUG, child.menuSlug );
			container.querySelector( `.${ CLASS_GROUP_CHILDREN }` )?.appendChild( li );
			moved.push( li );
		}

		// Only insert the group container if at least one item moved. An empty
		// group container with no children is visually noise.
		if ( moved.length === 0 ) {
			continue;
		}

		// Insert the container at the bottom of the sidebar. Top-level (flat)
		// items stay where core put them; the group sinks below them.
		sidebar.appendChild( container );
		wrapped.push( {
			id: group.id,
			container,
			items: moved,
		} );
	}

	return { groups: wrapped };
}

/**
 * Apply a saved LayoutDelta on top of the wrapped sidebar. Each override
 * relocates the matching <li> to the position the delta specifies. Stale
 * overrides — itemIds that aren't present in the current DOM (deactivated
 * plugin, capability removed, etc.) — are silently skipped per plan
 * 03-contracts.md § 3 stale-item-preservation: the storage record is left
 * untouched so the position re-applies automatically when the missing item
 * returns.
 *
 * Must run after `wrapIntoGroups` so reassignable items already carry
 * `data-wp-admin-sidebar-item-id` and group containers exist for `in_group` targets.
 *
 * Multi-override collisions are handled in delta-list order: later overrides
 * displace earlier siblings in the same container, which matches the contract
 * convention that the client emits the working delta in order of
 * user-intended placement.
 *
 * @param {HTMLUListElement} sidebar
 * @param {Object|null} layoutDelta
 * @returns {{ applied: number, skipped: number }}
 */
export function applyLayoutDelta( sidebar, layoutDelta ) {
	if ( ! layoutDelta || ! Array.isArray( layoutDelta.overrides ) || layoutDelta.overrides.length === 0 ) {
		return { applied: 0, skipped: 0 };
	}

	let applied = 0;
	let skipped = 0;

	for ( const override of layoutDelta.overrides ) {
		if ( ! override || typeof override !== 'object' || ! override.itemId || ! override.position ) {
			++skipped;
			continue;
		}

		const li = findItemById( sidebar, override.itemId );
		if ( ! li ) {
			++skipped;
			continue;
		}

		const target = resolveTargetContainer( sidebar, override.position );
		if ( ! target ) {
			++skipped;
			continue;
		}

		// Collect siblings the override should land amongst, excluding the
		// source row itself if it already lives in this container. Index is
		// clamped against the resulting length so out-of-range deltas land at
		// the end rather than no-op.
		const siblings = Array.from( target.children ).filter(
			( el ) => el.tagName === 'LI' && el !== li
		);
		const requested = Number.isFinite( override.position.index ) ? Math.floor( override.position.index ) : 0;
		const idx = Math.max( 0, Math.min( requested, siblings.length ) );

		if ( idx >= siblings.length ) {
			target.appendChild( li );
		} else {
			target.insertBefore( li, siblings[ idx ] );
		}
		++applied;
	}

	return { applied, skipped };
}

/**
 * Linear scan for a <li> by its compound itemId. Faster than `[attr="..."]`
 * selector in this scope because we have at most ~10 tagged items, and it
 * dodges escape concerns when the itemId contains characters CSS treats as
 * meta (the WC Payments-style id, for example).
 */
function findItemById( sidebar, itemId ) {
	const items = sidebar.querySelectorAll( 'li[data-wp-admin-sidebar-item-id]' );
	for ( const li of items ) {
		if ( li.getAttribute( 'data-wp-admin-sidebar-item-id' ) === itemId ) {
			return li;
		}
	}
	return null;
}

function resolveTargetContainer( sidebar, position ) {
	if ( ! position || typeof position !== 'object' ) {
		return null;
	}
	if ( position.kind === 'top_level' ) {
		return sidebar;
	}
	if ( position.kind === 'in_group' ) {
		const groupId = position.group_id;
		if ( ! groupId || typeof groupId !== 'string' ) {
			return null;
		}
		const groups = sidebar.querySelectorAll( '.wp-admin-sidebar-group' );
		for ( const group of groups ) {
			if ( group.getAttribute( 'data-group' ) === groupId ) {
				return group.querySelector( ':scope > .wp-admin-sidebar-group__children' );
			}
		}
		return null;
	}
	return null;
}

// Exported for unit tests.
export { slugFromHref, inferSlug, slugCandidatesFromHref, inferSlugCandidates };
