# ojee-ui

A terminal-instrument-cluster design system. Cyan on near-black, all monospace, zero border
radius, one accent.

One CSS file. No build step, no dependencies, no framework. Every value routed through a token,
so rebranding is a second stylesheet rather than a fork.

```html
<link rel="stylesheet" href="ojee-ui.css">
```

That is the whole install. Open `index.html` for the live showcase — it is also the
documentation and the test fixture.

Two optional companions ship alongside it:

| File | What it is |
|---|---|
| `chrome.js` | the *interactive* half of the system — toast, focus-trapped modal, a scoped fetch/SSE pair, and `ModuleHost`. Import it when you need behaviour; skip it if you only want the visual language. |
| `standalone.html` | a complete, module-agnostic app shell. Reads a `module.json`, builds nav from its views, and mounts its UI through `ModuleHost`. Drop it in unchanged and a module has a front end. |

---

## Themes

A theme redefines **tokens only**, never rules, and loads after the system:

```html
<link rel="stylesheet" href="ojee-ui.css">
<link rel="stylesheet" href="themes/ember.css">
```

| Theme | Ground | Accent | Notes |
|---|---|---|---|
| *(built in)* | `#08080e` cool black | `#00ffff` cyan | The default. No overlay needed. |
| `themes/ember.css` | `#0d0a06` warm black | `#ffb02e` amber | CRT-phosphor counterpart. |
| `themes/paper.css` | `#f6f5f1` light | `#006d77` teal | Light mode. Proves nothing is hardcoded dark. |

To make your own, copy `themes/_template.css`. It documents every token, what it is for, and
which ones carry a contrast obligation. The rule is simple: **if you need a selector other than
`:root`, the system is missing a token.** That happened once during development — a light theme
needed to flip the heatmap label colour — and the fix was adding `--cell-ink` /
`--cell-hot-ink`, not letting the theme override a rule. Rule overrides break on the next
version; tokens do not.

---

## chrome.js

CSS cannot express a focus trap, a reconnecting event stream, or the lifecycle of a mounted
view. Those live here, in ~400 dependency-free lines:

```js
import { toast, modal, makeApi, makeSse, ModuleHost, onRoute } from './chrome.js';

toast('err', 'Command failed', 'device did not respond within 8s');
const go = await modal({ title: 'Confirm', actions: [
  { label: 'Cancel', value: false, variant: 'ghost' },
  { label: 'Apply',  value: true },
]});
```

`makeApi(base)` and `makeSse(base)` scope every request to a prefix, so the same view code runs
at `/home/api/state` when embedded in a host app and at `/api/state` when served from its own
root. That indirection is small, and it is the entire reason a module is portable.

`ModuleHost` owns mount → view-switch → unmount, including the skeleton while a UI imports and
the error panel with a retry when it fails. It exists because the alternative — every host
reimplementing it — is how a "works standalone" claim quietly stops being true.

---

## Accessibility

Not a later pass. The system carries it so consumers inherit it:

- **Text contrast.** Every ink token clears 4.5:1 on every surface it appears on. The default
  measures ink 15.99:1, ink-2 8.11:1, dim 5.38:1.
- **Control boundaries.** `--line-strong` (3.34:1 on `--bg`, 3.22:1 on `--bg-2`, 3.24:1 on
  `--panel`) is used for anything whose *edge* is the affordance — inputs, selects, toggles,
  checkboxes, segmented controls, steppers, icon buttons. The faint `--line` / `--line-2` stay
  for decorative hairlines. Merging the two is the mistake that makes a drafting aesthetic
  either illegible or a spreadsheet.
- **Touch targets.** 44px minimum, via `--hit`. Small controls keep their *drawn* size and grow
  an invisible `::after` hit area, so density survives.
- **Focus.** One `:focus-visible` ring across the whole system. The aesthetic leans on hover,
  which the phones this is used from do not have.
- **Motion.** Every transition routes through `--dur` / `--dur-2`, so one
  `prefers-reduced-motion` block takes the entire page to zero. Verified, not assumed.
- **Safe areas.** The HUD, nav, status bar, tab bar and toast stack all inset with
  `env(safe-area-inset-*)`.
- **Colour is never the only encoding.** Status carries a word or an icon; heatmap cells carry
  their index; charts carry legends.

---

## Tests

```bash
npm test                 # both suites
npm run check:contrast   # tokens, numerically
npm run check:dom        # rendered page, via agent-browser
```

**`tests/check-contrast.mjs`** parses the token blocks out of `ojee-ui.css` plus a theme,
composites translucent values the way a browser would, and asserts the contract — 20 checks per
theme. No dependencies.

**`tests/check-dom.sh`** serves the showcase and drives a real browser with
[`agent-browser`](https://agent-browser.dev): touch-target reachability by `elementFromPoint`
probe, keyboard focus rings, reduced-motion collapse, horizontal overflow at 375/768/1024, the
mobile nav swap, tab-bar clearance, and a full axe-core WCAG 2.1 A/AA audit. 10 checks per theme.

### Why axe reports 345 "incomplete" and that is fine

axe cannot compute contrast when it cannot resolve a background colour, and this system paints
the root with a **gradient** and every surface above it with **translucency**. So it reports
`color-contrast` as *incomplete* — "could not be determined due to a background gradient" — not
as a violation. Violations are 0.

That gap is exactly why `check-contrast.mjs` exists: it composites the tokens numerically
instead of sampling pixels. The DOM suite therefore fails on violations only, and prints the
incomplete count so the number never gets quietly ignored.

---

## What's in it

| Group | Classes |
|---|---|
| Shell | `.app` `.wrap` `.hudbar` `.nav` `.tabbar` `.statusbar` `.skip` `.section-head` `.stack-lg` |
| Surfaces | `.panel` `.corners` `.panel--glowtop` `.sheet` `.titleblock` `.blueprint` `.gate` `.window` `.browser` `.code` |
| Controls | `.btn` `.iconbtn` `.stepbtn` `.input` `.select` `.textarea` `.toggle` `.check` `.range` `.segctl` `.togrow` `.dial` |
| Data | `.stat` `.tiles` `.gauge` `.bar` `.meter` `.chart` `.linechart` `.coregrid` `.table` `.legend` |
| Feedback | `.alert` `.toast` `.modal` `.empty` `.skeleton` `.badge` `.dot` |
| Type | `.display` `.h1` `.h2` `.label` `.meta` `.value` `.kbd` `.num` |

Two pairs that look combinable and are not:

- **`.panel--glowtop` and `.corners`** both style `::before` on the same element. Applying both
  merges the corner bracket into the glow gradient and hover paints a solid accent block. A
  guard rule neutralises it, but they are alternatives — pick one.
- **`.toggle` inside `.togrow`.** The row is the control; the switch is decoration driven by
  `data-on`. Render it *without* an `<input>` — a real input nested in a button is a nested
  interactive control, which axe flags as serious and screen readers announce twice. Use the
  standalone `.toggle` wherever the switch is the control in its own right.

---

## Fonts

Three faces, all with real fallback stacks so a failed webfont degrades to a monospace rather
than to Times:

| Token | Face | Used for |
|---|---|---|
| `--mono` | Geist Mono | everything |
| `--pixel` | Major Mono Display | the wordmark only |
| `--hud` | Departure Mono | small-caps instrument type |

Only `--mono` really matters. Change that and the system changes character.

---

## Licence

MIT.
