const assert = require('assert');
const http = require('http');

const PORT = process.env.PORT || 8080;

async function runTests() {
  console.log('Running integration tests against port', PORT);

  // Test Health Endpoint
  await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${PORT}/health`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          assert.strictEqual(json.status, 'ok');
          console.log('✅ Health endpoint check passed');
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });

  // Test Provider Capabilities Endpoint
  await new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${PORT}/api/provider/capabilities`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          assert.ok(json.provider);
          console.log('✅ Provider capabilities endpoint check passed');
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });

  console.log('All automated tests passed successfully!');
}

if (require.main === module) {
  runTests().catch(err => {
    console.error('❌ Test failed:', err);
    process.exit(1);
  });
}

module.exports = { runTests };
