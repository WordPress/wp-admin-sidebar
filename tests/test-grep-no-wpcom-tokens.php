<?php
/**
 * Grep-test gate.
 *
 * Fails the build if any token in the canonical WPCOM-only list appears under
 * /src/. The /src/ directory is the portable plugin source; host-specific
 * function calls or constants must live in a host adapter that hooks the
 * documented filter API (see docs/host-extension-api.md).
 *
 * Canonical token list — must stay in lockstep with the same test in the
 * Automattic/wpcom mu-plugin's tests/. The two files are byte-identical except
 * for the `$src_dir` line; cross-repo parity is enforced by a wpcom-side
 * weekly cron.
 *
 * Run: php tests/test-grep-no-wpcom-tokens.php
 * Exit code 0 = clean. Non-zero = at least one token found, build should fail.
 *
 * @package WP_Admin_Sidebar\Tests
 */

// CLI-only script: WordPress.Security.EscapeOutput is for HTML browser output, not stdout.
// phpcs:disable WordPress.Security.EscapeOutput.OutputNotEscaped, Squiz.Strings.DoubleQuoteUsage.NotRequired

$tokens = array(
	'calypso_preferences',
	'flush_cache_user_connected',
	'get_user_attribute',
	'IS_WPCOM',
	'is_woa_site',
	'is_wpcom_simple',
	'jetpack_connected_user_data',
	'show_unified_nav',
	'update_user_attribute',
	'wpcom_admin_interface',
);

$src_dir = dirname( __DIR__ ) . '/src';
if ( ! is_dir( $src_dir ) ) {
	fwrite( STDERR, "src dir not found: {$src_dir}\n" );
	exit( 2 );
}

$found = array();

$it = new RecursiveIteratorIterator( new RecursiveDirectoryIterator( $src_dir ) );
foreach ( $it as $file ) {
	if ( ! $file->isFile() ) {
		continue;
	}
	$ext = $file->getExtension();
	if ( 'php' !== $ext && 'js' !== $ext && 'ts' !== $ext && 'tsx' !== $ext && 'scss' !== $ext ) {
		continue;
	}
	$contents = file_get_contents( $file->getPathname() );
	if ( false === $contents ) {
		continue;
	}
	foreach ( $tokens as $token ) {
		if ( false !== strpos( $contents, $token ) ) {
			$found[] = array(
				'file'  => str_replace( dirname( __DIR__ ) . '/', '', $file->getPathname() ),
				'token' => $token,
			);
		}
	}
}

if ( ! empty( $found ) ) {
	echo "WPCOM-specific tokens leaked into /src/:\n\n";
	foreach ( $found as $hit ) {
		echo "  {$hit['file']} contains '{$hit['token']}'\n";
	}
	echo "\nFix: move the host-specific call into a host adapter plugin (see docs/host-extension-api.md) or behind the storage / gating filter interface.\n";
	exit( 1 );
}

echo "OK — no WPCOM-specific tokens in /src/. Token list checked: " . count( $tokens ) . " tokens.\n";
exit( 0 );
