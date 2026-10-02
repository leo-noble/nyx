import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();

page.on('console', msg => {
  const type = msg.type();
  if (type === 'error' || type === 'warning') {
    console.log(`[Browser ${type}]`, msg.text());
  }
});

page.on('pageerror', err => {
  console.error('[Browser exception]', err.message);
});

await page.goto('http://localhost:8765/test/state-machine.html', { waitUntil: 'networkidle' });

await page.waitForFunction(() => window.__NYX_RESULTS__, { timeout: 10000 });

const results = await page.evaluate(() => window.__NYX_RESULTS__);

console.log('\n=== Nyx State Machine Tests ===\n');
console.log(`Total: ${results.total}`);
console.log(`Passed: ${results.total - results.failed.length}`);
console.log(`Failed: ${results.failed.length}`);

if (results.failed.length > 0) {
  console.log('\nFailed tests:');
  results.failed.forEach(f => console.log(`  ✗ ${f}`));
} else {
  console.log('\n✓ All tests passed!');
}

await browser.close();
process.exit(results.failed.length === 0 ? 0 : 1);
