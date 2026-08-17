import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage({ ignoreHTTPSErrors: true });
page.on('response', res => console.log('RES', res.status(), res.url()));
page.on('requestfailed', req => console.log('FAILED', req.url(), req.failure()?.errorText));

await page.goto('https://app.speechcoach.test/login', { waitUntil: 'commit', timeout: 30000 });
await page.waitForTimeout(3000);

const text = await page.evaluate(() => document.getElementById('root')?.outerHTML);
console.log('ROOT OUTER HTML:', text);
const bodyText = await page.evaluate(() => document.body.innerText);
console.log('BODY TEXT:', JSON.stringify(bodyText));

await browser.close();
