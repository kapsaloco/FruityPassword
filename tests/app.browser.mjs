import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { preview } from 'vite';
import { parseWordList } from '../src/generator.ts';

const words = new Set(parseWordList(readFileSync(new URL('../src/assets/eff_large_wordlist.txt', import.meta.url), 'utf8')));
let server;
let browser;
let origin;

before(async () => {
  server = await preview({ configFile: false, preview: { host: '127.0.0.1', port: 0 } });
  origin = 'http://127.0.0.1:' + server.httpServer.address().port;
  browser = await chromium.launch({ executablePath: process.env.FRUITY_TEST_BROWSER });
});

after(async () => {
  await browser?.close();
  await server?.close();
});

async function openApp(t, initialize) {
  const context = await browser.newContext();
  t.after(() => context.close());
  if (initialize) await context.addInitScript(initialize);
  const page = await context.newPage();
  const externalRequests = [];
  await page.route('**/*', route => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    externalRequests.push(route.request().url());
    return route.abort();
  });
  await page.goto(origin);
  return { context, page, externalRequests };
}

test('launch and reload start empty until the user generates', async t => {
  const { page } = await openApp(t);
  const output = page.locator('#credential');
  const generate = page.getByRole('button', { name: 'Generate' });
  const copy = page.getByRole('button', { name: 'Copy', exact: true });
  assert.equal(await output.inputValue(), '');
  assert.ok(await copy.isDisabled());
  assert.ok(await page.locator('#randomness').isHidden());
  await generate.click();
  assert.equal((await output.inputValue()).length, 20);
  await page.reload();
  assert.equal(await output.inputValue(), '');
  assert.ok(await copy.isDisabled());
});

test('both shortcut variants generate after settings change and respect validation and Help', async t => {
  const { page } = await openApp(t);
  const found = page.locator('#credential');
  const generate = page.getByRole('button', { name: 'Generate' });
  const length = page.getByRole('spinbutton', { name: /Length/ });
  assert.equal(await found.inputValue(), '');
  assert.match(await generate.getAttribute('class'), /fr-button--hero/);
  assert.equal(await generate.getAttribute('aria-keyshortcuts'), 'Control+Enter Meta+Enter');

  await length.fill('7');
  assert.ok(await generate.isDisabled());
  assert.equal(await length.getAttribute('aria-invalid'), 'true');
  assert.match(await page.getByRole('alert').textContent(), /whole number from 8 to 128/);
  await page.keyboard.press('Control+Enter');
  assert.equal(await found.inputValue(), '');

  for (const [shortcut, amount] of [['Control+Enter', 24], ['Meta+Enter', 32]]) {
    await length.fill(String(amount));
    assert.equal(await page.getByRole('button', { name: 'Copy' }).isEnabled(), amount === 32);
    await page.keyboard.press(shortcut);
    assert.equal(await found.inputValue().then(value => value.length), amount);
  }

  await length.fill('8');
  const previous = await found.inputValue();
  const help = page.getByRole('button', { name: /Help & About/ });
  await help.click();
  const dialog = page.getByRole('dialog');
  assert.ok(await dialog.getByLabel('Keyboard shortcuts').isVisible());
  await page.keyboard.press('Control+Enter');
  assert.ok(await found.inputValue() === previous);
  await page.keyboard.press('Escape');
  assert.ok(await dialog.isHidden());
  assert.ok(await help.evaluate(button => document.activeElement === button));
});

test('editing either length keeps the previous result visible and copyable', async t => {
  const { page } = await openApp(t);
  const output = page.locator('#credential');
  const generate = page.getByRole('button', { name: 'Generate' });
  const copy = page.getByRole('button', { name: 'Copy', exact: true });

  await generate.click();
  const password = await output.inputValue();
  const length = page.getByRole('spinbutton', { name: /Length/ });
  await length.fill('7');
  assert.ok(await generate.isDisabled());
  assert.ok(await output.inputValue() === password);
  assert.ok(await copy.isEnabled());
  await length.fill('24');
  assert.ok(await output.inputValue() === password);
  assert.ok(await copy.isEnabled());
  await generate.click();
  assert.equal((await output.inputValue()).length, 24);
  assert.ok(await copy.isEnabled());

  await page.getByRole('tab', { name: 'Passphrase' }).click();
  await page.getByText('Space', { exact: true }).click();
  await generate.click();
  const phrase = await output.inputValue();
  assert.equal(phrase.split(' ').length, 6);
  await page.getByRole('spinbutton', { name: /Word count/ }).fill('8');
  assert.ok(await output.inputValue() === phrase);
  assert.ok(await copy.isEnabled());
  await generate.click();
  assert.equal((await output.inputValue()).split(' ').length, 8);
  assert.ok(await copy.isEnabled());
});

