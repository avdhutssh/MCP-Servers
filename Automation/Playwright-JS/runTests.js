// runTests.js
// Script to run tests by tags or individually

const testConfig = require('./config/TestConfig');
const { log } = require('./utils/logger/Logger');
const allureReporter = require('./utils/reporter/AllureReporter');
const path = require('path');
const fs = require('fs');
const readExcel = require('./utils/helpers/Utils').readFromExcel;
const { prepareDefaultTestData } = require('./utils/helpers/TestDataProcessor');

/**
 * Load test data from sources
 * @param {string[]} dataSources - List of data source names
 * @returns {Promise<Object>} Test data
 */
async function loadTestData(dataSources) {
    // Start with default test data (credentials, etc.)
    const testData = await prepareDefaultTestData();
    
    if (!dataSources || dataSources.length === 0) {
        return testData;
    }
    
    for (const sourceName of dataSources) {        
        const source = testConfig.dataSources[sourceName];
        if (!source) {
            log(`Data source not found: ${sourceName}`, 'warn');
            continue;
        }
        
        try {
            if (source.type === 'excel') {
                // Load Excel data
                const excelPath = path.resolve(__dirname, source.path);
                if (fs.existsSync(excelPath)) {
                    const excelData = await readExcel(excelPath, source.sheet);                    testData[sourceName] = excelData;
                } else {
                    log(`Excel file not found: ${excelPath}, using fallback data`, 'warn');
                    testData[sourceName] = source.fallback;
                }} else if (source.type === 'json') {
                // Load JSON data
                const jsonPath = path.resolve(__dirname, source.path);
                if (fs.existsSync(jsonPath)) {
                    try {
                        const fileContent = fs.readFileSync(jsonPath, 'utf8');                        const jsonData = JSON.parse(fileContent);
                        testData[sourceName] = jsonData;
                    } catch (error) {
                        log(`Error loading data for ${sourceName}: ${error.message}`, 'error');
                        testData[sourceName] = source.fallback;
                    }                } else {
                    log(`JSON file not found: ${jsonPath}, using fallback data`, 'warn');
                    testData[sourceName] = source.fallback;
                }
            }        } catch (error) {
            log(`Error loading data for ${sourceName}: ${error.message}`, 'error');
            testData[sourceName] = source.fallback;
        }
    }
    
    return testData;
}

/**
 * Run specified tests
 * @param {string[]} tests - List of test names to run
 * @returns {Promise<void>}
 */
async function runTests(tests) {    log(`Starting test execution for ${tests.length} tests`, 'info');
    
    // Clean Allure results directory
    allureReporter.cleanResultsDirectory();
      // Resolve dependencies
    const testsWithDependencies = testConfig.resolveDependencies(tests);
    log(`Tests to run with dependencies: ${testsWithDependencies.join(', ')}`, 'info');
    
    let successCount = 0;
    let failCount = 0;
    
    const startTime = Date.now();
      // Run each test
    for (const testName of testsWithDependencies) {
        log(`Executing test: ${testName}`, 'info');
        
        const testInfo = testConfig.getTest(testName);
        if (!testInfo) {
            log(`Test configuration not found for: ${testName}`, 'error');
            failCount++;
            continue;
        }
          try {
            // Load test data
            const testData = await loadTestData(testInfo.dataSources || []);
            
            // Log test data for debugging
            log(`Loaded test data with keys: ${Object.keys(testData).join(', ')}`, 'info');
            if (testData.userCredentials) {
                log(`Test data includes credentials for: ${testData.userCredentials.email}`, 'info');
            }
            
            // Dynamically import test module
            const testPath = `./${testInfo.path}`;
            const TestClass = require(testPath);
            
            // Create test instance with test data
            const test = new TestClass(testData);
            const result = await test.run();
              if (result.success) {
                log(`Test ${testName} completed successfully`, 'success');
                successCount++;
            } else {
                log(`Test ${testName} failed: ${result.error || 'Unknown error'}`, 'error');
                failCount++;
            }
        } catch (error) {
            log(`Error running test ${testName}: ${error.message}`, 'error');
            failCount++;
        }
    }
    
    const endTime = Date.now();
    const executionTime = (endTime - startTime) / 1000;
      // Print summary
    log('\nTest Execution Summary:', 'info');
    log(`Total tests: ${testsWithDependencies.length}`, 'info');
    log(`Successful: ${successCount}`, 'success');
    log(`Failed: ${failCount}`, 'error');
    log(`Execution time: ${executionTime.toFixed(2)} seconds`, 'info');
    
    // Generate Allure report
    await allureReporter.generateReport();
    
    return {
        success: failCount === 0,
        total: testsWithDependencies.length,
        successful: successCount,
        failed: failCount,
        executionTime
    };
}

/**
 * Run tests by tag
 * @param {string} tag - Tag to run tests for
 * @returns {Promise<void>}
 */
async function runTestsByTag(tag) {
    const tests = testConfig.getTestsByTag(tag);    const testNames = Object.keys(tests);
    
    if (testNames.length === 0) {
        log(`No tests found with tag: ${tag}`, 'warn');
        return;
    }
    
    log(`Found ${testNames.length} tests with tag '${tag}': ${testNames.join(', ')}`, 'info');
    return await runTests(testNames);
}

// Main execution - parse command line arguments
if (require.main === module) {
    const args = process.argv.slice(2);
    let testsToRun = [];
    
    if (args.length === 0) {
        console.log(`
Usage:
  node runTests.js --all                   Run all tests
  node runTests.js --tag <tagName>         Run tests with specific tag
  node runTests.js --test <testName>       Run specific test
  node runTests.js --tests <test1> <test2> Run multiple tests
        `);
        process.exit(0);
    }
    
    if (args[0] === '--all') {
        testsToRun = Object.keys(testConfig.getAllTests());
    } else if (args[0] === '--tag' && args.length > 1) {
        runTestsByTag(args[1])
            .then(() => {
                // Open Allure report
                allureReporter.openReport().catch(() => {
                    log('Could not automatically open report. Run "npm run report" manually.', 'warn');
                });
            })
            .catch(error => {
                log('Error running tests: ${error.message}', 'error');
                process.exit(1);
            });
        return;
    } else if (args[0] === '--test' && args.length > 1) {
        testsToRun = [args[1]];
    } else if (args[0] === '--tests') {
        testsToRun = args.slice(1);
    }
    
    if (testsToRun.length > 0) {
        runTests(testsToRun)
            .then(() => {
                // Open Allure report
                allureReporter.openReport().catch(() => {
                    log('Could not automatically open report. Run "npm run report" manually.', 'warn');
                });
            })
            .catch(error => {
                log('Error running tests: ${error.message}', 'error');
                process.exit(1);
            });
    }
}

module.exports = {
    runTests,
    runTestsByTag
};
