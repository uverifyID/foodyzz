const { withGradleProperties } = require('@expo/config-plugins');

// Gives R8 enough heap to finish.
//
// Turning on enableMinifyInReleaseBuilds puts R8 in the release build, and R8
// holds the whole program graph in memory. The Expo template ships
// org.gradle.jvmargs=-Xmx2048m, which is fine for a debug build and dies on
// this one:
//
//   > Task :app:minifyReleaseWithR8 FAILED
//   ERROR: R8: java.lang.OutOfMemoryError: Java heap space
//
// 4 GB is what this app needs today, with room for the graph to grow; it also
// stays inside what an 8 GB EAS worker can give a single JVM. This is not a
// local-only fix — prebuild rewrites gradle.properties from the template, so
// without it an EAS release build hits the same wall.
//
// expo-build-properties has no option for jvmargs, hence a plugin.
const JVM_ARGS = '-Xmx4096m -XX:MaxMetaspaceSize=1024m';

module.exports = function withAndroidGradleMemory(config) {
  return withGradleProperties(config, (config) => {
    const existing = config.modResults.find(
      (item) => item.type === 'property' && item.key === 'org.gradle.jvmargs',
    );

    if (existing) {
      existing.value = JVM_ARGS;
    } else {
      config.modResults.push({ type: 'property', key: 'org.gradle.jvmargs', value: JVM_ARGS });
    }

    return config;
  });
};
