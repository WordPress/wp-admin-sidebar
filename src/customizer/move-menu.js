/**
 * "Move to" menu — the only keyboard path for cross-container moves.
 *
 * Renders a 3-dot trigger on each reassignable item; clicking opens a small
 * popup with: Move up, Move down, Move to top level (when the item is
 * inside a group), Reset to default.
 *
 * "Move to <group>" entries were removed in issue #60: testers couldn't
 * differentiate them from "Reset to default" — both actions returned a
 * top-level item back into its baseline group, which made them read as
 * duplicates. Cross-group moves remain available via drag (DES-647 tracks
 * making more items draggable too). If multi-group support lands later
 * with a clearer affordance, this is the place to bring keyboard cross-
 * group moves back.
 *
 * Contract reference: plan 04-interaction-spec.md (move-to menu)
 * and plan 03-contracts.md § 6 (Allowed destinations).
 */

const TRIGGER_CLASS = 'wp-admin-sidebar-item__more';
const MENU_CLASS = 'wp-admin-sidebar-move-menu';
const ITEM_CLASS = 'wp-admin-sidebar-move-menu__item';

let openMenu = null; // { menuEl, trigger }

/**
 * Inject the 3-dot trigger on each reassignable item and wire its click.
 *
 * @param {HTMLElement} sidebar
 * @param {Object} navModel
 * @param {Object} controller   { commitMove, resetItem, announce, closeIfEmpty }
 * @returns {Function} detach
 */