test('tabs restore their own results and Clear affects the active tab', async t => {
  const { page } = await openApp(t);
  const output = page.locator('#credential');
  const generate = page.getByRole('button', { name: 'Generate' });
  const clear = page.getByRole('button', { name: 'Clear' });
  const copy = page.getByRole('button', { name: 'Copy', exact: true });
  const passwordTab = page.getByRole('tab', { name: 'Password', exact: true });
  const phraseTab = page.getByRole('tab', { name: 'Passphrase', exact: true });

  assert.ok(await clear.isDisabled());
  await generate.click();
  const password = await output.inputValue();
  await page.getByRole('spinbutton', { name: /Length/ }).fill('24');
  await phraseTab.click();
  assert.equal(await output.inputValue(), '');
  await generate.click();
  const phrase = await output.inputValue();
  await passwordTab.click();
  assert.ok(await output.inputValue() === password);
  assert.ok(await copy.isEnabled());

  const normalColor = await clear.evaluate(node => getComputedStyle(node).color);
  await clear.hover();
  assert.notEqual(await clear.evaluate(node => getComputedStyle(node).color), normalColor);
  await clear.click();
  assert.equal(await output.inputValue(), '');
  assert.ok(await clear.isDisabled());
  assert.ok(await page.locator('#randomness').isHidden());

  await phraseTab.click();
  assert.ok(await output.inputValue() === phrase);
  assert.ok(await copy.isEnabled());
  await page.reload();
  await phraseTab.click();
  assert.equal(await output.inputValue(), '');
});

test('Copy uses the displayed result after changing character classes or separators', async t => {
  const { page } = await openApp(t, () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async text => { window.lastCopied = text; } },
    });
  });
  const output = page.locator('#credential');
  const generate = page.getByRole('button', { name: 'Generate' });
  const copy = page.getByRole('button', { name: 'Copy', exact: true });
  await generate.click();
  const password = await output.inputValue();
  const uppercase = page.getByRole('checkbox', { name: 'Uppercase' });
  await uppercase.uncheck();
  assert.ok(await output.inputValue() === password);
  assert.ok(await copy.isEnabled());
  await uppercase.check();
  assert.ok(await output.inputValue() === password);
  await copy.click();
  assert.ok(await page.evaluate(expected => window.lastCopied === expected, password));
  await generate.click();
  assert.ok(await copy.isEnabled());

  await page.getByRole('tab', { name: 'Passphrase' }).click();
  await generate.click();
  const phrase = await output.inputValue();
  const separator = page.locator('.fr-segments--green-glass');
  const highlight = await separator.evaluate(node => {
    const style = getComputedStyle(node, '::before');
    return { background: style.backgroundImage, transition: style.transitionDuration, transform: style.transform };
  });
  assert.match(highlight.background, /rgb\(104, 189, 55\)|rgba\(104, 189, 55/);
  assert.equal(highlight.transition, '0.32s');
  await page.getByRole('radio', { name: 'Hyphen' }).press('ArrowRight');
  assert.ok(await page.getByRole('radio', { name: 'Space' }).isChecked());
  assert.ok(await output.inputValue() === phrase);
  await copy.click();
  assert.ok(await page.evaluate(expected => window.lastCopied === expected, phrase));
  await page.waitForFunction(previous => {
    const track = document.querySelector('.fr-segments--green-glass');
    return getComputedStyle(track, '::before').transform !== previous;
  }, highlight.transform);
  await generate.click();
  assert.equal((await output.inputValue()).split(' ').length, 6);
  assert.ok(await copy.isEnabled());
});

