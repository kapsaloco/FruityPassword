import { isTauri } from '@tauri-apps/api/core';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';

export async function copyCredential(value: string) {
  if (isTauri()) {
    await writeText(value);
  } else {
    await navigator.clipboard.writeText(value);
  }
}
