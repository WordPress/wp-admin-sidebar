/**
 * grouping.test.js
 *
 * Pure-function and DOM-mutation tests for the grouping algorithm.
 * Run via `npm test` from the mu-plugin root.
 */

import { wrapIntoGroups, applyLayoutDelta, slugFromHref, inferSlug, slugCandidatesFromHref, inferSlugCandidates } from '../grouping.js';

describe( 'slugFromHref', () => {
	test( 'extracts page slug from admin.php?page=<slug>', () => {
		expect( slugFromHref( '/wp-admin/admin.php?page=jetpack' ) ).toBe( 'jetpack' );
		expect( slugFromHref( 'http://site.test/wp-admin/admin.php?page=woocommerce&tab=settings' ) ).toBe( 'woocommerce' );
	} );

	test( 'extracts core file slug from /wp-admin/<file>.php', () => {
		expect( slugFromHref( '/wp-admin/edit.php' ) ).toBe( 'edit.php' );
		expect( slugFromHref( '/wp-admin/edit.php?post_type=page' ) ).toBe( 'edit.php?post_type=page' );
		expect( slugFromHref( '/wp-admin/edit-comments.php' ) ).toBe( 'edit-comments.php' );
	} );

	test( 'returns null when href is empty or unrecognized', () => {
		expect( slugFromHref( '' ) ).toBeNull();
		expect( slugFromHref( '#' ) ).toBeNull();
		expect( slugFromHref( '/wp-admin/' ) ).toBeNull();
	} );
} );

describe( 'inferSlug', () => {
	test( 'reads toplevel_page_<slug> id format', () => {
		const li = document.createElement( 'li' );
		li.id = 'toplevel_page_jetpack';
		expect( inferSlug( li ) ).toBe( 'jetpack' );
	} );

	test( 'falls back to <a href> when id does not match the toplevel pattern', () => {
		const li = document.createElement( 'li' );
		li.id = 'menu-posts';
		li.innerHTML = '<a href="/wp-admin/edit.php"></a>';
		expect( inferSlug( li ) ).toBe( 'edit.php' );
	} );

	test( 'returns null when neither id nor link resolves', () => {
		const li = document.createElement( 'li' );
		expect( inferSlug( li ) ).toBeNull();
	} );
} );

describe( 'slugCandidatesFromHref', () => {
	test( 'relative href without /wp-admin/ prefix is captured as-is', () => {
		// WordPress sometimes generates relative hrefs (`edit.php?post_type=product`
		// for custom post types). The legacy slugFromHref returned null for these;
		// candidates picks them up.
		expect( slugCandidatesFromHref( 'edit.php?post_type=product' ) ).toContain( 'edit.php?post_type=product' );
	} );

	test( 'absolute /wp-admin/ href yields the admin-relative form', () => {
		expect( slugCandidatesFromHref( '/wp-admin/edit.php?post_type=product' ) ).toContain( 'edit.php?post_type=product' );
	} );

	test( 'fully-qualified URL is normalized down to admin-relative', () => {
		expect( slugCandidatesFromHref( 'https://site.test/wp-admin/admin.php?page=jetpack' ) ).toContain( 'admin.php?page=jetpack' );
	} );

	test( 'admin.php?page=<X> exposes the bare X candidate (matches simple plugin slugs)', () => {
		expect( slugCandidatesFromHref( '/wp-admin/admin.php?page=jetpack' ) ).toContain( 'jetpack' );
	} );

	test( 'WooCommerce-style query-string slug exposes the full post-?page= candidate', () => {
		// Payments-style: registered slug is the entire `wc-settings&tab=...&from=...` string.
		const href = '/wp-admin/admin.php?page=wc-settings&tab=checkout&from=PAYMENTS_MENU_ITEM';
		const candidates = slugCandidatesFromHref( href );
		expect( candidates ).toContain( 'wc-settings&tab=checkout&from=PAYMENTS_MENU_ITEM' );
	} );

	test( 'URL-encoded chars decode into a parallel candidate (Analytics-style path)', () => {
		// Analytics-style: `?page=wc-admin&path=/analytics/overview`. WP encodes
		// the `/`. The decoded form is what shows up in `$menu_item[2]`.
		const href = '/wp-admin/admin.php?page=wc-admin&path=%2Fanalytics%2Foverview';
		const candidates = slugCandidatesFromHref( href );
		expect( candidates ).toContain( 'wc-admin&path=/analytics/overview' );
	} );

	test( 'empty href returns no candidates', () => {
		expect( slugCandidatesFromHref( '' ) ).toEqual( [] );
	} );
} );