test('manual edits stay exact, omit generated entropy, and remain private while masked', async t => {
  const { page } = await openApp(t, () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async text => { window.lastCopied = text; } },
    });
  });
  const output = page.locator('#credential');
  const generate = page.getByRole('button', { name: 'Generate' });
  await generate.click();
  assert.ok(await page.locator('#randomness').isVisible());
  const original = await output.inputValue();
  const replacement = original[3] === 'x' ? '!' : 'x';
  const edited = original.slice(0, 3) + replacement + original.slice(4);
  await output.focus();
  await output.evaluate(field => field.setSelectionRange(3, 4));
  await page.keyboard.insertText(replacement);
  assert.ok(await output.inputValue() === edited);
  assert.equal(await output.evaluate(field => field.selectionStart), 4);
  assert.ok(await page.getByLabel('Edited password', { exact: true }).isEditable());
  assert.ok(await page.locator('#randomness').isHidden());

  await page.getByRole('button', { name: 'Hide' }).click();
  assert.equal(await output.inputValue(), '•'.repeat(edited.length));
  assert.ok(await output.evaluate(field => field.readOnly));
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  assert.ok(await page.evaluate(expected => window.lastCopied === expected, edited));

  await page.getByRole('tab', { name: 'Passphrase' }).click();
  assert.ok(await output.evaluate(field => field.readOnly));
  await page.getByRole('tab', { name: 'Password', exact: true }).click();
  await page.getByRole('button', { name: 'Show' }).click();
  assert.ok(await output.inputValue() === edited);
  await page.getByRole('button', { name: 'Clear' }).click();
  await output.press('Control+z');
  assert.equal(await output.inputValue(), '');
  assert.ok(await page.getByRole('button', { name: 'Copy', exact: true }).isDisabled());
  await generate.click();
  assert.ok(await page.locator('#randomness').isVisible());
  await output.focus();
  await page.keyboard.insertText(' ');
  const withSpace = await output.inputValue();
  assert.ok(withSpace.includes(' '));
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  assert.ok(await page.evaluate(expected => window.lastCopied === expected, withSpace));
  await page.getByRole('button', { name: 'Clear' }).click();
  await output.press('Control+z');
  assert.equal(await output.inputValue(), '');
});

test('Copy confirms beside the output, announces success, and reports clipboard failures', async t => {
  const { page } = await openApp(t, () => {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: async text => {
        if (window.rejectCopy) throw new Error('Clipboard unavailable');
        window.lastCopied = text;
      } },
    });
  });
  await page.clock.install();
  const output = page.locator('#credential');
  await page.getByRole('button', { name: 'Generate' }).click();
  const value = await output.inputValue();
  assert.equal(await page.evaluate(() => window.lastCopied), undefined);
  await page.getByRole('button', { name: 'Hide' }).click();
  assert.match(await output.inputValue(), /^•{20}$/);
  assert.ok(await output.evaluate(node => !node.dispatchEvent(new Event('copy', { cancelable: true }))));
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await page.getByRole('button', { name: 'Copied!', exact: true }).waitFor();
  assert.ok(await page.evaluate(expected => window.lastCopied === expected, value));
  assert.equal(await page.locator('#status').textContent(), 'Copied!');
  assert.match(await page.locator('#status').getAttribute('class'), /fr-sr-only/);
  await page.clock.runFor(2201);
  assert.ok(await page.getByRole('button', { name: 'Copy', exact: true }).isVisible());
  assert.equal(await page.locator('#status').textContent(), '');

  await page.evaluate(() => { window.rejectCopy = true; });
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  assert.equal(await page.locator('#status').textContent(), 'Could not copy to the clipboard.');
  assert.ok(await page.getByRole('button', { name: 'Copy', exact: true }).isVisible());
});

test('the Tauri clipboard route writes exactly the selected value and drops stale feedback', async t => {
  const { page } = await openApp(t, () => {
    window.isTauri = true;
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' } },
      invoke: (command, args) => {
        window.clipboardCommand = command;
        window.lastCopied = args.text;
        return new Promise(resolve => { window.finishCopy = resolve; });
      },
    };
  });
  const output = page.locator('#credential');
  await page.getByRole('button', { name: 'Generate' }).click();
  const value = await output.inputValue();
  await page.locator('#copy').click();
  await page.waitForFunction(() => typeof window.finishCopy === 'function');
  assert.equal(await page.evaluate(() => window.clipboardCommand), 'plugin:clipboard-manager|write_text');
  assert.ok(await page.evaluate(expected => window.lastCopied === expected, value));
  await page.getByRole('spinbutton', { name: /Length/ }).fill('24');
  await page.getByRole('button', { name: 'Generate' }).click();
  await page.evaluate(() => { window.finishCopy(); });
  await page.waitForFunction(() => !document.querySelector('#copy').disabled);
  assert.equal(await output.inputValue().then(result => result.length), 24);
  assert.equal(await page.locator('#copy').textContent(), 'Copy');
  assert.equal(await page.locator('#status').textContent(), '');
});

