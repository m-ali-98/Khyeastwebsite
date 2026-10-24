import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const root = path.resolve(import.meta.dirname, '..');
const input = path.join(root, 'docs', 'khyeast-linux-deployment-guide.html');
const output = path.join(root, 'docs', 'Khyeast-Linux-Deployment-Guide.pdf');

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(pathToFileURL(input).href, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.pdf({
    path: output,
    format: 'A4',
    printBackground: true,
    preferCSSPageSize: true,
    displayHeaderFooter: true,
    tagged: true,
    outline: true,
    headerTemplate: `
      <div style="width:100%;padding:0 16mm;font-family:Arial,sans-serif;font-size:7.5px;color:#796d72;display:flex;justify-content:space-between;">
        <span>Khuzestan Yeast Website</span>
        <span>Linux Production Deployment Guide</span>
      </div>`,
    footerTemplate: `
      <div style="width:100%;padding:0 16mm;font-family:Arial,sans-serif;font-size:7.5px;color:#796d72;display:flex;justify-content:space-between;">
        <span>m-ali-98/Khyeastwebsite · 24 Oct 2026</span>
        <span><span class="pageNumber"></span> / <span class="totalPages"></span></span>
      </div>`,
  });
  console.log(output);
} finally {
  await browser.close();
}