describe( 'inferSlugCandidates', () => {
	test( 'menu-posts-<post_type> id derives both id-based and href-based candidates', () => {
		const li = document.createElement( 'li' );
		li.id = 'menu-posts-product';
		li.innerHTML = '<a href="edit.php?post_type=product"></a>';
		const candidates = inferSlugCandidates( li );
		expect( candidates ).toContain( 'edit.php?post_type=product' );
	} );

	test( 'WC Payments-style id + href yields the registered slug as a candidate', () => {
		const li = document.createElement( 'li' );
		li.id = 'toplevel_page_admin-page-wc-settings-tab-checkout-from-PAYMENTS_MENU_ITEM';
		li.innerHTML = '<a href="/wp-admin/admin.php?page=wc-settings&tab=checkout&from=PAYMENTS_MENU_ITEM"></a>';
		const candidates = inferSlugCandidates( li );
		// The registered $menu_slug for Payments is the everything-after-page= form.
		expect( candidates ).toContain( 'wc-settings&tab=checkout&from=PAYMENTS_MENU_ITEM' );
	} );

	test( 'plain plugin top-level still produces the bare slug as the first candidate', () => {
		const li = document.createElement( 'li' );
		li.id = 'toplevel_page_jetpack';
		li.innerHTML = '<a href="/wp-admin/admin.php?page=jetpack"></a>';
		expect( inferSlugCandidates( li )[ 0 ] ).toBe( 'jetpack' );
	} );
} );

describe( 'wrapIntoGroups', () => {
	let sidebar;

	beforeEach( () => {
		sidebar = document.createElement( 'ul' );
		sidebar.id = 'adminmenu';
		document.body.innerHTML = '';
		document.body.appendChild( sidebar );
	} );

	function appendCoreItem( id, slugHref ) {
		const li = document.createElement( 'li' );
		li.id = id;
		li.classList.add( 'menu-top' );
		const a = document.createElement( 'a' );
		a.href = slugHref;
		a.textContent = id;
		li.appendChild( a );
		sidebar.appendChild( li );
		return li;
	}

	test( 'wraps classified plugin items into a single plugins group container', () => {
		const woo = appendCoreItem( 'toplevel_page_woocommerce', '/wp-admin/admin.php?page=woocommerce' );
		const jp  = appendCoreItem( 'toplevel_page_jetpack', '/wp-admin/admin.php?page=jetpack' );
		appendCoreItem( 'menu-posts', '/wp-admin/edit.php' );

		const navModel = {
			groups: [
				{
					id: 'plugins',
					title: 'Plugins',
					children: [
						{ itemId: 'plugin:woo:-:woocommerce', menuSlug: 'woocommerce' },
						{ itemId: 'plugin:jp:-:jetpack', menuSlug: 'jetpack' },
					],
				},
			],
			top_level: [],
		};

		const result = wrapIntoGroups( sidebar, navModel, null );

		// Container exists and carries the right data attributes.
		const container = sidebar.querySelector( '.wp-admin-sidebar-group[data-group="plugins"]' );
		expect( container ).not.toBeNull();
		expect( container.getAttribute( 'data-expanded' ) ).toBe( 'false' );

		// Both plugin items moved into the children list.
		const children = container.querySelector( '.wp-admin-sidebar-group__children' );
		expect( children.contains( woo ) ).toBe( true );
		expect( children.contains( jp ) ).toBe( true );

		// Items got tagged with the compound itemId + menu slug.
		expect( woo.getAttribute( 'data-wp-admin-sidebar-item-id' ) ).toBe( 'plugin:woo:-:woocommerce' );
		expect( woo.getAttribute( 'data-wp-admin-sidebar-menu-slug' ) ).toBe( 'woocommerce' );

		// The unclassified core item (menu-posts) stayed at top-level.
		const posts = sidebar.querySelector( '#menu-posts' );
		expect( posts.parentElement ).toBe( sidebar );

		// Result describes what was wrapped.
		expect( result.groups ).toHaveLength( 1 );
		expect( result.groups[ 0 ].id ).toBe( 'plugins' );
		expect( result.groups[ 0 ].items ).toHaveLength( 2 );
	} );

	test( 'does not insert a container when no items match the group children', () => {
		appendCoreItem( 'menu-posts', '/wp-admin/edit.php' );

		const navModel = {
			groups: [
				{
					id: 'plugins',
					title: 'Plugins',
					children: [
						{ itemId: 'plugin:nonexistent:-:nonexistent', menuSlug: 'nonexistent' },
					],
				},
			],
			top_level: [],
		};

		const result = wrapIntoGroups( sidebar, navModel, null );

		expect( sidebar.querySelector( '.wp-admin-sidebar-group' ) ).toBeNull();
		expect( result.groups ).toHaveLength( 0 );
	} );

	test( 'group header carries toggle, customize, and chevron as siblings in left-to-right order on plugins', () => {
		appendCoreItem( 'toplevel_page_woocommerce', '/wp-admin/admin.php?page=woocommerce' );

		const navModel = {
			groups: [
				{
					id: 'plugins',
					title: 'Plugins',
					children: [
						{ itemId: 'plugin:woo:-:woocommerce', menuSlug: 'woocommerce' },
					],
				},
			],
			top_level: [],
		};

		wrapIntoGroups( sidebar, navModel, null );

		const header = sidebar.querySelector( '.wp-admin-sidebar-group__header' );
		const toggle = header.querySelector( ':scope > .wp-admin-sidebar-group__toggle' );
		const customize = header.querySelector( ':scope > .wp-admin-sidebar-group__customize' );
		const chevron = header.querySelector( ':scope > .wp-admin-sidebar-group__chevron' );

		// All three are direct children of the header (siblings, not nested).
		expect( toggle ).not.toBeNull();
		expect( customize ).not.toBeNull();
		expect( chevron ).not.toBeNull();
		expect( toggle.parentElement ).toBe( header );
		expect( customize.parentElement ).toBe( header );
		expect( chevron.parentElement ).toBe( header );

		// Chevron is no longer nested inside the toggle button.
		expect( toggle.querySelector( '.wp-admin-sidebar-group__chevron' ) ).toBeNull();

		// Visual order: toggle → customize → chevron (DES-587).
		const orderedChildren = Array.from( header.children );
		expect( orderedChildren.indexOf( toggle ) ).toBe( 0 );
		expect( orderedChildren.indexOf( customize ) ).toBe( 1 );
		expect( orderedChildren.indexOf( chevron ) ).toBe( 2 );

		// Chevron is decorative; toggle remains the click target.
		expect( chevron.getAttribute( 'aria-hidden' ) ).toBe( 'true' );

		// aria-expanded matches the initial collapsed state.
		expect( toggle.getAttribute( 'aria-expanded' ) ).toBe( 'false' );
		expect( toggle.getAttribute( 'aria-controls' ) ).toBe( 'wp-admin-sidebar-group-plugins' );

		// Customize button is inert until A.2 wires the handler.
		expect( customize.disabled ).toBe( true );
	} );

	test( 'non-plugins group does not render a customize button', () => {
		appendCoreItem( 'toplevel_page_thing', '/wp-admin/admin.php?page=thing' );

		const navModel = {
			groups: [
				{
					id: 'tools',
					title: 'Tools',
					children: [
						{ itemId: 'plugin:thing:-:thing', menuSlug: 'thing' },
					],
				},
			],
			top_level: [],
		};

		wrapIntoGroups( sidebar, navModel, null );

		const customize = sidebar.querySelector( '.wp-admin-sidebar-group[data-group="tools"] .wp-admin-sidebar-group__customize' );
		expect( customize ).toBeNull();
	} );
} );

