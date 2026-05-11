/**
 * Pointer-based drag-drop for the customizer.
 *
 * One ghost element follows the cursor; one drop indicator inserts at the
 * valid landing slot between sibling items. Both are siblings of the affected
 * <li>, not children — keeps the DOM contract from leaking implementation
 * details into A.1's grouping.js.
 *
 * Contract reference: plan 04-interaction-spec.md (drag-drop) and
 *                     plan 03-contracts.md § 8 (DOM shape).
 */

const GHOST_CLASS = 'wp-admin-sidebar-drag-ghost';
const INDICATOR_CLASS = 'wp-admin-sidebar-drop-indicator';
const SOURCE_DRAGGING = 'wp-admin-sidebar-item--dragging';
const BODY_DRAGGING = 'wp-admin-sidebar-dragging';

/**
 * Attach drag-drop handlers to the sidebar root for the customizer mode.
 *
 * @param {HTMLElement} sidebar  The #adminmenu element.
 * @param {Object} controller    { commitMove(itemId, position), exitDrag() }
 * @returns {Function} detach
 */
export function attachDragDrop( sidebar, controller ) {
	let activeItem = null;       // {itemId, li, sourcePosition}
	let ghost = null;
	let indicator = null;
	let pointerOffset = { x: 0, y: 0 };
	let lastTarget = null;       // { container, beforeLi | null, position }

	function onPointerDown( ev ) {
		// The whole row is draggable, not just the grip handle. Per
		// 04-interaction-spec.md and the Figma annotations on 3505:75220,
		// reassignable items adopt drag affordances across the entire row
		// (cursor: grab anywhere, hover bg across grip + link + more). The
		// grip is a visual cue, not the only valid drag-start target.
		//
		// Only the more-options button is excluded so its click handler can
		// open the popup menu without competing with drag init.
		const target = ev.target instanceof Element ? ev.target : null;
		if ( ! target ) {
			return;
		}
		if ( target.closest( '.wp-admin-sidebar-item__more' ) ) {
			return;
		}
		const li = target.closest( 'li.wp-admin-sidebar-item--reassignable' );
		if ( ! li ) {
			return;
		}
		ev.preventDefault();
		const itemId = li.getAttribute( 'data-wp-admin-sidebar-item-id' );
		if ( ! itemId ) {
			return;
		}

		// Clean up any stale state from a prior drag that didn't finalise (lost
		// pointerup, focus change, page error). Without this guard, the previous
		// ghost lingers and the user sees two floating labels until they refresh.
		if ( activeItem || ghost ) {
			cleanup();
		}

		// Defensive strip of core's `opensub` hover-intent class. customizer.js
		// strips it once on enter and the customizer.css block hides
		// `.wp-submenu` for the duration of the mode, but core's hoverIntent
		// can re-add `opensub` between enter and the first drag start (the
		// pointerdown that initiates the drag often arrives mid-hoverIntent
		// timer). Without this, a flyout flickers in for a frame as the drag
		// begins. Issue #1 / DES-576 / DES-580.
		sidebar.querySelectorAll( 'li.menu-top.opensub' ).forEach( ( el ) => el.classList.remove( 'opensub' ) );

		const rect = li.getBoundingClientRect();
		pointerOffset = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };

		activeItem = {
			itemId,
			li,
			sourcePosition: positionForElement( li ),
		};
		li.classList.add( SOURCE_DRAGGING );
		document.body.classList.add( BODY_DRAGGING );
		ghost = createGhost( li );
		document.body.appendChild( ghost );
		moveGhost( ev.clientX, ev.clientY );

		document.addEventListener( 'pointermove', onPointerMove );
		document.addEventListener( 'pointerup', onPointerUp );
		document.addEventListener( 'keydown', onKeyDown );
	}

	function onPointerMove( ev ) {
		if ( ! activeItem ) {
			return;
		}
		moveGhost( ev.clientX, ev.clientY );
		const target = findDropTarget( ev.clientX, ev.clientY );
		updateIndicator( target );
		lastTarget = target;
	}

	function onPointerUp() {
		if ( ! activeItem ) {
			return;
		}
		if ( lastTarget && lastTarget.position && lastTarget.container ) {
			// Move the DOM to the slot the indicator was occupying. The model
			// update follows so isDirty derivation sees the new position.
			lastTarget.container.insertBefore( activeItem.li, lastTarget.beforeLi || null );
			controller.commitMove( activeItem.itemId, lastTarget.position );
		}
		cleanup();
	}

	function onKeyDown( ev ) {
		if ( ev.key === 'Escape' && activeItem ) {
			cleanup();
		}
	}

	function cleanup() {
		if ( activeItem ) {
			activeItem.li.classList.remove( SOURCE_DRAGGING );
			activeItem = null;
		}
		document.body.classList.remove( BODY_DRAGGING );
		if ( ghost && ghost.parentNode ) {
			ghost.parentNode.removeChild( ghost );
		}
		ghost = null;
		removeIndicator();
		lastTarget = null;
		document.removeEventListener( 'pointermove', onPointerMove );
		document.removeEventListener( 'pointerup', onPointerUp );
		document.removeEventListener( 'keydown', onKeyDown );
		controller.exitDrag();
	}

	function moveGhost( x, y ) {
		if ( ! ghost ) return;
		ghost.style.transform = `translate(${ x - pointerOffset.x }px, ${ y - pointerOffset.y }px)`;
	}

	function findDropTarget( x, y ) {
		// Reassignable siblings live inside either a group's __children <ul> or
		// the sidebar root. The sidebar may also contain unreassignable items
		// (core, post-adminmenu notices) that don't accept drops.
		const elements = document.elementsFromPoint( x, y );
		for ( const el of elements ) {
			const li = el.closest( 'li.menu-top, li.wp-admin-sidebar-group' );
			if ( ! li || li === activeItem.li ) {
				continue;
			}
			if ( li.classList.contains( 'wp-admin-sidebar-group' ) ) {
				const childList = li.querySelector( ':scope > .wp-admin-sidebar-group__children' );
				if ( ! childList ) continue;
				const groupId = li.getAttribute( 'data-group' );
				if ( ! groupId ) continue;
				const isExpanded = li.getAttribute( 'data-expanded' ) === 'true';
				const isEmpty = childList.querySelectorAll( ':scope > li' ).length === 0;
				if ( ! isExpanded || isEmpty ) {
					// Drop on a collapsed group header → land at the end of that
					// group. Also handles the expanded-but-empty case: once the
					// user has reassigned every item out of a group, the group's
					// children-UL has zero content and the header is the only
					// hit-target — without this branch the user could never re-
					// add items to an emptied group via drag-drop. (Move-menu
					// already covers this path because it treats the group LI
					// as a one-step row target regardless of expand state.)
					return {
						container: childList,
						beforeLi: null,
						position: { kind: 'in_group', group_id: groupId, index: childList.children.length },
					};
				}
				continue;
			}
			// Reassignable sibling row → use the cursor's vertical position
			// against the row midpoint to decide above-or-below.
			const rect = li.getBoundingClientRect();
			const above = y < rect.top + rect.height / 2;
			const container = li.parentElement;
			if ( ! container ) continue;
			const groupContainer = container.closest( 'li.wp-admin-sidebar-group' );
			const baseIndex = Array.prototype.indexOf.call( container.children, li );
			let slot = above ? baseIndex : baseIndex + 1;
			// If the source is in the same container at a lower index, dropping
			// it later requires a -1 adjustment: removing the source shifts
			// everything past its position up by one. Without this, the saved
			// override's index is one too high and the item lands one slot
			// further than the user dropped on next render.
			if ( activeItem.li.parentElement === container ) {
				const sourceIndex = Array.prototype.indexOf.call( container.children, activeItem.li );
				if ( sourceIndex !== -1 && sourceIndex < slot ) {
					slot -= 1;
				}
			}
			if ( groupContainer ) {
				const groupId = groupContainer.getAttribute( 'data-group' );
				return {
					container,
					beforeLi: above ? li : li.nextElementSibling,
					position: { kind: 'in_group', group_id: groupId, index: slot },
				};
			}
			// Top-level row in the sidebar root.
			return {
				container,
				beforeLi: above ? li : li.nextElementSibling,
				position: { kind: 'top_level', index: slot },
			};
		}
		return null;
	}

	function updateIndicator( target ) {
		if ( ! target ) {
			removeIndicator();
			return;
		}
		if ( ! indicator ) {
			indicator = document.createElement( 'li' );
			indicator.className = INDICATOR_CLASS;
			indicator.setAttribute( 'aria-hidden', 'true' );
		}
		// Only re-insert if the slot changed; reduces layout thrash.
		const expectedNext = target.beforeLi || null;
		if ( indicator.parentElement === target.container && indicator.nextElementSibling === expectedNext ) {
			return;
		}
		target.container.insertBefore( indicator, expectedNext );
	}

	function removeIndicator() {
		if ( indicator && indicator.parentNode ) {
			indicator.parentNode.removeChild( indicator );
		}
		indicator = null;
	}

	sidebar.addEventListener( 'pointerdown', onPointerDown );
	return function detach() {
		sidebar.removeEventListener( 'pointerdown', onPointerDown );
		cleanup();
	};
}

