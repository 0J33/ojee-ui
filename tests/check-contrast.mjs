#!/usr/bin/env node
/**
 * ojee-ui contrast checker
 *
 * Reads the token block out of ojee-ui.css (the defaults) and, if a theme
 * file is given, overlays that theme's tokens on top — exactly the cascade a
 * browser produces from:
 *
 *     <link rel="stylesheet" href="ojee-ui.css">
 *     <link rel="stylesheet" href="themes/x.css">
 *
 * Then it asserts the contract in themes/_template.css:
 *
 *   - every token used as TEXT reaches 4.5:1 against the surface it sits on
 *   - --line-strong reaches 3:1 against --bg, --bg-2 AND --panel, because a
 *     control boundary is the affordance and has to survive every surface
 *   - --on-accent is legible on --accent
 *   - heatmap cell labels are legible on their own cell
 *
 * No dependencies. Run with:  node tests/check-contrast.mjs [theme.css ...]
 */

import { readFileSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/* ── colour maths ─────────────────────────────────────────────────────── */

const srgbToLinear = (c) => {
  const v = c / 255;
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};

const luminance = ([r, g, b]) =>
  0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);

const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

/** Composite `fg` at alpha `a` over opaque `bg`. */
const over = (fg, a, bg) => fg.map((f, i) => Math.round(f * a + bg[i] * (1 - a)));

/**
 * Parse a colour into [r,g,b,a]. Handles #rgb, #rrggbb, #rrggbbaa, rgb(),
 * rgba() and — because tokens reference each other (--cell-3: var(--accent))
 * — `var(--name)` via the supplied token table.
 */
function parseColor(value, tokens, seen = new Set()) {
  if (!value) return null;
  const v = value.trim();

  const varMatch = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(v);
  if (varMatch) {
    const [, name, fallback] = varMatch;
    if (seen.has(name)) return null;               // circular reference
    seen.add(name);
    return parseColor(tokens[name] ?? fallback, tokens, seen);
  }

  if (v.startsWith('#')) {
    const hex = v.slice(1);
    const expand = (s) => parseInt(s.length === 1 ? s + s : s, 16);
    if (hex.length === 3 || hex.length === 4) {
      const p = hex.split('').map(expand);
      return [p[0], p[1], p[2], hex.length === 4 ? p[3] / 255 : 1];
    }
    if (hex.length === 6 || hex.length === 8) {
      const p = [];
      for (let i = 0; i < hex.length; i += 2) p.push(parseInt(hex.slice(i, i + 2), 16));
      return [p[0], p[1], p[2], p.length === 4 ? p[3] / 255 : 1];
    }
    return null;
  }

  const fn = /^rgba?\(([^)]+)\)$/.exec(v);
  if (fn) {
    const parts = fn[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null;
    return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
  }

  return null;
}

/** Resolve a token to an opaque rgb triple, compositing over `bg` if translucent. */
function solid(name, tokens, bg) {
  const c = parseColor(tokens[name], tokens);
  if (!c) return null;
  const [r, g, b, a] = c;
  return a >= 1 ? [r, g, b] : over([r, g, b], a, bg);
}

const hex = ([r, g, b]) =>
  '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');

/* ── token extraction ─────────────────────────────────────────────────── */

/**
 * Pull `--name: value;` pairs out of every `:root` block in a stylesheet.
 * Comments are stripped first so a commented-out token in the template does
 * not register as real. Later declarations win, matching the cascade.
 */
function extractTokens(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const tokens = {};
  const blockRe = /:root[^{]*\{([^}]*)\}/g;
  let block;
  while ((block = blockRe.exec(clean)) !== null) {
    const declRe = /(--[\w-]+)\s*:\s*([^;]+);/g;
    let decl;
    while ((decl = declRe.exec(block[1])) !== null) {
      tokens[decl[1]] = decl[2].trim();
    }
  }
  return tokens;
}

/* ── the contract ─────────────────────────────────────────────────────── */

const AA_TEXT = 4.5;      // WCAG 2.2 1.4.3, normal-size text
const AA_NONTEXT = 3.0;   // WCAG 2.2 1.4.11, UI component boundaries