describe( 'applyLayoutDelta', () => {
	let sidebar;

	beforeEach( () => {
		sidebar = document.createElement( 'ul' );
		sidebar.id = 'adminmenu';
		document.body.innerHTML = '';
		document.body.appendChild( sidebar );
	} );

	function appendCoreItem( id, slugHref ) {
		const li = document.createElement( 'li' );
		li.id = id;
		li.classList.add( 'menu-top' );
		const a = document.createElement( 'a' );
		a.href = slugHref;
		a.textContent = id;
		li.appendChild( a );
		sidebar.appendChild( li );
		return li;
	}

	function setup() {
		appendCoreItem( 'toplevel_page_woocommerce', '/wp-admin/admin.php?page=woocommerce' );
		appendCoreItem( 'toplevel_page_jetpack', '/wp-admin/admin.php?page=jetpack' );
		appendCoreItem( 'toplevel_page_wpseo_dashboard', '/wp-admin/admin.php?page=wpseo_dashboard' );
		appendCoreItem( 'menu-posts', '/wp-admin/edit.php' ); // unclassified, stays at top-level

		const navModel = {
			groups: [
				{
					id: 'plugins',
					title: 'Plugins',
					children: [
						{ itemId: 'plugin:unknown:-:woocommerce', menuSlug: 'woocommerce' },
						{ itemId: 'plugin:unknown:-:jetpack', menuSlug: 'jetpack' },
						{ itemId: 'plugin:unknown:-:wpseo_dashboard', menuSlug: 'wpseo_dashboard' },
					],
				},
			],
			top_level: [],
		};
		wrapIntoGroups( sidebar, navModel, null );
		return navModel;
	}

	test( 'no-op on empty delta', () => {
		setup();
		const result = applyLayoutDelta( sidebar, { version: 1, updated_at: 0, overrides: [] } );
		expect( result.applied ).toBe( 0 );
		expect( result.skipped ).toBe( 0 );
	} );

	test( 'no-op when delta is null', () => {
		setup();
		const result = applyLayoutDelta( sidebar, null );
		expect( result.applied ).toBe( 0 );
	} );

	test( 'in_group reorder: jetpack moves to index 0 within plugins', () => {
		setup();
		const result = applyLayoutDelta( sidebar, {
			version: 1,
			updated_at: 0,
			overrides: [
				{ itemId: 'plugin:unknown:-:jetpack', position: { kind: 'in_group', group_id: 'plugins', index: 0 } },
			],
		} );
		expect( result.applied ).toBe( 1 );
		const children = sidebar.querySelectorAll( '.wp-admin-sidebar-group[data-group="plugins"] .wp-admin-sidebar-group__children > li' );
		const ids = Array.from( children ).map( ( li ) => li.getAttribute( 'data-wp-admin-sidebar-menu-slug' ) );
		expect( ids[ 0 ] ).toBe( 'jetpack' );
	} );

	test( 'top_level promotion: jetpack lands at index 0 in sidebar root', () => {
		setup();
		applyLayoutDelta( sidebar, {
			version: 1,
			updated_at: 0,
			overrides: [
				{ itemId: 'plugin:unknown:-:jetpack', position: { kind: 'top_level', index: 0 } },
			],
		} );
		const firstChild = sidebar.firstElementChild;
		expect( firstChild.getAttribute( 'data-wp-admin-sidebar-menu-slug' ) ).toBe( 'jetpack' );
	} );

	test( 'index out of range clamps to end of container', () => {
		setup();
		applyLayoutDelta( sidebar, {
			version: 1,
			updated_at: 0,
			overrides: [
				{ itemId: 'plugin:unknown:-:jetpack', position: { kind: 'in_group', group_id: 'plugins', index: 99 } },
			],
		} );
		const children = sidebar.querySelectorAll( '.wp-admin-sidebar-group[data-group="plugins"] .wp-admin-sidebar-group__children > li' );
		const last = children[ children.length - 1 ];
		expect( last.getAttribute( 'data-wp-admin-sidebar-menu-slug' ) ).toBe( 'jetpack' );
	} );

	test( 'stale itemId is silently skipped, real ones still apply', () => {
		setup();
		const result = applyLayoutDelta( sidebar, {
			version: 1,
			updated_at: 0,
			overrides: [
				{ itemId: 'plugin:gone:-:retired-plugin', position: { kind: 'top_level', index: 0 } },
				{ itemId: 'plugin:unknown:-:jetpack', position: { kind: 'in_group', group_id: 'plugins', index: 0 } },
			],
		} );
		expect( result.applied ).toBe( 1 );
		expect( result.skipped ).toBe( 1 );
		const children = sidebar.querySelectorAll( '.wp-admin-sidebar-group[data-group="plugins"] .wp-admin-sidebar-group__children > li' );
		expect( children[ 0 ].getAttribute( 'data-wp-admin-sidebar-menu-slug' ) ).toBe( 'jetpack' );
	} );

	test( 'unknown group_id is silently skipped (registry-data evolved away from a saved override)', () => {
		setup();
		const result = applyLayoutDelta( sidebar, {
			version: 1,
			updated_at: 0,
			overrides: [
				{ itemId: 'plugin:unknown:-:jetpack', position: { kind: 'in_group', group_id: 'no-such-group', index: 0 } },
			],
		} );
		expect( result.applied ).toBe( 0 );
		expect( result.skipped ).toBe( 1 );
	} );

	test( 'multiple overrides apply in delta order', () => {
		setup();
		applyLayoutDelta( sidebar, {
			version: 1,
			updated_at: 0,
			overrides: [
				{ itemId: 'plugin:unknown:-:wpseo_dashboard', position: { kind: 'in_group', group_id: 'plugins', index: 0 } },
				{ itemId: 'plugin:unknown:-:jetpack', position: { kind: 'in_group', group_id: 'plugins', index: 0 } },
			],
		} );
		const children = sidebar.querySelectorAll( '.wp-admin-sidebar-group[data-group="plugins"] .wp-admin-sidebar-group__children > li' );
		const ids = Array.from( children ).map( ( li ) => li.getAttribute( 'data-wp-admin-sidebar-menu-slug' ) );
		// jetpack inserted at 0 last, so it ends up at 0; wpseo, which was at 0
		// before the second override ran, gets pushed to 1.
		expect( ids[ 0 ] ).toBe( 'jetpack' );
		expect( ids[ 1 ] ).toBe( 'wpseo_dashboard' );
	} );
} );
