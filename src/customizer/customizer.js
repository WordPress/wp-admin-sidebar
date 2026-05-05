/**
 * Customizer entry point.
 *
 * Loaded lazily by browse-rail.js when the user clicks the per-group customize
 * button. Bootstraps draft state, decorates reassignable items with grip
 * handles + 3-dot triggers, attaches drag-drop + keyboard reorder + move-menu,
 * and renders Cancel / Save controls. On save POSTs the working delta and
 * exits; on cancel discards and exits.
 *
 * The body class `wp-admin-sidebar-mode-customize` is the CSS scope for
 * customizer-only styling; the entry / exit dance toggles it on `<body>`.
 *
 * Contract reference: plan 03-contracts.md § 4 (REST surface), § 7 (draft
 * state), § 8 (DOM shape during customizer mode).
 */

// Sub-modules load via dynamic import so the cache-bust suffix that the entry
// loaded with (read off `import.meta.url`) flows through to siblings. Static
// imports cache independently from the entry — the same browse-rail issue we
// hit during A.1 dev iterations. See plan jn-setup.md "Dev-iteration
// cache-bust patterns".

const BODY_MODE_CLASS = 'wp-admin-sidebar-mode-customize';
const REASSIGNABLE_CLASS = 'wp-admin-sidebar-item--reassignable';
const GRIP_CLASS = 'wp-admin-sidebar-item__grip';
const FOOTER_CLASS = 'wp-admin-sidebar-customize-footer';
const ANNOUNCE_ID = 'wp-admin-sidebar-customize-live';

let active = null; // { state, detachFns, footerEl, liveEl, beforeunloadHandler }

/**
 * Resolve the cache-bust suffix from the entry's own URL so dynamic imports
 * see the same `?ver=` the entry loaded with. Fall back to a timestamp on
 * exotic environments without `import.meta.url`.
 */
function resolveBust() {
	try {
		const url = new URL( import.meta.url );
		return url.searchParams.get( 'ver' ) || String( Date.now() );
	} catch ( _ ) {
		return String( Date.now() );
	}
}

/**
 * Public entry point.
 *
 * @param {HTMLElement} sidebar  The #adminmenu element.
 * @param {Object} navModel
 * @param {Object|null} savedDelta  Saved layout delta from the inline payload.
 * @param {Object} options          { restRoot, restUrl, nonce, onExit }
 *   - `restUrl` is the fully-resolved layout endpoint (preferred); save()
 *     uses it directly. Hosts that route REST through a centralized
 *     public-api dispatcher set this to their own endpoint; plain WP
 *     leaves it pointing at the same-origin /wp-json/ route. Newer inline
 *     payloads always emit it.
 *   - `restRoot` is the legacy fallback for inline payloads that didn't
 *     include `restUrl`. Save concatenates the core route on it.
 *   - `nonce` is the wp_rest cookie nonce for the POST.
 *   - `onExit` (optional) fires when the customizer closes (Save, Cancel,
 *     or programmatic exit). Used by browse-rail.js to refocus the
 *     triggering customize button.
 */
