import { isTauri } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { version } from '../package.json';
import wordListSource from './assets/eff_large_wordlist.txt?raw';
import uiLicense from './styles/fruity/LICENSE?raw';
import { copyCredential } from './clipboard';
import {
  AMBIGUOUS_CHARACTERS,
  GenerationError,
  generatePassphrase,
  generatePassword,
  parseWordList,
  passwordAlphabets,
  passwordEntropy,
  PASSWORD_CLASSES,
  RandomnessError,
  validateLength,
  type CharacterClass,
} from './generator';
import { initFruity } from './styles/fruity/v1.1.2/components';
import { FRUITY_UI_LABEL, FRUITY_UI_VERSION } from './styles/fruity/v1.1.2/version';

function element<T extends HTMLElement = HTMLElement>(id: string) {
  return document.getElementById(id) as T;
}

const disposeFruity = initFruity();
const credential = element<HTMLTextAreaElement>('credential');
const generateButton = element<HTMLButtonElement>('generate');
const visibilityButton = element<HTMLButtonElement>('visibility');
const copyButton = element<HTMLButtonElement>('copy');
const clearButton = element<HTMLButtonElement>('clear');
const passwordLength = element<HTMLInputElement>('length');
const wordCount = element<HTMLInputElement>('word-count');
const passwordTab = element<HTMLButtonElement>('password-tab');
const about = element<HTMLDialogElement>('about');
const error = element('error');
const status = element('status');
const randomness = element('randomness');
const classNames = Object.keys(PASSWORD_CLASSES) as CharacterClass[];
let secureRandomnessAvailable = typeof globalThis.crypto?.getRandomValues === 'function';

type Mode = 'password' | 'passphrase';
type Result = { value: string; bits?: number };

let mode: Mode = 'password';
let outputs: Partial<Record<Mode, Result>> = {};
let masked = false;
let copying = false;
let revision = 0;
let statusTimer: ReturnType<typeof setTimeout> | undefined;
let words: string[] | undefined;

function showStatus(message: string, copied = false) {
  clearTimeout(statusTimer);
  copyButton.textContent = copied ? 'Copied!' : 'Copy';
  status.classList.toggle('fr-sr-only', copied);
  status.textContent = message;
  if (message) statusTimer = setTimeout(() => showStatus(''), 2200);
}

function showError(message: string) {
  error.hidden = !message;
  error.textContent = message;
}

function renderOutput() {
  const result = outputs[mode];
  const value = result?.value ?? '';
  const displayed = masked ? '•'.repeat(value.length) : value;
  if (credential.value !== displayed) credential.value = displayed;
  credential.readOnly = masked || mode === 'passphrase';
  element('credential-label').textContent = result && result.bits === undefined ? 'Edited password' : 'Generated ' + mode;
  visibilityButton.textContent = masked ? 'Show' : 'Hide';
  visibilityButton.disabled = !result;
  copyButton.disabled = !result || copying;
  clearButton.disabled = !result;
  randomness.textContent = result?.bits === undefined ? '' : 'Estimated randomness: ' + result.bits.toFixed(1) + ' bits';
  randomness.hidden = result?.bits === undefined;
}

function refreshOutput() {
  revision++;
  showStatus('');
  renderOutput();
}

function clearOutput() {
  delete outputs[mode];
  refreshOutput();
}

function clearAllOutputs() {
  outputs = {};
  refreshOutput();
}

function readSettings() {
  if (!secureRandomnessAvailable) {
    throw new GenerationError('Secure randomness is unavailable. Generation has been disabled.');
  }

  if (mode === 'password') {
    const length = passwordLength.valueAsNumber;
    validateLength(length, 8, 128, 'Length');
    const enabled = classNames.filter(name => element<HTMLInputElement>(name).checked);
    const alphabets = passwordAlphabets(enabled, element<HTMLInputElement>('exclude-ambiguous').checked);
    return { mode, length, alphabets } as const;
  }

  const count = wordCount.valueAsNumber;
  validateLength(count, 4, 10, 'Word count');
  words ??= parseWordList(wordListSource);
  const separator = element<HTMLInputElement>('hyphen').checked ? '-' : ' ';
  return { mode, count, separator, words } as const;
}

