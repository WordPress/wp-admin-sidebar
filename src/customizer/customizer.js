/**
 * Customizer entry point.
 *
 * Loaded lazily by browse-rail.js when the user clicks the per-group customize
 * button. Bootstraps draft state, decorates reassignable items with grip
 * handles + 3-dot triggers, attaches drag-drop + keyboard reorder + move-menu,
 * and renders auto-save status with Undo / Done controls. Each completed move
 * queues a layout POST; Undo restores the previous operation and queues another
 * POST; Done exits the mode.
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
const MAX_UNDO_STACK = 10;
// Marker on group <li>s whose collapse toggle is locked for the duration
// of a customize session. Drives the not-allowed cursor + dimmed chevron
// styling in customizer.css. See expandGroupsForCustomizing() (issue #55).
const GROUP_LOCKED_CLASS = 'wp-admin-sidebar-group--reorder-locked';

let active = null; // { state, detachFns, footerEl, liveEl, beforeunloadHandler, undoStack }

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
 *   - `restUrl` is the fully-resolved layout endpoint (preferred); auto-save
 *     uses it directly. Hosts that route REST through a centralized
 *     public-api dispatcher set this to their own endpoint; plain WP
 *     leaves it pointing at the same-origin /wp-json/ route. Newer inline
 *     payloads always emit it.
 *   - `restRoot` is the legacy fallback for inline payloads that didn't
 *     include `restUrl`. Auto-save concatenates the core route on it.
 *   - `nonce` is the wp_rest cookie nonce for the POST.
 *   - `onExit` (optional) fires when the customizer closes. Used by
 *     browse-rail.js to refocus the triggering customize button.
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
	const {
		createState,
		moveItem,
		resetItem,
		beginDrag,
		endDrag,
		cloneDelta,
		deltasEqual,
		updateSaved,
		restoreWorking,
	} = draftState;
	const { attachDragDrop } = dragDrop;
	const { attachKeyboardReorder } = keyboardReorder;
	const { attachMoveMenu } = moveMenu;

	// Stash helpers used by the module-scope auto-save and undo flows so they
	// stay available across exit / re-enter cycles.
	const helpers = { cloneDelta, deltasEqual, updateSaved, restoreWorking };

	const state = createState( navModel, savedDelta );
	const liveEl = createLiveRegion();
	// Snapshot the DOM order of every reassignable LI before decoration runs.
	// This represents the latest known saved layout at session start. Auto-save
	// updates it only after the server catches up with the current DOM.
	const savedLayoutSnapshot = captureLayoutSnapshot( sidebar );
	document.body.classList.add( BODY_MODE_CLASS );
	// Strip core's `opensub` hover-intent class off any top-level item that
	// happened to be flyout-open when the user entered customize. The CSS
	// block in customizer.css hides the submenu wrapper outright, but the
	// class itself drives other core behaviours (focus management, expanded
	// state on keyboard nav). Strip on enter, snapshot the affected LIs,
	// re-apply on exit so the user's pre-customize hover state survives the
	// session. Issue #1 / DES-576 / DES-580.
	const opensubSnapshot = snapshotAndStripOpensubClasses( sidebar );

	decorateReassignableItems( sidebar, navModel );
	const restoreGroupState = expandGroupsForCustomizing( sidebar );

	const controller = {
		commitMove( itemId, position, details = {} ) {
			return commitWorkingChange(
				itemId,
				{ ...details, nextPosition: position },
				( state ) => moveItem( state, itemId, position )
			);
		},
		resetItem( itemId, details = {} ) {
			return commitWorkingChange( itemId, details, ( state ) => resetItem( state, itemId ) );
		},
		beginDrag( itemId, sourcePosition ) {
			active.state = beginDrag( active.state, itemId, sourcePosition );
			updateFooter();
		},
		exitDrag() {
			active.state = endDrag( active.state );
			updateFooter();
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
	const detachCollapseMenu = disableCollapseMenuFocus();
	const detachEscape = attachGlobalEscapeShortcut();

	const footerEl = renderFooter( sidebar, function onUndo() {
		undoLastChange();
	}, function onRetry() {
		retryAutosave();
	}, function onDone() {
		exitCustomizer( { confirmIfDirty: true } );
	} );

	const beforeunloadHandler = ( ev ) => {
		if ( active && hasUnsavedChanges() ) {
			ev.preventDefault();
			ev.returnValue = '';
			return '';
		}
	};
	window.addEventListener( 'beforeunload', beforeunloadHandler );

	active = {
		state,
		detachFns: [ detachDrag, detachKeyboard, detachMenu, detachLinkSuppress, detachCollapseMenu, detachEscape ],
		footerEl,
		liveEl,
		beforeunloadHandler,
		restoreGroupState,
		savedLayoutSnapshot,
		opensubSnapshot,
		helpers,
		sidebar,
		undoStack: [],
		pendingSaveDelta: null,
		savePromise: null,
		lastSavedAt: 0,
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
	if ( confirmIfDirty && hasUnsavedChanges() ) {
		const message = active.state.saveError
			? 'Some changes could not be saved. Exit and discard unsaved changes?'
			: 'Exit and discard unsaved changes?';
		if ( ! window.confirm( message ) ) {
			return;
		}
		// Restore the last DOM snapshot known to match saved server state.
		// This can be newer than the entry snapshot when earlier auto-saves
		// completed before a later save failed or was still in flight.
		if ( active.savedLayoutSnapshot ) {
			restoreLayoutSnapshot( active.savedLayoutSnapshot );
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
	// Re-apply any `opensub` classes we stripped on enter so the user's
	// pre-customize hover state survives the session. Best-effort: if a
	// snapshot LI has been removed from the DOM (rare — core menu rebuild
	// during the session), skip it rather than throw.
	if ( active.opensubSnapshot ) {
		for ( const li of active.opensubSnapshot ) {
			if ( li && li.isConnected ) {
				li.classList.add( 'opensub' );
			}
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
 * Take the wp-admin "Collapse menu" control out of the keyboard tab order
 * while customize mode is active. The CSS rule that fades the row + sets
 * `pointer-events: none` only blocks the mouse — without this the inner
 * focusable element is still a tab stop and announces as a normal control.
 * Captures the original tabindex / aria-disabled and returns a detach
 * function that restores them on exit, so non-customize state is untouched.
 *
 * Matches both the legacy `<a>` (older wp-admin) and the modern `<button>`
 * (wp-admin 6.9+). See DES-579.
 */
