// Fixes the iOS "call to consteval function 'fmt::basic_format_string...' is not
// a constant expression" build failure.
//
// React Native 0.76 (Expo SDK 52) vendors {fmt} 11.0.2, whose compile-time
// format-string checking uses C++20 `consteval`. Xcode 26.4 (Apple Clang 21,
// EAS `latest` image) enforces consteval strictly and rejects fmt's own sources
// (fmt/format-inl.h), breaking `pod install`-from-source builds.
//
// fmt 11's `base.h` UNCONDITIONALLY recomputes FMT_USE_CONSTEVAL from a
// #if/#elif compiler-feature chain (it is NOT wrapped in #ifndef), so an
// external -DFMT_USE_CONSTEVAL=0 is ignored — on Clang 21 __cpp_consteval is
// defined and the header forces FMT_USE_CONSTEVAL 1. The only reliable fix is to
// rewrite the vendored header so the macro resolves to 0, which makes
// FMT_CONSTEVAL expand to nothing for every consumer (fmt, RCT-Folly,
// React-Core). This only moves fmt's (always-valid) format-string validation
// from compile time to runtime — no behavioral impact — and is durable on the
// latest Xcode, unlike pinning an older EAS image.
//
// Runs in the Podfile post_install hook so it re-applies on every `pod install`
// (prebuild / run:ios / EAS), after CocoaPods has downloaded the fmt pod.
const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const MARKER = 'withFmtConstevalFix';
const SNIPPET = `
    # fmt consteval fix (Xcode 26.4 / Apple Clang 21) — ${MARKER}.js
    # fmt 11 recomputes FMT_USE_CONSTEVAL in-header and ignores -D flags, so force
    # it to 0 in the vendored header. Idempotent: after patching no "1" lines remain.
    fmt_fix_headers = Dir.glob(File.join(installer.sandbox.root.to_s, 'fmt', 'include', 'fmt', '*.h'))
    fmt_fix_headers.each do |fmt_fix_header|
      fmt_fix_original = File.read(fmt_fix_header)
      fmt_fix_patched = fmt_fix_original.gsub(/^#\\s*define FMT_USE_CONSTEVAL 1\\s*$/, '#  define FMT_USE_CONSTEVAL 0')
      if fmt_fix_patched != fmt_fix_original
        File.write(fmt_fix_header, fmt_fix_patched)
        Pod::UI.puts "[${MARKER}] forced FMT_USE_CONSTEVAL 0 in #{fmt_fix_header}"
      end
    end
`;

module.exports = function withFmtConstevalFix(config) {
  return withDangerousMod(config, [
    'ios',
    (config) => {
      const podfile = path.join(config.modRequest.platformProjectRoot, 'Podfile');
      let contents = fs.readFileSync(podfile, 'utf8');

      if (!contents.includes(MARKER)) {
        // Insert inside the post_install block, after the COMPLETE
        // react_native_post_install(...) call. Its argument list contains nested
        // parens — Expo SDK 54 added `:ccache_enabled => ccache_enabled?(podfile_properties)`
        // — so the close paren has to be found by balancing. The old
        // /react_native_post_install\([^)]*\)/ anchor stopped at that inner `)`,
        // inserted the snippet mid-call and stranded the real `,\n)`, which made
        // `pod install` die with "unexpected ',', ignoring it".
        const callStart = contents.indexOf('react_native_post_install(');
        if (callStart === -1) {
          throw new Error(
            '[withFmtConstevalFix] Could not find react_native_post_install(...) in the Podfile — the anchor changed; update this plugin.'
          );
        }
        let depth = 0;
        let callEnd = -1;
        for (let i = contents.indexOf('(', callStart); i < contents.length; i++) {
          if (contents[i] === '(') depth++;
          else if (contents[i] === ')' && --depth === 0) {
            callEnd = i + 1;
            break;
          }
        }
        if (callEnd === -1) {
          throw new Error(
            '[withFmtConstevalFix] Unbalanced parentheses in the react_native_post_install(...) call — update this plugin.'
          );
        }
        contents = contents.slice(0, callEnd) + '\n' + SNIPPET + contents.slice(callEnd);
        fs.writeFileSync(podfile, contents);
      }

      return config;
    },
  ]);
};