export async function enterCustomizer( sidebar, navModel, savedDelta, options ) {
	if ( active ) {
		return;
	}

	const bust = resolveBust();
	const [ draftState, dragDrop, keyboardReorder, moveMenu ] = await Promise.all( [
		import( `./draft-state.js?ver=${ bust }` ),
		import( `./drag-drop.js?ver=${ bust }` ),
		import( `./keyboard-reorder.js?ver=${ bust }` ),
		import( `./move-menu.js?ver=${ bust }` ),
	] );
	const { createState, moveItem, resetItem, beginDrag, endDrag, applySaved, cloneDelta } = draftState;
	const { attachDragDrop } = dragDrop;
	const { attachKeyboardReorder } = keyboardReorder;
	const { attachMoveMenu } = moveMenu;

	// Stash the helpers used by save() (which is module-scope so it can keep
	// access across exit/re-enter cycles) on the active record.
	const helpers = { applySaved, cloneDelta };

	const state = createState( navModel, savedDelta );
	const liveEl = createLiveRegion();
	// Snapshot the DOM order of every reassignable LI BEFORE any
	// decoration runs. Drag-drop / keyboard / menu moves mutate the live
	// DOM during the customize session, but Cancel only drops the working
	// delta — without restoring the snapshot, unsaved DOM moves stay
	// visible until reload. See exitCustomizer().
	const layoutSnapshot = captureLayoutSnapshot( sidebar );
	document.body.classList.add( BODY_MODE_CLASS );

	decorateReassignableItems( sidebar, navModel );
	const restoreGroupState = expandGroupsForCustomizing( sidebar );

	const controller = {
		commitMove( itemId, position ) {
			active.state = moveItem( active.state, itemId, position );
			updateFooter();
		},
		resetItem( itemId ) {
			active.state = resetItem( active.state, itemId );
			updateFooter();
		},
		beginDrag( itemId, sourcePosition ) {
			active.state = beginDrag( active.state, itemId, sourcePosition );
		},
		exitDrag() {
			active.state = endDrag( active.state );
		},
		announce( msg ) {
			liveEl.textContent = '';
			// rAF to force the SR to re-read identical strings.
			requestAnimationFrame( () => {
				liveEl.textContent = msg;
			} );
		},
	};

	const detachDrag = attachDragDrop( sidebar, controller );
	const detachKeyboard = attachKeyboardReorder( sidebar, controller );
	const detachMenu = attachMoveMenu( sidebar, navModel, controller );
	const detachLinkSuppress = suppressReassignableLinkClicks( sidebar );

	const footerEl = renderFooter( sidebar, async function onSave() {
		await save( options );
	}, function onCancel() {
		exitCustomizer( { confirmIfDirty: true } );
	} );

	const beforeunloadHandler = ( ev ) => {
		if ( active && active.state.isDirty ) {
			ev.preventDefault();
			ev.returnValue = '';
			return '';
		}
	};
	window.addEventListener( 'beforeunload', beforeunloadHandler );

	active = {
		state,
		detachFns: [ detachDrag, detachKeyboard, detachMenu, detachLinkSuppress ],
		footerEl,
		liveEl,
		beforeunloadHandler,
		restoreGroupState,
		layoutSnapshot,
		helpers,
		onExit: options && typeof options.onExit === 'function' ? options.onExit : null,
		options,
	};
	updateFooter();
}

/**
 * Exit the customizer and restore the sidebar to its default mode.
 */
export function exitCustomizer( { confirmIfDirty = false } = {} ) {
	if ( ! active ) {
		return;
	}
	if ( confirmIfDirty && active.state.isDirty ) {
		if ( ! window.confirm( 'Discard your unsaved changes?' ) ) {
			return;
		}
		// Cancel-after-dirty: restore the LI order snapshot taken at
		// enterCustomizer time. Drag / keyboard / move-menu moves mutate
		// the live DOM during the session; without this, the unsaved
		// order stays visible until the next reload. Save flow takes the
		// non-confirmIfDirty exitCustomizer() branch (no snapshot
		// restore needed because the saved delta now matches the DOM).
		if ( active.layoutSnapshot ) {
			restoreLayoutSnapshot( active.layoutSnapshot );
		}
	}

	for ( const fn of active.detachFns ) {
		try {
			fn();
		} catch ( _ ) {
			// best-effort cleanup
		}
	}
	if ( active.footerEl && active.footerEl.parentNode ) {
		active.footerEl.parentNode.removeChild( active.footerEl );
	}
	if ( active.liveEl && active.liveEl.parentNode ) {
		active.liveEl.parentNode.removeChild( active.liveEl );
	}
	window.removeEventListener( 'beforeunload', active.beforeunloadHandler );
	document.body.classList.remove( BODY_MODE_CLASS );

	const sidebar = document.querySelector( '#adminmenu' );
	if ( sidebar ) {
		undecorateReassignableItems( sidebar );
	}
	if ( active.restoreGroupState ) {
		try {
			active.restoreGroupState();
		} catch ( _ ) {
			// no-op; groups will simply stay in their current state
		}
	}
	const onExit = active.onExit;
	active = null;
	if ( onExit ) {
		try {
			onExit();
		} catch ( _ ) {
			// no-op
		}
	}
}

