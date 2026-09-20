const { withAndroidStyles } = require('@expo/config-plugins');

// Clears the Play Console notice "Your app uses deprecated APIs or parameters
// for edge-to-edge".
//
// Android 15 (API 35) deprecated the window attributes that colour the system
// bars, because an edge-to-edge app draws its own content behind them. Two of
// them land in AppTheme on every prebuild, and neither is ours to remove at the
// source:
//
//   android:statusBarColor              @expo/config-plugins' withStatusBar
//   android:enforceNavigationBarContrast @expo/prebuild-config's edge-to-edge plugin
//
// Both already have no effect at runtime: gradle.properties sets
// edgeToEdgeEnabled=true, so expo-modules-core makes the system bars
// transparent and draws under them on every supported release. Play still reads
// the compiled theme and flags the attributes, so strip them after Expo's own
// plugins have written them.
//
// Nothing replaces them. The bars stay transparent, which is the point of
// edge-to-edge, and the app controls its own contrast — FoodyzzHQ through
// <StatusBar style="light" />, Foodyzz through its own light backgrounds.
const DEPRECATED_ITEMS = ['android:statusBarColor', 'android:enforceNavigationBarContrast'];

module.exports = function withAndroidEdgeToEdgeAttrs(config) {
  return withAndroidStyles(config, (config) => {
    const styles = config.modResults.resources.style || [];

    for (const style of styles) {
      if (!Array.isArray(style.item)) continue;
      style.item = style.item.filter((item) => !DEPRECATED_ITEMS.includes(item?.$?.name));
    }

    return config;
  });
};