export function attachMoveMenu( sidebar, navModel, controller ) {
	const reassignable = sidebar.querySelectorAll( 'li.wp-admin-sidebar-item--reassignable' );
	for ( const li of reassignable ) {
		injectTrigger( li );
	}

	function onClick( ev ) {
		if ( openMenu && ! ev.target.closest( '.' + MENU_CLASS ) && ! ev.target.closest( '.' + TRIGGER_CLASS ) ) {
			closeMenu();
		}
		const trigger = ev.target instanceof Element ? ev.target.closest( '.' + TRIGGER_CLASS ) : null;
		if ( ! trigger ) {
			return;
		}
		ev.preventDefault();
		ev.stopPropagation();
		const li = trigger.closest( 'li.wp-admin-sidebar-item--reassignable' );
		if ( ! li ) {
			return;
		}
		if ( openMenu && openMenu.trigger === trigger ) {
			closeMenu();
			return;
		}
		closeMenu();
		openFor( li, trigger );
	}

	function onKeyDown( ev ) {
		if ( ev.key === 'Escape' && openMenu ) {
			ev.preventDefault();
			const trigger = openMenu.trigger;
			closeMenu();
			trigger.focus();
		}
	}

	// Dismiss the open menu the instant the user starts a drag (or any other
	// pointer-down outside the menu / trigger). The `click`-phase handler
	// above only fires on a full click — by then a press-and-hold drag has
	// already taken hold of a row, so the floating menu stays anchored at
	// its `position: fixed` coordinates while the row moves out from under
	// it. Listening on `pointerdown` in the capture phase fires before
	// drag-drop.js's own `pointerdown` handler on the sidebar, so we close
	// the menu first and let the drag start cleanly.
	function onPointerDown( ev ) {
		if ( ! openMenu ) {
			return;
		}
		if ( ! ( ev.target instanceof Element ) ) {
			return;
		}
		if ( ev.target.closest( '.' + MENU_CLASS ) || ev.target.closest( '.' + TRIGGER_CLASS ) ) {
			return;
		}
		closeMenu();
	}

	function openFor( li, trigger ) {
		const itemId = li.getAttribute( 'data-wp-admin-sidebar-item-id' );
		if ( ! itemId ) return;
		const menu = document.createElement( 'ul' );
		menu.className = MENU_CLASS;
		menu.setAttribute( 'role', 'menu' );

		const currentContainer = li.parentElement;
		const inGroup = currentContainer ? currentContainer.closest( 'li.wp-admin-sidebar-group' ) : null;
		const currentGroupId = inGroup ? inGroup.getAttribute( 'data-group' ) : null;

		const choices = [];
		choices.push( { label: 'Move up', action: () => commit( -1 ) } );
		choices.push( { label: 'Move down', action: () => commit( 1 ) } );
		if ( currentGroupId !== null ) {
			choices.push( {
				label: 'Move to top level',
				action: () => crossMove( { kind: 'top_level', index: 0 } ),
			} );
		}
		choices.push( {
			label: 'Reset to default',
			action: () => {
				resetToDefault( li, itemId );
				closeMenu();
				trigger.focus();
			},
		} );

		for ( const choice of choices ) {
			const btn = document.createElement( 'button' );
			btn.type = 'button';
			btn.className = ITEM_CLASS;
			btn.setAttribute( 'role', 'menuitem' );
			btn.textContent = choice.label;
			btn.addEventListener( 'click', ( e ) => {
				e.preventDefault();
				choice.action();
			} );
			const wrap = document.createElement( 'li' );
			wrap.appendChild( btn );
			menu.appendChild( wrap );
		}

		// Append first so we can measure the menu's natural size, then
		// flip+clamp position into the viewport. WPDS' `Popover` would
		// handle this out of the box but is React-only at the moment
		// (per the #design-systems thread on 2026-04-21); the customizer
		// is vanilla ES modules with a strict bundle budget, so we
		// hand-roll the logic. DES-597.
		menu.style.position = 'fixed';
		menu.style.top = '0px';
		menu.style.left = '0px';
		menu.style.visibility = 'hidden';
		document.body.appendChild( menu );
		positionMenuRelativeTo( menu, trigger );
		menu.style.visibility = '';
		openMenu = { menuEl: menu, trigger };
		// Close on scroll / resize. Re-positioning while the user pans
		// would be jittery and click-outside already handles regular
		// dismissal. Scroll events on element targets don't bubble, so
		// register both on `window` (catches viewport scroll) and on the
		// sidebar (catches the customizer's internal #adminmenu scroll
		// from DES-578 sticky-footer mode).
		window.addEventListener( 'scroll', closeMenu, { passive: true } );
		sidebar.addEventListener( 'scroll', closeMenu, { passive: true } );
		window.addEventListener( 'resize', closeMenu, { passive: true } );
		const first = menu.querySelector( 'button' );
		if ( first ) {
			first.focus();
		}

		function commit( direction ) {
			// Drag-drop semantics, constrained to ±1 row. Move up / Move down
			// shifts the source by exactly one VISIBLE row in the sidebar,
			// crossing group / top-level boundaries naturally. Non-reassignable
			// neighbours (Dashboard, Tools, Settings, …) count as rows the
			// source can move past, but we never relocate them.
			//
			// Rows include each top-level LI plus each LI inside an expanded
			// group's children-UL. The group container LI itself is also a row
			// (its header takes a row of vertical space). When the move target
			// IS a group container LI:
			//   - Move down → source enters the group as the first child.
			//   - Move up   → source becomes a top-level sibling just above
			//                 the group container.
			const rows = collectRows( sidebar );
			const idx = rows.indexOf( li );
			const targetIdx = idx + direction;
			if ( idx === -1 || targetIdx < 0 || targetIdx >= rows.length ) {
				closeMenu();
				return;
			}
			const target = rows[ targetIdx ];
			if ( target.classList.contains( 'wp-admin-sidebar-group' ) ) {
				if ( direction > 0 ) {
					const childrenUl = target.querySelector( ':scope > .wp-admin-sidebar-group__children' );
					if ( ! childrenUl ) {
						closeMenu();
						return;
					}
					childrenUl.insertBefore( li, childrenUl.firstElementChild );
				} else {
					target.parentElement.insertBefore( li, target );
				}
			} else if ( direction > 0 ) {
				target.parentElement.insertBefore( li, target.nextElementSibling );
			} else {
				target.parentElement.insertBefore( li, target );
			}
			const newParent = li.parentElement;
			const newGroupContainer = newParent ? newParent.closest( 'li.wp-admin-sidebar-group' ) : null;
			const newGroupId = newGroupContainer ? newGroupContainer.getAttribute( 'data-group' ) : null;
			// Index against ALL <li> siblings, matching applyLayoutDelta's
			// replay semantics (grouping.js#applyLayoutDelta filters
			// `el.tagName === 'LI' && el !== li`). Inside a group's
			// __children UL the two bases coincide because every child is
			// reassignable, but at top-level core wp-admin items
			// (Dashboard, Tools, Settings, …) are interspersed — counting
			// only reassignable siblings would save an index that lands the
			// row several slots above the user's drop point on reload.
			// drag-drop.js uses the same all-children index; the menu path
			// was previously out of sync.
			const allLiSiblings = Array.from( newParent.children ).filter(
				( el ) => el.tagName === 'LI'
			);
			const newLocalIdx = allLiSiblings.indexOf( li );
			const position = newGroupId
				? { kind: 'in_group', group_id: newGroupId, index: newLocalIdx }
				: { kind: 'top_level', index: newLocalIdx };
			controller.commitMove( itemId, position );
			controller.announce(
				`Moved ${ trim( li ) } to position ${ targetIdx + 1 } of ${ rows.length }.`
			);
			closeMenu();
			trigger.focus();
		}

		function crossMove( position ) {
			let target;
			if ( position.kind === 'in_group' ) {
				const groupContainer = sidebar.querySelector(
					`li.wp-admin-sidebar-group[data-group="${ position.group_id }"] > .wp-admin-sidebar-group__children`
				);
				if ( ! groupContainer ) {
					closeMenu();
					return;
				}
				target = groupContainer;
				groupContainer.insertBefore( li, groupContainer.firstElementChild );
			} else {
				target = sidebar;
				sidebar.insertBefore( li, sidebar.firstElementChild );
			}
			controller.commitMove( itemId, position );
			controller.announce(
				`Moved ${ trim( li ) } to ${ position.kind === 'in_group' ? position.group_id : 'top level' }.`
			);
			closeMenu();
			trigger.focus();
		}

		function resetToDefault( liEl, idOfItem ) {
			// Remove the working override first so storage state stays in sync.
			controller.resetItem( idOfItem );
			// Find the item's baseline position from the navModel (the post-classifier,
			// pre-override layout). Snap the DOM back to that container at the
			// best-effort baseline slot. Other items' overrides stay where they are —
			// matching user expectation: "reset MY item, leave others alone."
			const baseline = findBaselinePosition( idOfItem );
			if ( ! baseline ) {
				controller.announce( 'Reset to default position.' );
				return;
			}
			let targetContainer;
			if ( baseline.groupId ) {
				targetContainer = sidebar.querySelector(
					`li.wp-admin-sidebar-group[data-group="${ baseline.groupId }"] > .wp-admin-sidebar-group__children`
				);
			} else {
				targetContainer = sidebar;
			}
			if ( ! targetContainer ) {
				controller.announce( 'Reset to default position.' );
				return;
			}
			const reassignableSiblings = Array.from( targetContainer.children ).filter(
				( el ) => el.tagName === 'LI' && el.classList.contains( 'wp-admin-sidebar-item--reassignable' )
			);
			const insertBeforeNode = reassignableSiblings[ baseline.index ] || null;
			targetContainer.insertBefore( liEl, insertBeforeNode );
			controller.announce( `Reset ${ trim( liEl ) } to default position.` );
		}

		function findBaselinePosition( idOfItem ) {
			for ( const group of navModel.groups || [] ) {
				const idx = ( group.children || [] ).findIndex( ( c ) => c.itemId === idOfItem );
				if ( idx !== -1 ) {
					return { groupId: group.id, index: idx };
				}
			}
			const topIdx = ( navModel.top_level || [] ).findIndex( ( c ) => c.itemId === idOfItem );
			if ( topIdx !== -1 ) {
				return { groupId: null, index: topIdx };
			}
			return null;
		}
	}

	function closeMenu() {
		if ( ! openMenu ) return;
		if ( openMenu.menuEl.parentNode ) {
			openMenu.menuEl.parentNode.removeChild( openMenu.menuEl );
		}
		openMenu = null;
		window.removeEventListener( 'scroll', closeMenu );
		sidebar.removeEventListener( 'scroll', closeMenu );
		window.removeEventListener( 'resize', closeMenu );
	}

	document.addEventListener( 'click', onClick, true );
	document.addEventListener( 'pointerdown', onPointerDown, true );
	document.addEventListener( 'keydown', onKeyDown );

	return function detach() {
		closeMenu();
		document.removeEventListener( 'click', onClick, true );
		document.removeEventListener( 'pointerdown', onPointerDown, true );
		document.removeEventListener( 'keydown', onKeyDown );
		const triggers = sidebar.querySelectorAll( '.' + TRIGGER_CLASS );
		for ( const t of triggers ) {
			t.parentNode && t.parentNode.removeChild( t );
		}
	};
}