test('both modes work offline and Help explains local generation', async t => {
  const { context, page, externalRequests } = await openApp(t);
  await context.setOffline(true);
  const output = page.locator('#credential');
  await page.getByRole('tab', { name: 'Password', exact: true }).press('ArrowRight');
  assert.equal(await page.getByRole('tab', { name: 'Passphrase' }).getAttribute('aria-selected'), 'true');
  assert.equal(await output.inputValue(), '');
  const count = page.getByRole('spinbutton', { name: /Word count/ });
  await count.fill('11');
  assert.equal(await count.getAttribute('aria-invalid'), 'true');
  await count.fill('10');
  await page.getByText('Space', { exact: true }).click();
  await page.getByRole('button', { name: 'Generate' }).click();
  const phrase = (await output.inputValue()).split(' ');
  assert.equal(phrase.length, 10);
  assert.ok(phrase.every(word => words.has(word)));
  assert.match(await page.locator('#randomness').textContent(), /129\.2 bits/);

  await page.getByRole('tab', { name: 'Password', exact: true }).click();
  await page.getByRole('button', { name: 'Generate' }).click();
  assert.equal(await output.inputValue().then(value => value.length), 20);
  await page.getByRole('button', { name: /Help & About/ }).click();
  assert.ok(await page.getByText(/sends zero data to any server/).isVisible());
  assert.equal(await page.locator('#app-version').textContent(), '1.0.0');
  assert.equal(await page.locator('#ui-version').textContent(), '1.1.2');
  assert.equal(await page.locator('#footer-version').textContent(), 'v1.1.2');
  assert.deepEqual(externalRequests, []);
});

test('generation fails closed if secure randomness throws', async t => {
  const { page } = await openApp(t, () => {
    Object.defineProperty(Crypto.prototype, 'getRandomValues', {
      value: () => { throw new Error('Unavailable'); },
    });
  });
  await page.getByRole('button', { name: 'Generate' }).click();
  assert.equal(await page.locator('#credential').inputValue(), '');
  assert.ok(await page.getByRole('button', { name: 'Generate' }).isDisabled());
  assert.ok(await page.getByRole('button', { name: 'Copy' }).isDisabled());
  assert.match(await page.getByRole('alert').textContent(), /Secure randomness is unavailable/);
  await page.getByRole('tab', { name: 'Passphrase' }).click();
  assert.ok(await page.getByRole('button', { name: 'Generate' }).isDisabled());
});

test('the centered mode control keeps its sliding highlight at compact widths', async t => {
  const { page } = await openApp(t);
  await page.setViewportSize({ width: 360, height: 390 });
  const modes = page.getByRole('tablist');
  const offsets = await modes.evaluate(list => {
    const track = list.getBoundingClientRect();
    const panel = list.parentElement.getBoundingClientRect();
    return {
      distanceFromCenter: Math.abs(track.left + track.width / 2 - panel.left - panel.width / 2),
      trackRadius: getComputedStyle(list).borderRadius,
      highlightRadius: getComputedStyle(list, '::before').borderRadius,
      highlight: getComputedStyle(list, '::before').backgroundImage,
      filter: getComputedStyle(list, '::before').backdropFilter,
      left: list.style.getPropertyValue('--fr-tab-highlight-left'),
    };
  });
  assert.ok(offsets.distanceFromCenter < 1);
  assert.equal(offsets.trackRadius, '999px');
  assert.equal(offsets.highlightRadius, offsets.trackRadius);
  assert.match(offsets.highlight, /linear-gradient/);
  assert.match(offsets.filter, /blur/);
  assert.ok(offsets.left);
  await page.getByRole('tab', { name: 'Password', exact: true }).press('ArrowRight');
  assert.notEqual(await modes.evaluate(list => list.style.getPropertyValue('--fr-tab-highlight-left')), offsets.left);
});

test('Help keeps wrapped text spaced apart and the Done button visible while scrolling', async t => {
  const { page } = await openApp(t);
  await page.setViewportSize({ width: 360, height: 390 });
  await page.getByRole('button', { name: /Help & About/ }).click();
  const dialog = page.getByRole('dialog');
  const done = dialog.getByRole('button', { name: 'Done' });
  const buttonPosition = await done.boundingBox();
  const body = dialog.getByRole('region', { name: 'Help and credits' });
  const layout = await body.evaluate(node => ({
    scrollable: node.scrollHeight > node.clientHeight,
    gaps: [...node.children].slice(1).map(child =>
      child.getBoundingClientRect().top - child.previousElementSibling.getBoundingClientRect().bottom),
  }));
  assert.ok(layout.scrollable);
  assert.ok(layout.gaps.every(gap => gap >= 8));
  const shortcuts = dialog.getByLabel('Keyboard shortcuts');
  const keyGap = await shortcuts.evaluate(node => {
    const keys = node.querySelectorAll('kbd');
    return keys[2].getBoundingClientRect().top - keys[0].getBoundingClientRect().bottom;
  });
  assert.ok(keyGap >= 5);
  await body.evaluate(node => { node.scrollTop = node.scrollHeight; });
  assert.deepEqual(await done.boundingBox(), buttonPosition);
  await dialog.getByText('Estimated randomness and character sets', { exact: true }).click();
  assert.ok(await dialog.getByText(/Each additional bit doubles/).isVisible());
  await dialog.getByText('Licenses and notices', { exact: true }).click();
  assert.match(await dialog.locator('#ui-license').textContent(), /MIT License/);
});