function updateSettings() {
  passwordLength.removeAttribute('aria-invalid');
  wordCount.removeAttribute('aria-invalid');

  try {
    const settings = readSettings();
    showError('');
    generateButton.disabled = false;
    return settings;
  } catch (failure) {
    generateButton.disabled = true;
    const input = mode === 'password' ? passwordLength : wordCount;
    if (!input.validity.valid) input.setAttribute('aria-invalid', 'true');
    showError(failure instanceof GenerationError ? failure.message : 'These settings could not be verified.');
  }
}

function generate() {
  const settings = updateSettings();
  if (!settings) return;

  try {
    if (settings.mode === 'password') {
      outputs.password = {
        value: generatePassword(settings.length, settings.alphabets),
        bits: passwordEntropy(settings.length, settings.alphabets),
      };
    } else {
      outputs.passphrase = {
        value: generatePassphrase(settings.count, settings.separator, settings.words),
        bits: settings.count * Math.log2(settings.words.length),
      };
    }
    refreshOutput();
  } catch (failure) {
    clearOutput();
    showError(failure instanceof GenerationError ? failure.message : 'Generation failed. Try again.');
    if (failure instanceof RandomnessError) {
      secureRandomnessAvailable = false;
      generateButton.disabled = true;
    }
  }
}

function syncMode() {
  const nextMode = passwordTab.getAttribute('aria-selected') === 'true' ? 'password' : 'passphrase';
  if (mode === nextMode) return;
  mode = nextMode;
  refreshOutput();
  updateSettings();
}

element('modes').addEventListener('click', syncMode);
element('modes').addEventListener('keydown', syncMode);
element('password-options').addEventListener('input', updateSettings);
element('passphrase-options').addEventListener('input', updateSettings);
generateButton.addEventListener('click', generate);
clearButton.addEventListener('click', clearOutput);
document.addEventListener('keydown', event => {
  if (event.key !== 'Enter' || event.ctrlKey === event.metaKey || event.altKey || event.shiftKey ||
      event.repeat || event.isComposing || event.defaultPrevented || about.open || generateButton.disabled) return;
  event.preventDefault();
  generateButton.click();
});
visibilityButton.addEventListener('click', () => {
  masked = !masked;
  renderOutput();
});
credential.addEventListener('copy', event => {
  if (masked) event.preventDefault();
});
credential.addEventListener('input', () => {
  if (credential.readOnly) return;
  const value = credential.value;
  if (value === (outputs.password?.value ?? '')) return;
  if (value) {
    outputs.password = { value };
    refreshOutput();
  } else {
    clearOutput();
  }
});

copyButton.addEventListener('click', async () => {
  const result = outputs[mode];
  if (!result || copying) return;
  const copyRevision = revision;
  copying = true;
  renderOutput();

  let copied: boolean;
  try {
    await copyCredential(result.value);
    copied = true;
  } catch {
    copied = false;
  } finally {
    copying = false;
    renderOutput();
  }
  if (copyRevision === revision) {
    showStatus(copied ? 'Copied!' : 'Could not copy to the clipboard.', copied);
  }
});

element('app-version').textContent = version;
element('ui-version').textContent = FRUITY_UI_VERSION;
element('ui-license').textContent = uiLicense.trim();
element('footer-version').textContent = FRUITY_UI_LABEL;
element('ambiguous-characters').textContent = [...AMBIGUOUS_CHARACTERS].join(' ');
clearAllOutputs();
updateSettings();

if (isTauri() && /Windows/i.test(navigator.userAgent)) {
  const appWindow = getCurrentWindow();
  const report = () => showStatus('Could not complete the window action.');
  element('window-controls').hidden = false;
  element('minimize').addEventListener('click', () => void appWindow.minimize().catch(report));
  element('close').addEventListener('click', () => void appWindow.close().catch(report));
  element('window-drag').addEventListener('mousedown', event => {
    if (event.button === 0 && event.detail === 1) {
      event.preventDefault();
      void appWindow.startDragging().catch(report);
    }
  });
}

window.addEventListener('pagehide', clearAllOutputs);
if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    clearAllOutputs();
    disposeFruity();
  });
}
