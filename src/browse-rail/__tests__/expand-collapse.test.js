/**
 * expand-collapse.test.js
 *
 * Pure-function tests for the expand/collapse decision logic + storage round-trip.
 * Run via `npm test`.
 */

import {
	decideInitialState,
	findAutoExpandGroup,
	applyState,
	applyExpandCollapse,
} from '../expand-collapse.js';

describe( 'decideInitialState', () => {
	test( 'auto-expand group wins regardless of stored state', () => {
		expect( decideInitialState( 'plugins', { plugins: false }, 'plugins' ) ).toBe( true );
		expect( decideInitialState( 'plugins', {}, 'plugins' ) ).toBe( true );
	} );

	test( 'stored state used when no auto-expand', () => {
		expect( decideInitialState( 'plugins', { plugins: true }, null ) ).toBe( true );
		expect( decideInitialState( 'plugins', { plugins: false }, null ) ).toBe( false );
	} );

	test( 'defaults to expanded for `plugins` and collapsed otherwise when nothing matches', () => {
		expect( decideInitialState( 'plugins', {}, null ) ).toBe( true );
		expect( decideInitialState( 'tools', {}, null ) ).toBe( false );
		expect( decideInitialState( 'tools', { plugins: true }, 'plugins' ) ).toBe( false );
	} );

	test( 'stored collapsed state for `plugins` overrides the default-expand', () => {
		expect( decideInitialState( 'plugins', { plugins: false }, null ) ).toBe( false );
	} );
} );

describe( 'findAutoExpandGroup', () => {
	const navModel = {
		groups: [
			{
				id: 'plugins',
				children: [
					{ menuSlug: 'woocommerce' },
					{ menuSlug: 'jetpack' },
				],
			},
			{
				id: 'tools',
				children: [
					{ menuSlug: 'tools.php' },
				],
			},
		],
	};

	test( 'returns group id when any child slug appears in the URL', () => {
		expect( findAutoExpandGroup( navModel, '/wp-admin/admin.php?page=woocommerce' ) ).toBe( 'plugins' );
		expect( findAutoExpandGroup( navModel, '/wp-admin/admin.php?page=jetpack&tab=foo' ) ).toBe( 'plugins' );
		expect( findAutoExpandGroup( navModel, '/wp-admin/tools.php' ) ).toBe( 'tools' );
	} );

	test( 'returns null when no child slug matches', () => {
		expect( findAutoExpandGroup( navModel, '/wp-admin/edit.php' ) ).toBeNull();
		expect( findAutoExpandGroup( { groups: [] }, '/wp-admin/edit.php' ) ).toBeNull();
	} );
} );

describe( 'applyState', () => {
	test( 'mutates data-expanded and aria-expanded on the toggle', () => {
		const groupEl = document.createElement( 'li' );
		groupEl.classList.add( 'wp-admin-sidebar-group' );
		groupEl.innerHTML = '<button type="button" class="wp-admin-sidebar-group__toggle" aria-expanded="false"></button>';

		applyState( groupEl, true );
		expect( groupEl.getAttribute( 'data-expanded' ) ).toBe( 'true' );
		expect( groupEl.querySelector( '.wp-admin-sidebar-group__toggle' ).getAttribute( 'aria-expanded' ) ).toBe( 'true' );

		applyState( groupEl, false );
		expect( groupEl.getAttribute( 'data-expanded' ) ).toBe( 'false' );
		expect( groupEl.querySelector( '.wp-admin-sidebar-group__toggle' ).getAttribute( 'aria-expanded' ) ).toBe( 'false' );
	} );
} );

describe( 'applyExpandCollapse — sessionStorage round-trip', () => {
	beforeEach( () => {
		window.sessionStorage.clear();
	} );

	function buildSidebarWithGroup( groupId ) {
		const sidebar = document.createElement( 'ul' );
		sidebar.id = 'adminmenu';
		const groupEl = document.createElement( 'li' );
		groupEl.classList.add( 'wp-admin-sidebar-group' );
		groupEl.setAttribute( 'data-group', groupId );
		groupEl.setAttribute( 'data-expanded', 'false' );
		groupEl.innerHTML = `
			<div class="wp-admin-sidebar-group__header">
				<button type="button" class="wp-admin-sidebar-group__toggle" aria-expanded="false"></button>
			</div>
			<ul class="wp-admin-sidebar-group__children" id="wp-admin-sidebar-group-${ groupId }"></ul>
		`;
		sidebar.appendChild( groupEl );
		document.body.innerHTML = '';
		document.body.appendChild( sidebar );
		return { sidebar, groupEl };
	}

	test( 'group toggles on click and persists state to sessionStorage', () => {
		const { sidebar, groupEl } = buildSidebarWithGroup( 'plugins' );
		const navModel = { groups: [ { id: 'plugins', children: [] } ], top_level: [] };

		applyExpandCollapse( sidebar, navModel, { currentUrl: '/wp-admin/edit.php', siteId: 42 } );

		// `plugins` defaults to expanded; nothing in storage yet.
		expect( groupEl.getAttribute( 'data-expanded' ) ).toBe( 'true' );
		expect( window.sessionStorage.getItem( 'wp-admin-sidebar:groups:42' ) ).toBeNull();

		// Click to collapse.
		groupEl.querySelector( '.wp-admin-sidebar-group__toggle' ).click();
		expect( groupEl.getAttribute( 'data-expanded' ) ).toBe( 'false' );

		// Storage carries the new state, scoped per site.
		const stored = JSON.parse( window.sessionStorage.getItem( 'wp-admin-sidebar:groups:42' ) );
		expect( stored ).toEqual( { plugins: false } );
	} );

	test( 'auto-expand wins over stored collapsed state', () => {
		const { sidebar, groupEl } = buildSidebarWithGroup( 'plugins' );
		// Pre-seed sessionStorage with collapsed state.
		window.sessionStorage.setItem( 'wp-admin-sidebar:groups:42', JSON.stringify( { plugins: false } ) );

		const navModel = {
			groups: [
				{
					id: 'plugins',
					children: [ { menuSlug: 'woocommerce' } ],
				},
			],
			top_level: [],
		};

		applyExpandCollapse( sidebar, navModel, {
			currentUrl: '/wp-admin/admin.php?page=woocommerce',
			siteId: 42,
		} );

		// auto-expand wins.
		expect( groupEl.getAttribute( 'data-expanded' ) ).toBe( 'true' );
	} );

	test( 'per-site isolation in storage keying', () => {
		const { sidebar } = buildSidebarWithGroup( 'plugins' );
		const navModel = { groups: [ { id: 'plugins', children: [] } ], top_level: [] };

		// Site 1: toggle the (default-expanded) plugins group to collapse it.
		applyExpandCollapse( sidebar, navModel, { currentUrl: '/wp-admin/edit.php', siteId: 1 } );
		sidebar.querySelector( '.wp-admin-sidebar-group__toggle' ).click();

		// Site 2: should not see Site 1's state.
		const site2 = JSON.parse( window.sessionStorage.getItem( 'wp-admin-sidebar:groups:2' ) || 'null' );
		const site1 = JSON.parse( window.sessionStorage.getItem( 'wp-admin-sidebar:groups:1' ) );
		expect( site1 ).toEqual( { plugins: false } );
		expect( site2 ).toBeNull();
	} );
} );
