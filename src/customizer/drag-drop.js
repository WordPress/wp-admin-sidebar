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

const GHOST_CLASS = 'wpcom-sidebar-drag-ghost';
const INDICATOR_CLASS = 'wpcom-sidebar-drop-indicator';
const SOURCE_DRAGGING = 'wpcom-sidebar-item--dragging';

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
		if ( target.closest( '.wpcom-sidebar-item__more' ) ) {
			return;
		}
		const li = target.closest( 'li.wpcom-sidebar-item--reassignable' );
		if ( ! li ) {
			return;
		}
		ev.preventDefault();
		const itemId = li.getAttribute( 'data-wpcom-item-id' );
		if ( ! itemId ) {
			return;
		}

		// Clean up any stale state from a prior drag that didn't finalise (lost
		// pointerup, focus change, page error). Without this guard, the previous
		// ghost lingers and the user sees two floating labels until they refresh.
		if ( activeItem || ghost ) {
			cleanup();
		}

		const rect = li.getBoundingClientRect();
		pointerOffset = { x: ev.clientX - rect.left, y: ev.clientY - rect.top };

		activeItem = {
			itemId,
			li,
			sourcePosition: positionForElement( li ),
		};
		li.classList.add( SOURCE_DRAGGING );
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
			const li = el.closest( 'li.menu-top, li.wpcom-sidebar-group' );
			if ( ! li || li === activeItem.li ) {
				continue;
			}
			if ( li.classList.contains( 'wpcom-sidebar-group' ) ) {
				const childList = li.querySelector( ':scope > .wpcom-sidebar-group__children' );
				if ( ! childList ) continue;
				if ( li.getAttribute( 'data-expanded' ) !== 'true' ) {
					// Drop on a collapsed group header → land at the end of that
					// group. We don't auto-expand on hover in v1; keyboard +
					// move-to menu cover that path explicitly.
					const groupId = li.getAttribute( 'data-group' );
					if ( groupId ) {
						return {
							container: childList,
							beforeLi: null,
							position: { kind: 'in_group', group_id: groupId, index: childList.children.length },
						};
					}
				}
				continue;
			}
			// Reassignable sibling row → use the cursor's vertical position
			// against the row midpoint to decide above-or-below.
			const rect = li.getBoundingClientRect();
			const above = y < rect.top + rect.height / 2;
			const container = li.parentElement;
			if ( ! container ) continue;
			const groupContainer = container.closest( 'li.wpcom-sidebar-group' );
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

	const link = li.querySelector( ':scope > a' );
	if ( link ) {
		const cloned = link.cloneNode( true );
		cloned.removeAttribute( 'id' );
		cloned.removeAttribute( 'href' );
		cloned.setAttribute( 'aria-hidden', 'true' );
		cloned.setAttribute( 'tabindex', '-1' );
		cloned.querySelectorAll( '.wp-submenu, .wp-submenu-wrap, .wpcom-sidebar-item__more' ).forEach( ( el ) => el.remove() );
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
	const groupContainer = li.parentElement && li.parentElement.closest( 'li.wpcom-sidebar-group' );
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
