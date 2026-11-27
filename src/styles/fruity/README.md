# FruityUI 1.1.2

FruityUI provides the shared window shell, glass controls, and interactions for
the Fruity Suite. FruityPassword is the source for 1.1.2. See the [changelog](CHANGELOG.md)
for release history. The source repository also carries the interactive demos
under `showcase/`.

## Using 1.1.2 in another app

Copy the complete `src/styles/fruity/` directory from
FruityPassword into the same location in the new app. Keep the license, changelog,
and all version folders together. The `v1.1.2/` entry point builds on the
`v1.1/` files, which provide the archived 1.1.1 release and its 1.0 foundation.

Load `src/styles/fruity/v1.1.2/index.css` once. For a Vite desktop app, link
`/src/styles/fruity/v1.1.2/index.css` from the document head for a styled first
paint. Put host layout rules in the `app` cascade layer.

From a TypeScript entry point at `src/main.ts`:

```ts
import { initFruity } from './styles/fruity/v1.1.2/components';
import { FRUITY_UI_VERSION } from './styles/fruity/v1.1.2/version';

const disposeFruity = initFruity();
document.querySelector('[data-fruity-ui-version]')?.replaceChildren(FRUITY_UI_VERSION);

if (import.meta.hot) import.meta.hot.dispose(disposeFruity);
```

Use the version constant in About. Call the initializer after the markup is
available, once per mounted root, and dispose it before remounting. Apps using
the 1.0 initializer can switch imports to pick up the sliding highlight.

| Reusable addition | Integration |
| --- | --- |
| Glass pill tabs | Add `fr-tabs__list--glass-pill` to `fr-tabs__list` for the translucent pill design. Use `fr-tabs__list` on its own for the classic design. Both use the same tab markup and initializer. Set width and alignment in the host app’s layout. |
| Green glass separator | Add `fr-segments--green-glass` to `fr-segments`. Use exactly two `fr-segment` labels, each with a native radio input followed by a text span. Give the radios the same group name and check the default option. Keyboard selection works through the native radios. The highlight switches instantly with reduced motion and uses the native FruityUI selected style in forced colors. |
| Sliding tabs | Use `[data-fr-tabs]`, `.fr-tabs__list[role="tablist"]`, and `.fr-tab[role="tab"]` with the existing tab and panel ARIA links. The v1.1 initializer measures the selected tab and tracks layout changes. Reduced motion switches instantly. Wrapped rows and forced colors retain the selected button style. |
| Scrolling dialogs | Add `fr-dialog--scroll-body` to `fr-dialog`. Keep the header, body, and actions as direct children. Add `fr-glass-scrollbar` to the body for the glass track. Give a scrollable body keyboard focus and an accessible name when it needs to be scrolled without focusing a control. |
| Glass dropdown | Keep a labeled native select with an ID. Pair it with `-control`, `-trigger`, `-menu`, and `-value` IDs as shown in the example. Call `enhanceSelect(select)` from `v1.1/select.ts`. The select emits a change event on selection. Call the returned sync function after setting the value programmatically. Allow space for the overlay and place its open panel above adjacent glass panels. |
| Color picker controls | Use `fr-sv-picker` with its marker and a native input with `fr-hue-slider`. The helpers in `v1.1/color-controls.ts` provide painting, pointer capture, and arrow-key handling. The host supplies color state, accessible value text, and any history. Saturation and value are fractions between zero and one. |
| Swatches and chips | Use `fr-color-swatch` for a large sample or `fr-color-chip` for a small sample. Choose `--preview` or `--compact` for the display variants and set `--fr-swatch-color`. Pair the color with a readable label. |
| Contrast sample | Use `fr-contrast-sample` to show large and normal text in the host's chosen foreground and background colors. The host computes any contrast result. |
| Glass scrollbar | Add `fr-glass-scrollbar` to an element with a constrained height. |
| Glass disclosure header | Add `fr-disclosure--glass` to the existing `fr-disclosure` details element. |
| Inline feedback | Use `fr-field-error` for an input error, `fr-status-strip` for live status, and `fr-action-notice` with `fr-action-notice__body` for a message paired with a control. |
| Field divider | Add `fr-field-divider` to a field group or action row to separate it with a subtle glass rule. |
| Destructive actions | Add `fr-button--danger` for a destructive primary action or `fr-button--danger-hover` for a neutral action that turns red on hover. Use the existing dialog component for confirmation. |

The original buttons, panels, tabs, inputs, dialogs, disclosures, titlebar,
file chooser, and footer remain part of 1.0. FruityPalette composes them with the
new primitives. Its recent and saved palette lists, contrast checker, image
sampler, wallpaper, and desktop commands stay in the app.
