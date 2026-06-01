/**
 * Helpers for WordPress admin-menu SVG background icons.
 *
 * WordPress core's svg-painter handles `div.wp-menu-image.svg` by rewriting
 * its inline base64 `background-image`. CSS cannot reliably override that
 * repaint, so the sidebar uses these helpers when a redesigned or customize
 * state needs one fixed icon color.
 */

/**
 * Paint every matching SVG background icon under a root element.
 *
 * @param {ParentNode} root
 * @param {string} selector
 * @param {string} color CSS color, for example `#f0f0f1` or `rgb(240, 240, 241)`.
 */
export function paintSvgIcons( root, selector, color ) {
	for ( const icon of root.querySelectorAll( selector ) ) {
		paintSvgIcon( icon, color );
	}
}

/**
 * Paint one base64 SVG background icon.
 *
 * @param {Element} icon
 * @param {string} color CSS color, for example `#f0f0f1` or `rgb(240, 240, 241)`.
 */
export function paintSvgIcon( icon, color ) {
	const paintColor = normalizeSvgColor( color );
	if ( ! ( icon instanceof HTMLElement ) || ! paintColor ) {
		return;
	}

	rememberOriginalSvgIcon( icon );

	const cacheKey = `wpAdminSidebarSvg${ paintColor.replace( /[^a-f0-9]/gi, '' ) }`;
	let encoded = icon.dataset[ cacheKey ];
	if ( ! encoded ) {
		const background = window.getComputedStyle( icon ).backgroundImage || '';
		const match = background.match( /data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/ );
		if ( ! match || ! match[ 1 ] ) {
			return;
		}

		let xml;
		try {
			xml = window.atob( match[ 1 ] );
		} catch ( _ ) {
			return;
		}

		xml = paintSvgXml( xml, paintColor );

		try {
			encoded = window.btoa( xml );
		} catch ( _ ) {
			return;
		}
		icon.dataset[ cacheKey ] = encoded;
	}

	icon.style.setProperty(
		'background-image',
		`url("data:image/svg+xml;base64,${ encoded }")`,
		'important'
	);
}

/**
 * Restore matching SVG icons to the color WordPress core would currently use.
 *
 * @param {ParentNode} root
 * @param {string} selector
 */
export function restoreCoreSvgIcons( root, selector ) {
	const painter = window.wp && window.wp.svgPainter;
	const jq = window.jQuery;

	for ( const icon of root.querySelectorAll( selector ) ) {
		restoreOriginalSvgIcon( icon );

		if ( ! painter || typeof painter.paintElement !== 'function' || typeof jq !== 'function' ) {
			continue;
		}

		const li = icon.closest( 'li.menu-top' );
		let colorType = 'base';
		if ( li && ( li.classList.contains( 'current' ) || li.classList.contains( 'wp-has-current-submenu' ) ) ) {
			colorType = 'current';
		} else if (
			li &&
			( li.matches( ':hover' ) ||
				li.classList.contains( 'opensub' ) ||
				!! li.querySelector( ':scope > a:focus' ) )
		) {
			colorType = 'focus';
		}
		painter.paintElement( jq( icon ), colorType );
	}
}

function rememberOriginalSvgIcon( icon ) {
	if ( icon.dataset.wpAdminSidebarSvgOriginalSet ) {
		return;
	}

	icon.dataset.wpAdminSidebarSvgOriginalSet = '1';

	const backgroundImage = icon.style.getPropertyValue( 'background-image' );
	if ( backgroundImage ) {
		icon.dataset.wpAdminSidebarSvgOriginalBackgroundImage = backgroundImage;
	}

	const priority = icon.style.getPropertyPriority( 'background-image' );
	if ( priority ) {
		icon.dataset.wpAdminSidebarSvgOriginalBackgroundPriority = priority;
	}
}

function restoreOriginalSvgIcon( icon ) {
	if ( ! ( icon instanceof HTMLElement ) || ! icon.dataset.wpAdminSidebarSvgOriginalSet ) {
		return;
	}

	if ( icon.dataset.wpAdminSidebarSvgOriginalBackgroundImage ) {
		icon.style.setProperty(
			'background-image',
			icon.dataset.wpAdminSidebarSvgOriginalBackgroundImage,
			icon.dataset.wpAdminSidebarSvgOriginalBackgroundPriority || ''
		);
	} else {
		icon.style.removeProperty( 'background-image' );
	}

	delete icon.dataset.wpAdminSidebarSvgOriginalSet;
	delete icon.dataset.wpAdminSidebarSvgOriginalBackgroundImage;
	delete icon.dataset.wpAdminSidebarSvgOriginalBackgroundPriority;
}

function paintSvgXml( xml, color ) {
	return xml
		.replace( /fill=(["'])[^"']*\1/g, function replaceFillAttribute( _match, quote ) {
			return `fill=${ quote }${ color }${ quote }`;
		} )
		.replace( /style=(["'])(.*?)\1/g, function replaceStyle( _match, quote, value ) {
			let style = value;
			if ( /fill\s*:/.test( style ) ) {
				style = style.replace( /fill\s*:\s*[^;]+;?/g, `fill:${ color };` );
			} else {
				style = `${ style.replace( /\s*$/, '' ) };fill:${ color };`;
			}
			return `style=${ quote }${ style }${ quote }`;
		} );
}

function normalizeSvgColor( color ) {
	if ( typeof color !== 'string' ) {
		return null;
	}

	const trimmed = color.trim();
	if ( /^(#[0-9a-f]{3}|#[0-9a-f]{6})$/i.test( trimmed ) ) {
		return trimmed;
	}

	const rgb = trimmed.match( /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*[0-9.]+)?\s*\)$/i );
	if ( ! rgb ) {
		return null;
	}

	return (
		'#' +
		[ rgb[ 1 ], rgb[ 2 ], rgb[ 3 ] ]
			.map( function toHex( value ) {
				return Math.max( 0, Math.min( 255, Math.round( Number.parseFloat( value ) ) ) )
					.toString( 16 )
					.padStart( 2, '0' );
			} )
			.join( '' )
	);
}