/**
 * Build the ordered list of "rows" the customizer treats as one-step targets
 * for Move up / Move down. Document order, including:
 *
 *   - Each top-level LI in #adminmenu (core items, plugin items at top-level,
 *     and group container LIs themselves).
 *   - Each LI inside an expanded group's children-UL.
 *
 * The group container LI is included as a row because its header takes a row
 * of vertical space; the move handler treats it specially (Move down → enter
 * the group as first child; Move up → exit to top-level just before the
 * group). Other rows are leaf rows treated as drop-anchors.
 *
 * @param {HTMLElement} sidebar
 * @returns {HTMLLIElement[]}
 */
function collectRows( sidebar ) {
	const rows = [];
	for ( const child of sidebar.children ) {
		if ( child.tagName !== 'LI' ) continue;
		rows.push( child );
		if ( child.classList.contains( 'wp-admin-sidebar-group' ) ) {
			const childrenUl = child.querySelector( ':scope > .wp-admin-sidebar-group__children' );
			if ( childrenUl ) {
				for ( const inner of childrenUl.children ) {
					if ( inner.tagName === 'LI' ) {
						rows.push( inner );
					}
				}
			}
		}
	}
	return rows;
}

/**
 * Position a popover-style menu relative to its trigger, with flip + clamp.
 *
 * Strategy:
 *   1. Prefer below the trigger.
 *   2. If the natural menu height overflows the viewport bottom, flip above
 *      the trigger if there's enough room there.
 *   3. If neither side has enough room (extreme case), pick the side with
 *      the most room, clamp `max-height` to the available space, and let the
 *      menu scroll internally.
 *   4. Horizontally: keep the menu's left edge at the trigger's left when
 *      possible; if that overflows the viewport's right edge, shift left
 *      until it fits (or clamp at left = 0 on small viewports).
 *
 * The menu must already be in the DOM with `position: fixed` set; this
 * function only touches `top`, `left`, and (when clamping) `max-height` +
 * `overflow-y`.
 *
 * @param {HTMLElement} menu
 * @param {HTMLElement} trigger
 */
