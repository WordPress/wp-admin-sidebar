/**
 * Customizer draft-state machine.
 *
 * Pure-ish data layer: holds the baseline NavModel snapshot, the saved
 * LayoutDelta from the server, and the working copy the user is mutating.
 * Mutations return new objects (cheap structural copies) so the caller can
 * compare references for `isDirty`.
 *
 * Contract reference: plan 03-contracts.md § 3 (LayoutDelta) and § 7
 * (CustomizerDraftState).
 *
 * @typedef {Object} Position
 * @property {'top_level'|'in_group'} kind
 * @property {string} [group_id]
 * @property {number} index
 *
 * @typedef {Object} Override
 * @property {string} itemId
 * @property {Position} position
 *
 * @typedef {Object} LayoutDelta
 * @property {number} version
 * @property {number} updated_at
 * @property {Override[]} overrides
 *
 * @typedef {Object} DraftState
 * @property {Object} baseline
 * @property {LayoutDelta} savedDelta
 * @property {LayoutDelta} workingDelta
 * @property {boolean} isDirty
 * @property {boolean} isSaving
 * @property {{code: string, message: string}|null} saveError
 * @property {{itemId: string, sourcePosition: Position}|null} activeDrag
 */

/**
 * @returns {LayoutDelta}
 */
export function emptyDelta() {
	return { version: 1, updated_at: 0, overrides: [] };
}

/**
 * Build the initial draft state from the inline payload.
 *
 * @param {Object} navModel
 * @param {LayoutDelta|null} savedDelta
 * @returns {DraftState}
 */
export function createState( navModel, savedDelta ) {
	const saved = savedDelta && Array.isArray( savedDelta.overrides ) ? cloneDelta( savedDelta ) : emptyDelta();
	return {
		baseline: navModel,
		savedDelta: saved,
		workingDelta: cloneDelta( saved ),
		isDirty: false,
		isSaving: false,
		saveError: null,
		activeDrag: null,
	};
}

/**
 * Deep-ish clone for a LayoutDelta. Overrides are flat objects; structuredClone
 * would also work but isn't worth requiring everywhere.
 *
 * @param {LayoutDelta} d
 * @returns {LayoutDelta}
 */
export function cloneDelta( d ) {
	return {
		version: d.version,
		updated_at: d.updated_at,
		overrides: d.overrides.map( ( o ) => ( {
			itemId: o.itemId,
			position: { ...o.position },
		} ) ),
	};
}

/**
 * Equality check on two deltas. Order matters — overrides are an ordered list.
 *
 * @param {LayoutDelta} a
 * @param {LayoutDelta} b
 * @returns {boolean}
 */
export function deltasEqual( a, b ) {
	if ( a.overrides.length !== b.overrides.length ) {
		return false;
	}
	for ( let i = 0; i < a.overrides.length; i++ ) {
		const x = a.overrides[ i ];
		const y = b.overrides[ i ];
		if ( x.itemId !== y.itemId ) {
			return false;
		}
		if ( x.position.kind !== y.position.kind ) {
			return false;
		}
		if ( x.position.index !== y.position.index ) {
			return false;
		}
		if ( x.position.kind === 'in_group' && x.position.group_id !== y.position.group_id ) {
			return false;
		}
	}
	return true;
}

/**
 * Compute isDirty by comparing working vs saved.
 *
 * @param {DraftState} state
 * @returns {DraftState}
 */
export function recomputeDirty( state ) {
	return { ...state, isDirty: ! deltasEqual( state.workingDelta, state.savedDelta ) };
}

/**
 * Replace the saved delta after an auto-save response without changing the
 * current working delta. If the user made another move while the request was
 * in flight, the working copy stays ahead and remains dirty.
 *
 * @param {DraftState} state
 * @param {LayoutDelta} saved
 * @returns {DraftState}
 */
export function updateSaved( state, saved ) {
	const cloned = cloneDelta( saved );
	return recomputeDirty( {
		...state,
		savedDelta: cloned,
		isSaving: false,
		saveError: null,
	} );
}

/**
 * Restore the working delta to a previous snapshot, used by Undo.
 *
 * @param {DraftState} state
 * @param {LayoutDelta} working
 * @returns {DraftState}
 */
export function restoreWorking( state, working ) {
	return recomputeDirty( {
		...state,
		workingDelta: cloneDelta( working ),
		saveError: null,
	} );
}

/**
 * Move an item to a new position. Removes any prior override for the same
 * itemId, then appends the new one. The renderer applies overrides in array
 * order, with later overrides winning if duplicates ever sneak in.
 *
 * @param {DraftState} state
 * @param {string} itemId
 * @param {Position} position
 * @returns {DraftState}
 */
export function moveItem( state, itemId, position ) {
	const overrides = state.workingDelta.overrides.filter( ( o ) => o.itemId !== itemId );
	overrides.push( { itemId, position: { ...position } } );
	const next = { ...state, workingDelta: { ...state.workingDelta, overrides } };
	return recomputeDirty( next );
}

/**
 * Drop an override (revert one item to its default position).
 *
 * @param {DraftState} state
 * @param {string} itemId
 * @returns {DraftState}
 */
export function resetItem( state, itemId ) {
	const overrides = state.workingDelta.overrides.filter( ( o ) => o.itemId !== itemId );
	return recomputeDirty( { ...state, workingDelta: { ...state.workingDelta, overrides } } );
}

/**
 * Mark the start of a drag. Does not mutate the delta.
 *
 * @param {DraftState} state
 * @param {string} itemId
 * @param {Position} sourcePosition
 * @returns {DraftState}
 */
export function beginDrag( state, itemId, sourcePosition ) {
	return { ...state, activeDrag: { itemId, sourcePosition } };
}

/**
 * @param {DraftState} state
 * @returns {DraftState}
 */
export function endDrag( state ) {
	return { ...state, activeDrag: null };
}

/**
 * Replace the saved delta and reset working to match. Called after a
 * successful POST so subsequent edits compute isDirty against the new server
 * truth.
 *
 * @param {DraftState} state
 * @param {LayoutDelta} saved
 * @returns {DraftState}
 */
export function applySaved( state, saved ) {
	const cloned = cloneDelta( saved );
	return {
		...state,
		savedDelta: cloned,
		workingDelta: cloneDelta( cloned ),
		isDirty: false,
		isSaving: false,
		saveError: null,
	};
}