/**
 * Add the grip handle to each reassignable plugin item. Core items and
 * post-adminmenu notices are left alone.
 *
 * @param {HTMLElement} sidebar
 * @param {Object} navModel
 */
function decorateReassignableItems( sidebar, navModel ) {
	const reassignableIds = new Set();
	for ( const group of navModel.groups || [] ) {
		for ( const child of group.children || [] ) {
			if ( child.reassignable ) {
				reassignableIds.add( child.itemId );
			}
		}
	}
	for ( const item of navModel.top_level || [] ) {
		if ( item.reassignable ) {
			reassignableIds.add( item.itemId );
		}
	}

	const lis = sidebar.querySelectorAll( 'li[data-wp-admin-sidebar-item-id]' );
	for ( const li of lis ) {
		const itemId = li.getAttribute( 'data-wp-admin-sidebar-item-id' );
		if ( ! reassignableIds.has( itemId ) ) {
			continue;
		}
		li.classList.add( REASSIGNABLE_CLASS );
		const link = li.querySelector( ':scope > a' );
		if ( ! link ) {
			continue;
		}
		// Move the grip INSIDE the link so wp-admin's natural `<a>:hover` styles
		// paint the whole row uniformly. If we kept the grip as a sibling of
		// <a>, the grip column would visually fall outside the hover region
		// (since wp-admin only paints `<a>` on hover). The link itself is
		// taken out of the tab order — Tab now lands on the grip directly,
		// then the more-options trigger.
		//
		// `<span role="button">` is used (not <button>) because nested
		// interactive content (button-in-anchor) is invalid HTML; spans with
		// role=button + tabindex are accessible AND legally inside an anchor.
		link.setAttribute( 'tabindex', '-1' );
		if ( ! link.querySelector( ':scope > .' + GRIP_CLASS ) ) {
			const grip = document.createElement( 'span' );
			grip.className = GRIP_CLASS;
			grip.setAttribute( 'role', 'button' );
			grip.setAttribute( 'tabindex', '0' );
			const labelText = ( link.textContent || itemId ).trim();
			grip.setAttribute( 'aria-label', `Reorder ${ labelText }` );
			grip.textContent = '⠿';
			link.insertBefore( grip, link.firstChild );
		}
	}
}

/**
 * Suppress click navigation on reassignable items' anchor links while the
 * customizer is open. Per 04-interaction-spec.md, the whole row is a drag
 * target and the link's normal navigate-to-page behaviour does not apply
 * during reassignment. Without this, a click that doesn't move enough to
 * register as a drag would still navigate the user away from the page they
 * were customising.
 *
 * Returns a detach function that unbinds the click capture.
 */
function suppressReassignableLinkClicks( sidebar ) {
	function onClickCapture( ev ) {
		const target = ev.target instanceof Element ? ev.target : null;
		if ( ! target ) {
			return;
		}
		const li = target.closest( 'li.wp-admin-sidebar-item--reassignable' );
		if ( ! li ) {
			return;
		}
		const link = target.closest( 'a' );
		if ( ! link || ! li.contains( link ) ) {
			return;
		}
		// preventDefault stops the anchor's navigation. We do NOT call
		// stopPropagation — the grip and more-options spans live inside this
		// link (so wp-admin's <a>:hover styles paint the whole row), and
		// their own click handlers run during the bubble phase. Stopping
		// propagation here would swallow the more-options click and break
		// the popup.
		ev.preventDefault();
	}
	sidebar.addEventListener( 'click', onClickCapture, true );
	return function detach() {
		sidebar.removeEventListener( 'click', onClickCapture, true );
	};
}

/**
 * Force every group containing reassignable items into the expanded state for
 * the customizer session. Returns a function that puts each group back where
 * it was on entry — preserves the user's pre-customizer expand/collapse
 * preference and lets the existing expand-collapse module handle persistence.
 *
 * Without this, the customizer opens with collapsed groups: items that exist
 * in the model are off-screen and the user can't see what they're meant to
 * be reordering.
 */