function disableCollapseMenuFocus() {
	const target = document.querySelector( '#collapse-menu > a, #collapse-menu > button' );
	if ( ! target ) {
		return function detach() {};
	}
	const prevTabindex = target.getAttribute( 'tabindex' );
	const prevAriaDisabled = target.getAttribute( 'aria-disabled' );
	target.setAttribute( 'tabindex', '-1' );
	target.setAttribute( 'aria-disabled', 'true' );
	return function detach() {
		if ( prevTabindex === null ) {
			target.removeAttribute( 'tabindex' );
		} else {
			target.setAttribute( 'tabindex', prevTabindex );
		}
		if ( prevAriaDisabled === null ) {
			target.removeAttribute( 'aria-disabled' );
		} else {
			target.setAttribute( 'aria-disabled', prevAriaDisabled );
		}
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
	/** @type {Array<{toggle: HTMLButtonElement, group: HTMLElement, prevExpanded: string|null}>} */
	const restorers = [];
	const groups = sidebar.querySelectorAll( 'li.wp-admin-sidebar-group' );
	for ( const group of groups ) {
		const hasReassignable = group.querySelector( 'li.wp-admin-sidebar-item--reassignable' );
		if ( ! hasReassignable ) {
			continue;
		}
		const toggle = group.querySelector( ':scope > .wp-admin-sidebar-group__header > .wp-admin-sidebar-group__toggle' );
		if ( ! ( toggle instanceof HTMLButtonElement ) ) {
			continue;
		}
		const prevExpanded = group.getAttribute( 'data-expanded' );
		if ( prevExpanded !== 'true' ) {
			toggle.click();
		}
		// Lock collapse for the duration of the customize session (issue #55).
		// Disabling the <button> stops mouse + keyboard activation natively;
		// the chevron <span> forwards its click via `toggle.click()`, which is
		// a no-op on a disabled button — so the chevron is neutralised for
		// free. The marker class drives a `cursor: not-allowed` + dimmed
		// opacity rule in customizer.css so users get a clear visual cue.
		toggle.disabled = true;
		group.classList.add( GROUP_LOCKED_CLASS );
		restorers.push( { toggle, group, prevExpanded } );
	}
	return function restore() {
		for ( const { toggle, group, prevExpanded } of restorers ) {
			// Re-enable BEFORE attempting the restorer click — click() is a
			// no-op on disabled buttons and would otherwise strand the group
			// in its force-expanded state.
			toggle.disabled = false;
			group.classList.remove( GROUP_LOCKED_CLASS );
			if ( ! group.isConnected ) continue;
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
 * Render auto-save status and compact Undo / Done controls at the bottom of
 * the sidebar.
 */
function renderFooter( sidebar, onUndo, onRetry, onDone ) {
	const footer = document.createElement( 'div' );
	footer.className = FOOTER_CLASS;

	const status = document.createElement( 'div' );
	status.className = FOOTER_CLASS + '__status';
	status.textContent = 'Changes save automatically.';

	const undo = document.createElement( 'button' );
	undo.type = 'button';
	undo.className = FOOTER_CLASS + '__undo';
	undo.textContent = 'Undo';
	undo.disabled = true;
	undo.addEventListener( 'click', onUndo );

	const retry = document.createElement( 'button' );
	retry.type = 'button';
	retry.className = FOOTER_CLASS + '__retry';
	retry.textContent = 'Retry';
	retry.hidden = true;
	retry.addEventListener( 'click', onRetry );

	const done = document.createElement( 'button' );
	done.type = 'button';
	done.className = FOOTER_CLASS + '__done';
	done.textContent = 'Done';
	done.addEventListener( 'click', onDone );

	footer.appendChild( status );
	footer.appendChild( undo );
	footer.appendChild( retry );
	footer.appendChild( done );
	sidebar.parentNode.insertBefore( footer, sidebar.nextSibling );
	return footer;
}

function updateFooter() {
	if ( ! active ) return;
	const status = active.footerEl.querySelector( '.' + FOOTER_CLASS + '__status' );
	const undo = active.footerEl.querySelector( '.' + FOOTER_CLASS + '__undo' );
	const retry = active.footerEl.querySelector( '.' + FOOTER_CLASS + '__retry' );
	const done = active.footerEl.querySelector( '.' + FOOTER_CLASS + '__done' );
	if ( status ) {
		if ( active.state.saveError ) {
			status.textContent = active.state.saveError.message || 'Save failed.';
		} else if ( active.state.isSaving || active.pendingSaveDelta ) {
			status.textContent = 'Saving...';
		} else if ( active.state.isDirty ) {
			status.textContent = 'Unsaved changes.';
		} else if ( active.lastSavedAt ) {
			status.textContent = 'Saved.';
		} else {
			status.textContent = 'Changes save automatically.';
		}
	}
	if ( undo ) {
		undo.disabled = active.undoStack.length === 0 || !! active.state.activeDrag;
	}
	if ( retry ) {
		retry.hidden = ! active.state.saveError;
		retry.disabled = active.state.isSaving;
	}
	if ( done ) {
		done.disabled = active.state.isSaving || !! active.pendingSaveDelta;
	}
}

/**
 * Capture the DOM order of every reassignable LI before customizer mode
 * mutates anything. Returns an array of {li, parent, nextSibling}; pass it to
 * restoreLayoutSnapshot() when discarding unsaved changes. Captures only items
 * with `data-wp-admin-sidebar-item-id`; core rows like Dashboard, Tools, and
 * Settings are inert during customize and don't need snapshotting.
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
 * Snapshot every top-level LI that core has tagged with the `opensub`
 * hover-intent class and strip the class so wp-admin doesn't render the
 * flyout while customize is active. The matching CSS block in customizer.css
 * also hides `.wp-submenu` outright; this helper exists because the class
 * itself drives other core behaviours beyond pure visibility (focus
 * management on keyboard nav, expanded ARIA state). Returning the LIs lets
 * exitCustomizer() re-apply the class so the user's pre-customize hover
 * state survives the session. Issue #1 / DES-576 / DES-580.
 *
 * @param {HTMLElement} sidebar
 * @returns {Element[]} snapshot of LIs that previously had `opensub`
 */
function snapshotAndStripOpensubClasses( sidebar ) {
	const snapshot = [];
	const lis = sidebar.querySelectorAll( 'li.menu-top.opensub' );
	for ( const li of lis ) {
		snapshot.push( li );
		li.classList.remove( 'opensub' );
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

function commitWorkingChange( itemId, details, mutateState ) {
	if ( ! active ) {
		return false;
	}
	if (
		details.previousPosition &&
		details.nextPosition &&
		positionsEqual( details.previousPosition, details.nextPosition )
	) {
		updateFooter();
		return false;
	}

	const previousDelta = active.helpers.cloneDelta( active.state.workingDelta );
	const nextState = mutateState( active.state );
	if ( active.helpers.deltasEqual( previousDelta, nextState.workingDelta ) ) {
		active.state = nextState;
		updateFooter();
		return false;
	}

	active.state = nextState;
	if ( details.previousPosition ) {
		active.undoStack.push( {
			itemId,
			previousPosition: clonePosition( details.previousPosition ),
			previousDelta,
			label: details.label || itemId,
		} );
		if ( active.undoStack.length > MAX_UNDO_STACK ) {
			active.undoStack.shift();
		}
	}
	scheduleAutosave();
	updateFooter();
	return true;
}

function undoLastChange() {
	if ( ! active || active.state.activeDrag || active.undoStack.length === 0 ) {
		return;
	}
	const frame = active.undoStack.pop();
	const li = findItemById( active.sidebar, frame.itemId );
	if ( ! li || ! moveItemElementToPosition( active.sidebar, li, frame.previousPosition ) ) {
		active.undoStack.push( frame );
		announce( 'Could not undo the last change.' );
		updateFooter();
		return;
	}
	active.state = active.helpers.restoreWorking( active.state, frame.previousDelta );
	scheduleAutosave();
	announce( `Undid last change for ${ frame.label }.` );
	updateFooter();
}

function retryAutosave() {
	if ( ! active || active.state.isSaving ) {
		return;
	}
	scheduleAutosave();
}

function scheduleAutosave() {
	if ( ! active ) {
		return;
	}
	if ( ! active.state.isDirty && ! active.savePromise && ! active.state.saveError ) {
		updateFooter();
		return;
	}
	active.pendingSaveDelta = active.helpers.cloneDelta( active.state.workingDelta );
	active.state = { ...active.state, isSaving: true, saveError: null };
	updateFooter();
	void flushAutosaveQueue();
}

function flushAutosaveQueue() {
	if ( ! active ) {
		return Promise.resolve();
	}
	if ( active.savePromise ) {
		return active.savePromise;
	}
	active.savePromise = runAutosaveQueue().finally( () => {
		if ( active ) {
			active.savePromise = null;
			updateFooter();
		}
	} );
	return active.savePromise;
}

async function runAutosaveQueue() {
	while ( active && active.pendingSaveDelta ) {
		const delta = active.pendingSaveDelta;
		active.pendingSaveDelta = null;
		try {
			const saved = await postLayoutDelta( active.options, delta );
			if ( ! active ) {
				return;
			}
			active.state = active.helpers.updateSaved( active.state, saved );
			publishSavedDelta( saved );
			active.lastSavedAt = Date.now();
			if ( active.helpers.deltasEqual( active.state.workingDelta, saved ) && active.sidebar ) {
				active.savedLayoutSnapshot = captureLayoutSnapshot( active.sidebar );
			}
			if ( active.pendingSaveDelta ) {
				active.state = { ...active.state, isSaving: true, saveError: null };
			}
			updateFooter();
		} catch ( err ) {
			if ( ! active ) {
				return;
			}
			if ( active.pendingSaveDelta ) {
				active.state = { ...active.state, isSaving: true, saveError: null };
				updateFooter();
				continue;
			}
			active.state = {
				...active.state,
				isSaving: false,
				saveError: { code: 'save_failed', message: err && err.message ? err.message : 'Save failed.' },
			};
			announce( active.state.saveError.message );
			updateFooter();
			return;
		}
	}
	if ( active ) {
		active.state = { ...active.state, isSaving: false };
		updateFooter();
	}
}

async function postLayoutDelta( options, delta ) {
	// Prefer the fully-resolved `restUrl` emitted by the data planner. Hosts
	// can rebind it through `wp_admin_sidebar_layout_rest_url`; the `restRoot`
	// fallback supports older inline payloads.
	const url = options.restUrl
		? options.restUrl
		: `${ options.restRoot.replace( /\/+$/, '' ) }/wp-admin-sidebar/v1/layout`;
	const res = await fetch( url, {
		method: 'POST',
		credentials: 'same-origin',
		headers: {
			'Content-Type': 'application/json',
			'X-WP-Nonce': options.nonce,
		},
		body: JSON.stringify( delta ),
	} );
	if ( ! res.ok ) {
		const detail = await safeJson( res );
		throw new Error( ( detail && detail.message ) || `Save failed (${ res.status }).` );
	}
	return res.json();
}

function publishSavedDelta( saved ) {
	if ( typeof window !== 'undefined' && window.wpAdminSidebarData ) {
		window.wpAdminSidebarData.layoutDelta = saved;
	}
}

function hasUnsavedChanges() {
	return !! (
		active &&
		( active.state.isDirty || active.state.isSaving || active.pendingSaveDelta || active.state.saveError )
	);
}

function attachGlobalEscapeShortcut() {
	function onKeyDown( ev ) {
		if ( ev.key !== 'Escape' || ev.defaultPrevented || ! active ) {
			return;
		}
		if ( active.state.activeDrag ) {
			return;
		}
		if ( active.state.isSaving || active.pendingSaveDelta ) {
			return;
		}
		ev.preventDefault();
		exitCustomizer( { confirmIfDirty: true } );
	}
	document.addEventListener( 'keydown', onKeyDown );
	return function detach() {
		document.removeEventListener( 'keydown', onKeyDown );
	};
}

function announce( msg ) {
	if ( ! active || ! active.liveEl ) {
		return;
	}
	active.liveEl.textContent = '';
	requestAnimationFrame( () => {
		if ( active && active.liveEl ) {
			active.liveEl.textContent = msg;
		}
	} );
}

function findItemById( sidebar, itemId ) {
	if ( ! sidebar ) {
		return null;
	}
	const items = sidebar.querySelectorAll( 'li[data-wp-admin-sidebar-item-id]' );
	for ( const li of items ) {
		if ( li.getAttribute( 'data-wp-admin-sidebar-item-id' ) === itemId ) {
			return li;
		}
	}
	return null;
}

function moveItemElementToPosition( sidebar, li, position ) {
	const target = resolveTargetContainer( sidebar, position );
	if ( ! target ) {
		return false;
	}
	const siblings = Array.from( target.children ).filter(
		( el ) => el.tagName === 'LI' && el !== li && ! el.classList.contains( 'wp-admin-sidebar-drop-indicator' )
	);
	const requested = Number.isFinite( position.index ) ? Math.floor( position.index ) : 0;
	const idx = Math.max( 0, Math.min( requested, siblings.length ) );
	target.insertBefore( li, siblings[ idx ] || null );
	return true;
}

function resolveTargetContainer( sidebar, position ) {
	if ( ! sidebar || ! position || typeof position !== 'object' ) {
		return null;
	}
	if ( position.kind === 'top_level' ) {
		return sidebar;
	}
	if ( position.kind === 'in_group' ) {
		const groups = sidebar.querySelectorAll( 'li.wp-admin-sidebar-group' );
		for ( const group of groups ) {
			if ( group.getAttribute( 'data-group' ) === position.group_id ) {
				return group.querySelector( ':scope > .wp-admin-sidebar-group__children' );
			}
		}
	}
	return null;
}

function positionsEqual( a, b ) {
	if ( ! a || ! b || a.kind !== b.kind || a.index !== b.index ) {
		return false;
	}
	if ( a.kind === 'in_group' ) {
		return a.group_id === b.group_id;
	}
	return true;
}

function clonePosition( position ) {
	return { ...position };
}

async function safeJson( res ) {
	try {
		return await res.json();
	} catch ( _ ) {
		return null;
	}
}
