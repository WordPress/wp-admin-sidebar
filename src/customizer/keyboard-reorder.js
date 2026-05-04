/**
 * Within-container keyboard reorder.
 *
 * Tab focuses each grip handle. ArrowUp / ArrowDown swap the focused row with
 * its neighbour inside the current container. Cross-container moves are the
 * "Move to" menu's job (move-menu.js); kept disjoint per plan F8 disposition.
 *
 * Live-region announcements use a single shared `<output role="status">` that
 * the customizer entry point creates on enter.
 *
 * Contract reference: plan 04-interaction-spec.md (keyboard) and
 *                     plan 03-contracts.md § 8 (DOM shape).
 */

/**
 * Wire keyboard reorder on the sidebar.
 *
 * @param {HTMLElement} sidebar
 * @param {Object} controller     { commitMove(itemId, position), announce(msg) }
 * @returns {Function} detach
 */
export function attachKeyboardReorder( sidebar, controller ) {
	function onKeyDown( ev ) {
		if ( ev.key !== 'ArrowUp' && ev.key !== 'ArrowDown' ) {
			return;
		}
		const grip = ev.target instanceof Element ? ev.target.closest( '.wpcom-sidebar-item__grip' ) : null;
		if ( ! grip ) {
			return;
		}
		const li = grip.closest( 'li.wpcom-sidebar-item--reassignable' );
		const container = li && li.parentElement;
		if ( ! li || ! container ) {
			return;
		}
		ev.preventDefault();

		const direction = ev.key === 'ArrowUp' ? -1 : 1;
		const siblings = Array.from( container.children ).filter(
			( el ) => el.tagName === 'LI' && ! el.classList.contains( 'wpcom-sidebar-drop-indicator' )
		);
		const current = siblings.indexOf( li );
		const next = current + direction;
		if ( next < 0 || next >= siblings.length ) {
			return; // Boundary; ignore so focus doesn't jump elsewhere.
		}

		// Skip non-reassignable neighbours (e.g., post-adminmenu notices in
		// top-level). Walk in the chosen direction until we find a slot we can
		// actually swap into.
		let target = next;
		while ( target >= 0 && target < siblings.length ) {
			if ( siblings[ target ].classList.contains( 'wpcom-sidebar-item--reassignable' ) ) {
				break;
			}
			target += direction;
		}
		if ( target < 0 || target >= siblings.length ) {
			return;
		}

		const itemId = li.getAttribute( 'data-wpcom-item-id' );
		if ( ! itemId ) {
			return;
		}

		const groupContainer = container.closest( 'li.wpcom-sidebar-group' );
		const groupId = groupContainer ? groupContainer.getAttribute( 'data-group' ) : null;
		const position = groupId
			? { kind: 'in_group', group_id: groupId, index: target }
			: { kind: 'top_level', index: target };

		// Reorder the DOM in place so focus persists on the same <li>.
		const targetSibling = siblings[ target ];
		if ( direction < 0 ) {
			container.insertBefore( li, targetSibling );
		} else {
			container.insertBefore( li, targetSibling.nextElementSibling );
		}

		controller.commitMove( itemId, position );

		const total = siblings.length;
		const label = ( li.querySelector( ':scope > a' )?.textContent || itemId ).trim();
		controller.announce( `Moved ${ label } to position ${ target + 1 } of ${ total }.` );

		grip.focus();
	}

	sidebar.addEventListener( 'keydown', onKeyDown );
	return function detach() {
		sidebar.removeEventListener( 'keydown', onKeyDown );
	};
}