/**
 * Build the floating ghost from the source <li>. Per Figma 3505:75323, the
 * ghost mirrors the source row: grip + dashicon + label. With the customizer
 * layout the grip lives inside the <a>, so cloning the link picks up grip +
 * icon + label in one shot. Submenu wrappers and the more-options trigger
 * are stripped — the ghost is the row, not the popup affordance.
 */
function createGhost( li ) {
	const ghost = document.createElement( 'div' );
	ghost.className = GHOST_CLASS;

	// Mirror the source row's dimensions so the floating preview matches the
	// item being dragged (DES-583). Reading the rect once at drag start is
	// cheap and the source's size doesn't change mid-drag.
	const rect = li.getBoundingClientRect();
	ghost.style.width = `${ rect.width }px`;
	ghost.style.height = `${ rect.height }px`;

	const link = li.querySelector( ':scope > a' );
	if ( link ) {
		const cloned = link.cloneNode( true );
		cloned.removeAttribute( 'id' );
		cloned.removeAttribute( 'href' );
		cloned.setAttribute( 'aria-hidden', 'true' );
		cloned.setAttribute( 'tabindex', '-1' );
		cloned.querySelectorAll( '.wp-submenu, .wp-submenu-wrap, .wp-admin-sidebar-item__more' ).forEach( ( el ) => el.remove() );
		ghost.appendChild( cloned );
	}

	if ( ! ghost.childElementCount ) {
		// Defensive fallback for items that have neither a link.
		ghost.textContent = ( li.textContent || '' ).trim();
	}
	return ghost;
}

/**
 * Compute the canonical Position for a sidebar item from its DOM placement.
 * Used to seed sourcePosition on drag start.
 *
 * @param {HTMLElement} li
 * @returns {Position}
 */
export function positionForElement( li ) {
	const groupContainer = li.parentElement && li.parentElement.closest( 'li.wp-admin-sidebar-group' );
	const siblings = li.parentElement ? Array.prototype.indexOf.call( li.parentElement.children, li ) : 0;
	if ( groupContainer ) {
		return {
			kind: 'in_group',
			group_id: groupContainer.getAttribute( 'data-group' ) || '',
			index: siblings,
		};
	}
	return { kind: 'top_level', index: siblings };
}