function expandGroupsForCustomizing( sidebar ) {
	/** @type {Array<{toggle: HTMLElement, prevExpanded: string|null}>} */
	const restorers = [];
	const groups = sidebar.querySelectorAll( 'li.wp-admin-sidebar-group' );
	for ( const group of groups ) {
		const hasReassignable = group.querySelector( 'li.wp-admin-sidebar-item--reassignable' );
		if ( ! hasReassignable ) {
			continue;
		}
		const toggle = group.querySelector( ':scope > .wp-admin-sidebar-group__header > .wp-admin-sidebar-group__toggle' );
		if ( ! toggle ) {
			continue;
		}
		const prevExpanded = group.getAttribute( 'data-expanded' );
		if ( prevExpanded !== 'true' ) {
			toggle.click();
		}
		restorers.push( { toggle, prevExpanded } );
	}
	return function restore() {
		for ( const { toggle, prevExpanded } of restorers ) {
			const group = toggle.closest( 'li.wp-admin-sidebar-group' );
			if ( ! group ) continue;
			const nowExpanded = group.getAttribute( 'data-expanded' ) === 'true';
			const wasExpanded = prevExpanded === 'true';
			if ( nowExpanded !== wasExpanded ) {
				toggle.click();
			}
		}
	};
}

function undecorateReassignableItems( sidebar ) {
	const lis = sidebar.querySelectorAll( '.' + REASSIGNABLE_CLASS );
	for ( const li of lis ) {
		li.classList.remove( REASSIGNABLE_CLASS );
		const link = li.querySelector( ':scope > a' );
		if ( link ) {
			link.removeAttribute( 'tabindex' );
		}
		// Grip lives inside the link now (decorate prepends it there); look
		// there first, fall back to the legacy LI-level position so older
		// renders without the link still clean up.
		const grip = li.querySelector( '.' + GRIP_CLASS );
		if ( grip ) {
			grip.parentNode.removeChild( grip );
		}
	}
}

/**
 * Render Cancel / Save buttons docked to the bottom of the sidebar.
 */
function renderFooter( sidebar, onSave, onCancel ) {
	const footer = document.createElement( 'div' );
	footer.className = FOOTER_CLASS;

	const cancel = document.createElement( 'button' );
	cancel.type = 'button';
	cancel.className = FOOTER_CLASS + '__cancel';
	cancel.textContent = 'Cancel';
	cancel.addEventListener( 'click', onCancel );

	const save = document.createElement( 'button' );
	save.type = 'button';
	save.className = FOOTER_CLASS + '__save';
	save.textContent = 'Save';
	save.disabled = true;
	save.addEventListener( 'click', onSave );

	footer.appendChild( cancel );
	footer.appendChild( save );
	sidebar.parentNode.insertBefore( footer, sidebar.nextSibling );
	return footer;
}

function updateFooter() {
	if ( ! active ) return;
	const save = active.footerEl.querySelector( '.' + FOOTER_CLASS + '__save' );
	if ( save ) {
		save.disabled = ! active.state.isDirty || active.state.isSaving;
		save.textContent = active.state.isSaving ? 'Saving…' : 'Save';
	}
}

/**
 * Capture the DOM order of every reassignable LI before customizer mode
 * mutates anything. Returns an array of {li, parent, nextSibling}; pass it
 * to restoreLayoutSnapshot() on Cancel-after-dirty to put rows back where
 * the user found them. Captures only items with `data-wp-admin-sidebar-item-id`
 * (the reassignable surface) — core rows like Dashboard / Tools / Settings
 * are inert during customize and don't need snapshotting.
 *
 * @param {HTMLElement} sidebar
 * @returns {Array<{li:Element,parent:Node,nextSibling:Node|null}>}
 */
function captureLayoutSnapshot( sidebar ) {
	const snapshot = [];
	const items = sidebar.querySelectorAll( 'li[data-wp-admin-sidebar-item-id]' );
	for ( const li of items ) {
		snapshot.push( {
			li,
			parent: li.parentElement,
			nextSibling: li.nextSibling,
		} );
	}
	return snapshot;
}