function positionMenuRelativeTo( menu, trigger ) {
	const triggerRect = trigger.getBoundingClientRect();
	const menuRect = menu.getBoundingClientRect();
	const viewportH = window.innerHeight;
	const viewportW = window.innerWidth;
	const margin = 4;
	const spaceBelow = viewportH - triggerRect.bottom - margin;
	const spaceAbove = triggerRect.top - margin;

	let top;
	let maxHeight = '';
	if ( menuRect.height <= spaceBelow ) {
		top = triggerRect.bottom + margin;
	} else if ( menuRect.height <= spaceAbove ) {
		top = triggerRect.top - menuRect.height - margin;
	} else if ( spaceBelow >= spaceAbove ) {
		top = triggerRect.bottom + margin;
		maxHeight = `${ Math.max( 0, Math.floor( spaceBelow ) ) }px`;
	} else {
		maxHeight = `${ Math.max( 0, Math.floor( spaceAbove ) ) }px`;
		top = triggerRect.top - parseInt( maxHeight, 10 ) - margin;
	}

	let left = triggerRect.left;
	const overflowRight = ( left + menuRect.width ) - ( viewportW - margin );
	if ( overflowRight > 0 ) {
		left = Math.max( margin, left - overflowRight );
	}

	menu.style.top = `${ Math.round( top ) }px`;
	menu.style.left = `${ Math.round( left ) }px`;
	if ( maxHeight ) {
		menu.style.maxHeight = maxHeight;
		menu.style.overflowY = 'auto';
	} else {
		menu.style.maxHeight = '';
		menu.style.overflowY = '';
	}
}

function injectTrigger( li ) {
	if ( li.querySelector( '.' + TRIGGER_CLASS ) ) {
		return;
	}
	const link = li.querySelector( ':scope > a' );
	if ( ! link ) {
		return;
	}
	// The more-options trigger lives INSIDE the link so wp-admin's natural
	// `<a>:hover` paints uniformly across grip + icon + label + more. A
	// `<span role="button" tabindex="0">` is used because nested interactive
	// elements (button-in-anchor) are invalid HTML; spans with role=button
	// are accessible AND legally inside an anchor. Click events bubble to
	// the link, but customizer.js suppresses anchor navigation so the link
	// click doesn't fire — only this trigger's onClick (handled in attachMoveMenu)
	// runs.
	const trigger = document.createElement( 'span' );
	trigger.className = TRIGGER_CLASS;
	trigger.setAttribute( 'role', 'button' );
	trigger.setAttribute( 'tabindex', '0' );
	trigger.setAttribute( 'aria-label', 'More options' );
	trigger.setAttribute( 'aria-haspopup', 'menu' );
	trigger.textContent = '⋯';
	link.appendChild( trigger );
}

function trim( li ) {
	const link = li.querySelector( ':scope > a' );
	return ( link ? link.textContent : li.textContent || '' ).trim();
}
