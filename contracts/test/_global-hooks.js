const mocha = require("mocha");

const {
  isMainnetForkTest,
  isArbFork,
  isHoleskyFork,
  isBaseFork,
  isBaseUnitTest,
  isSonicFork,
  isSonicUnitTest,
  isPlumeFork,
  isPlumeUnitTest,
} = require("./helpers");

const _chunkId = Number(process.env.CHUNK_ID);
const _maxChunks = Number(process.env.MAX_CHUNKS);

// MAX_CHUNKS is only set on CI for fork-tests
// when running tests parallely
const runTestsParallely = Boolean(_maxChunks);

/**
 * Recursively find the number of test cases the suite
 * has (including the count from nested suites).
 *
 * @param {mocha.Suite} suite
 * @returns {Number} Total number of test cases the suite has
 */
const _findAllTestCaseCount = (suite) => {
  if (!suite.suites?.length) {
    return suite.tests?.length || 0;
  }
  return suite.suites.reduce((count, currSuite) => {
    return count + _findAllTestCaseCount(currSuite);
  }, suite.tests?.length || 0);
};

mocha.before(function () {
  // Find the root test suite
  let root = this.runnable().parent;
  while (root.parent) {
    root = root.parent;
  }

  // If you are running unit tests, scrape out all fork tests.
  // For fork tests, scrape out all unit tests.
  root.suites = root.suites.filter((s) => {
    const isMainnetForkTestFile = s.file.endsWith("mainnet.fork-test.js");
    const isHoleskyTestFile = s.file.endsWith(".holesky.fork-test.js");
    const isArbTestFile = s.file.endsWith(".arb.fork-test.js");
    const isBaseTestFile = s.file.endsWith(".base.fork-test.js");
    const isBaseUnitTestFile = s.file.endsWith(".base.js");
    const isSonicTestFile = s.file.endsWith(".sonic.fork-test.js");
    const isSonicUnitTestFile = s.file.endsWith(".sonic.js");
    const isPlumeTestFile = s.file.endsWith(".plume.fork-test.js");
    const isPlumeUnitTestFile = s.file.endsWith(".plume.js");

    const unitTest =
      !s.file.endsWith(".fork-test.js") &&
      !isBaseUnitTestFile &&
      !isSonicUnitTestFile;

    if (isArbFork) {
      return isArbTestFile;
    } else if (isMainnetForkTest) {
      return isMainnetForkTestFile;
    } else if (isBaseFork) {
      return isBaseTestFile;
    } else if (isSonicFork) {
      return isSonicTestFile;
    } else if (isHoleskyFork) {
      return isHoleskyTestFile;
    } else if (isPlumeFork) {
      return isPlumeTestFile;
    } else if (isBaseUnitTest) {
      return isBaseUnitTestFile;
    } else if (isSonicUnitTest) {
      return isSonicUnitTestFile;
    } else if (isPlumeUnitTest) {
      return isPlumeUnitTestFile;
    } else {
      // else is unit test
      return unitTest;
    }
  });

  if (!runTestsParallely) {
    // When running serially
    return;
  }

  // In case of parallel tests...
  const currentBatchTestCases = [];

  // Flatten suites up to level 1
  const flattenedSuites = root.suites
    .reduce((all, currSuite) => {
      const nestedSuites = [...currSuite.suites].map((s) => {
        // Make sure the titles are clear for flattened suites
        s.title = s.fullTitle();
        s.timeout(0); // Reset timeout
        return s;
      });
      currSuite.suites = [];
      return [
        ...all,
        ...nestedSuites, // Nested suites (L1)
        currSuite, // Current suite
      ];
    }, [])
    .filter((x) => x.tests.length);

  // Do a weighted split of test cases across runners
  const batchWeights = new Array(_maxChunks).fill(0);
  for (let suite of flattenedSuites) {
    const targetBatchIndex = Object.keys(batchWeights)
      .slice(1)
      .reduce((lastIndex, currIndex) => {
        return batchWeights[lastIndex] == 0 ||
          batchWeights[lastIndex] < batchWeights[currIndex]
          ? lastIndex
          : currIndex;
      }, 0);

    batchWeights[targetBatchIndex] += _findAllTestCaseCount(suite);
    if (targetBatchIndex == _chunkId) {
      currentBatchTestCases.push(suite);
    }
  }

  // Only run the tests that are supposed to be run on the current runner
  root.suites = currentBatchTestCases;
});