/**
 * Re-insert each snapshotted LI before its captured next-sibling in its
 * captured parent. If the next-sibling has wandered out of the parent (e.g.
 * itself moved during the session), append instead. Best-effort: if the
 * parent itself is gone for some reason, skip rather than throw.
 *
 * @param {Array<{li:Element,parent:Node,nextSibling:Node|null}>} snapshot
 */
function restoreLayoutSnapshot( snapshot ) {
	for ( const entry of snapshot ) {
		const { li, parent, nextSibling } = entry;
		if ( ! parent || ! parent.isConnected ) {
			continue;
		}
		if ( nextSibling && nextSibling.parentNode === parent ) {
			parent.insertBefore( li, nextSibling );
		} else {
			parent.appendChild( li );
		}
	}
}

function createLiveRegion() {
	let live = document.getElementById( ANNOUNCE_ID );
	if ( live ) {
		return live;
	}
	live = document.createElement( 'output' );
	live.id = ANNOUNCE_ID;
	live.setAttribute( 'role', 'status' );
	live.setAttribute( 'aria-live', 'polite' );
	live.style.position = 'absolute';
	live.style.left = '-10000px';
	live.style.width = '1px';
	live.style.height = '1px';
	live.style.overflow = 'hidden';
	document.body.appendChild( live );
	return live;
}

/**
 * POST the working delta. On success replace savedDelta + exit. On error
 * leave the state intact and surface the failure.
 */
async function save( options ) {
	if ( ! active ) return;
	active.state = { ...active.state, isSaving: true, saveError: null };
	updateFooter();

	// Prefer the fully-resolved `restUrl` emitted by the data planner — when a
	// host overrides via the `wp_admin_sidebar_layout_rest_url` filter (e.g.,
	// to route through a centralized public-api endpoint), this carries the
	// host's URL; on plain WP it carries the same-origin /wp-json/ route. The
	// `restRoot` fallback is for older inline payloads that didn't include
	// `restUrl`; it assumes the core `wp-admin-sidebar/v1` route on /wp-json/.
	const url = options.restUrl
		? options.restUrl
		: `${ options.restRoot.replace( /\/+$/, '' ) }/wp-admin-sidebar/v1/layout`;
	const body = JSON.stringify( active.helpers.cloneDelta( active.state.workingDelta ) );

	try {
		const res = await fetch( url, {
			method: 'POST',
			credentials: 'same-origin',
			headers: {
				'Content-Type': 'application/json',
				'X-WP-Nonce': options.nonce,
			},
			body,
		} );
		// User clicked Cancel mid-fetch — exitCustomizer() set active=null.
		// Abandon the save flow rather than dereferencing null.
		if ( ! active ) return;
		if ( ! res.ok ) {
			const detail = await safeJson( res );
			throw new Error( ( detail && detail.message ) || `Save failed (${ res.status }).` );
		}
		const saved = await res.json();
		if ( ! active ) return;
		active.state = active.helpers.applySaved( active.state, saved );
		// Publish the saved delta back to the inline data global so a same-
		// page re-entry (Customize → Save → Customize again, no reload)
		// sees the latest state instead of the stale layoutDelta captured
		// when wireCustomizeButtons() ran on initial load.
		// browse-rail.js#wireCustomizeButtons reads this fresh on each click.
		if ( typeof window !== 'undefined' && window.wpAdminSidebarData ) {
			window.wpAdminSidebarData.layoutDelta = saved;
		}
		updateFooter();
		exitCustomizer();
	} catch ( err ) {
		// Same-pattern null-guard: a Cancel mid-fetch followed by a fetch
		// rejection would otherwise dereference null on `active.state`.
		if ( ! active ) return;
		active.state = {
			...active.state,
			isSaving: false,
			saveError: { code: 'save_failed', message: err && err.message ? err.message : 'Save failed.' },
		};
		updateFooter();
		const live = active && active.liveEl;
		if ( live ) {
			live.textContent = active.state.saveError.message;
		}
	}
}

async function safeJson( res ) {
	try {
		return await res.json();
	} catch ( _ ) {
		return null;
	}
}
