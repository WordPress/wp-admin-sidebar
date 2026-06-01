/**
 * Confirmation modal for the global "Reset all to default" action.
 *
 * Built on the core `@wordpress/components` Modal (exposed as `wp.components`)
 * + `@wordpress/element` (`wp.element`). The host page enqueues `wp-components`
 * and `wp-element` (see wp-admin-sidebar.php) so these globals are present by
 * the time the deferred customizer module runs. No JSX — `wp.element.createElement`
 * is aliased to `el`.
 *
 * If core components are somehow unavailable, falls back to a native confirm()
 * so the action still works.
 */

const TITLE = 'Reset all to default?';
const BODY =
	'This restores the default order and grouping for every item in the sidebar. ' +
	'Your current customizations will be removed.';
const FALLBACK_CONFIRM = 'Reset all sidebar items to their default positions?';

/**
 * Open the reset-all confirmation modal.
 *
 * @param {Object}   options
 * @param {Function} options.onConfirm Invoked when the user confirms the reset.
 */
export function openResetAllModal( { onConfirm } ) {
	const wp = typeof window !== 'undefined' ? window.wp : null;

	if ( ! wp || ! wp.element || ! wp.components || ! wp.components.Modal ) {
		// Core components missing — degrade to a native confirm rather than
		// silently dropping the action.
		if ( typeof window !== 'undefined' && typeof window.confirm === 'function' ) {
			if ( window.confirm( FALLBACK_CONFIRM ) ) {
				onConfirm();
			}
			return;
		}
		onConfirm();
		return;
	}

	const { createElement: el, createRoot, render } = wp.element;
	const { Modal, Button } = wp.components;

	const container = document.createElement( 'div' );
	container.className = 'wp-admin-sidebar-reset-all-modal-root';
	document.body.appendChild( container );

	let root = null;
	let torndown = false;
	const teardown = () => {
		if ( torndown ) {
			return;
		}
		torndown = true;
		if ( root && typeof root.unmount === 'function' ) {
			root.unmount();
		} else if ( typeof render === 'function' ) {
			render( null, container );
		}
		if ( container.parentNode ) {
			container.parentNode.removeChild( container );
		}
	};
	// Defer teardown a frame so the Modal's own close handling settles before
	// the React root is unmounted.
	const close = () => window.requestAnimationFrame( teardown );

	const tree = el(
		Modal,
		{
			title: TITLE,
			className: 'wp-admin-sidebar-reset-all-modal',
			size: 'small',
			onRequestClose: close,
		},
		el( 'p', { className: 'wp-admin-sidebar-reset-all-modal__body' }, BODY ),
		el(
			'div',
			{ className: 'wp-admin-sidebar-reset-all-modal__actions' },
			el( Button, { variant: 'tertiary', onClick: close }, 'Cancel' ),
			el(
				Button,
				{
					variant: 'primary',
					onClick: () => {
						onConfirm();
						close();
					},
				},
				'Reset all'
			)
		)
	);

	if ( typeof createRoot === 'function' ) {
		root = createRoot( container );
		root.render( tree );
	} else if ( typeof render === 'function' ) {
		render( tree, container );
	}
}