function auditTheme(themeFile) {
  const base = readFileSync(join(ROOT, 'ojee-ui.css'), 'utf8');
  let tokens = extractTokens(base);
  let label = 'ojee (built-in default)';

  if (themeFile) {
    const themeCss = readFileSync(themeFile, 'utf8');
    tokens = { ...tokens, ...extractTokens(themeCss) };
    label = basename(themeFile);
  }

  const bg = solid('--bg', tokens, [0, 0, 0]);
  if (!bg) throw new Error(`${label}: --bg is missing or unparseable`);
  const bg2 = solid('--bg-2', tokens, bg) ?? bg;
  const panel = solid('--panel', tokens, bg) ?? bg;
  const accent = solid('--accent', tokens, bg);

  const checks = [];
  const add = (what, fg, background, floor, note = '') =>
    checks.push({ what, fg, background, floor, note });

  // Text tokens, against the surfaces they actually appear on.
  for (const t of ['--ink', '--ink-2', '--dim', '--accent', '--ok', '--warn', '--err', '--info']) {
    const c = solid(t, tokens, bg);
    if (c) add(`${t} on --bg`, c, bg, AA_TEXT);
  }
  // --dim and --ink-2 also carry text inside panels, modals and toasts.
  for (const t of ['--ink-2', '--dim']) {
    const c = solid(t, tokens, panel);
    if (c) {
      add(`${t} on --panel`, c, panel, AA_TEXT);
      add(`${t} on --bg-2`, solid(t, tokens, bg2), bg2, AA_TEXT, 'modals, toasts');
    }
  }

  // Text placed ON the accent: buttons, checked boxes, .skip, hot cells.
  const onAccent = solid('--on-accent', tokens, accent ?? bg);
  if (onAccent && accent) add('--on-accent on --accent', onAccent, accent, AA_TEXT);

  // Control boundaries. Worst case is whichever surface is closest in
  // luminance, so check all three rather than assuming.
  const strong = solid('--line-strong', tokens, bg);
  if (strong) {
    add('--line-strong vs --bg', strong, bg, AA_NONTEXT, 'input/toggle/segctl borders');
    add('--line-strong vs --bg-2', strong, bg2, AA_NONTEXT, 'borders inside modals');
    add('--line-strong vs --panel', strong, panel, AA_NONTEXT, 'borders inside panels');
  }

  // Heatmap: colour is a second encoding, but the numeral inside each cell
  // still has to be readable on its own cell.
  const cell0 = solid('--cell-0', tokens, bg);
  const cell0Ink = solid('--cell-0-ink', tokens, cell0 ?? bg);
  if (cell0 && cell0Ink) add('--cell-0-ink on --cell-0', cell0Ink, cell0, AA_TEXT);
  for (const [t, inkToken] of [
    ['--cell-1', '--cell-ink'],
    ['--cell-2', '--cell-ink'],
    ['--cell-3', '--cell-hot-ink'],
  ]) {
    const cell = solid(t, tokens, bg);
    const ink = solid(inkToken, tokens, cell ?? bg);
    if (cell && ink) add(`${inkToken} on ${t}`, ink, cell, AA_TEXT, 'heatmap label');
  }

  // Report.
  let failed = 0;
  const lines = [];
  for (const c of checks) {
    if (!c.fg || !c.background) continue;
    const ratio = contrast(c.fg, c.background);
    const pass = ratio >= c.floor;
    if (!pass) failed++;
    lines.push(
      `  ${pass ? 'PASS' : 'FAIL'}  ${c.what.padEnd(28)} ` +
      `${ratio.toFixed(2).padStart(6)}:1  (need ${c.floor})  ` +
      `${hex(c.fg)} on ${hex(c.background)}${c.note ? '  — ' + c.note : ''}`,
    );
  }

  console.log(`\n${label}  —  ${checks.length} checks, ${failed} failing`);
  console.log(lines.join('\n'));
  return failed;
}

/* ── entry ────────────────────────────────────────────────────────────── */

const args = process.argv.slice(2);
// No args: check the built-in default plus every shipped theme. The template
// is documentation, not a theme, so it is deliberately skipped.
const targets = args.length
  ? args
  : [null, join(ROOT, 'themes', 'ember.css'), join(ROOT, 'themes', 'paper.css')];

let total = 0;
for (const t of targets) total += auditTheme(t);

console.log(
  total === 0
    ? '\nAll themes meet WCAG 2.2 AA for text (4.5:1) and UI boundaries (3:1).\n'
    : `\n${total} check(s) failed.\n`,
);
process.exit(total === 0 ? 0 : 1);
