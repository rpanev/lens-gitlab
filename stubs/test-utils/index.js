// @k8slens/element-components declares @k8slens/test-utils as a production dependency.
// The published bundle calls two helpers from it and never the Jest parts.
// The real package depends on Jest, which is where is-arrayish, fb-watchman, bser,
// the deprecated glob, and the native watcher come from. This stand-in keeps those
// two calls working and leaves that tree out.
const { getInjectable2, getInjectionToken2 } = require("@k8slens/injectable");

const testUtilityRunnableInjectionToken = getInjectionToken2({
  id: "test-utility-runnable",
  cardinality: "zero-or-many",
})();

// Same rule as @k8slens/public-utilities: under Jest, a class name is the key; otherwise the built stylesheet is used as it is.
const sanitizeScssModules = (variables) => {
  const unitTestsAreRunning = process.env.JEST_WORKER_ID && !process.env.LENS_ACTIVATION_CODE_FOR_INTEGRATION_TESTS;

  if (unitTestsAreRunning) {
    return new Proxy(variables, {
      get: (_target, prop) => prop,
    });
  }

  return variables;
};

// The host uses this to register test-only overrides. This extension does not run that harness.
const getTestUtilRunnableForOverrides = () =>
  getInjectable2({
    id: "test-util-runnable-for-global-and-default-overrides",
    instantiate: () => () => ({
      run: () => undefined,
    }),
    injectionToken: testUtilityRunnableInjectionToken,
  });

module.exports = { getTestUtilRunnableForOverrides, sanitizeScssModules };
