#!/usr/bin/env node
/**
 * Turn tools/icons.json into the artefacts each surface consumes.
 *
 * Two shapes, one source. Sprite surfaces (this file, the console shell, the
 * remote and home modules) want <symbol> elements; the React surfaces (teg,
 * storage) want a map of path data. Generating both from the same map is the
 * point — six hand-drawn registries is how `close` ended up with five
 * different stroke weights.
 *
 *   node tools/build-icons.mjs                 # print the sprite
 *   node tools/build-icons.mjs --json          # { name: pathdata }
 *   node tools/build-icons.mjs --only a,b,c    # just these names
 */
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const spec = JSON.parse(readFileSync(join(here, 'icons.json'), 'utf8'));

/** Where the pack's SVGs are. Set ICONS_PACK to point at a checkout. */
const PACK = process.env.ICONS_PACK
  || join(here, '..', 'node_modules', '@material-symbols', 'svg-400', 'outlined');

const packPath = (name) => {
  const f = join(PACK, `${name}.svg`);
  if (!existsSync(f)) throw new Error(`${name}: not in the pack at ${PACK}`);
  const m = /\sd="([^"]+)"/.exec(readFileSync(f, 'utf8'));
  if (!m) throw new Error(`${name}: no path data`);
  return m[1];
};

/** name -> { d, rotate } for every icon in the set. */
export function build() {
  const out = {};
  for (const [ours, theirs] of Object.entries(spec.map)) out[ours] = { d: packPath(theirs) };
  for (const [ours, [theirs, deg]] of Object.entries(spec.rotate)) {
    // A rotation is not a redraw: the vertical louvre is the horizontal one
    // turned, and drawing it twice is how a set drifts.
    out[ours] = { d: packPath(theirs), rotate: deg };
  }
  for (const [ours, d] of Object.entries(spec.draw)) out[ours] = { d, drawn: true };
  return out;
}

const icons = build();
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null;
const wanted = Object.entries(icons).filter(([n]) => !only || only.includes(n));

if (args.includes('--json')) {
  process.stdout.write(JSON.stringify(Object.fromEntries(
    wanted.map(([n, v]) => [n, v.rotate ? { d: v.d, rotate: v.rotate } : v.d])), null, 2) + '\n');
} else {
  const sym = ([n, v]) => {
    const t = v.rotate ? ` transform="rotate(${v.rotate} 480 -480)"` : '';
    return `  <symbol id="i-${n}" viewBox="0 -960 960 960"><path d="${v.d}"${t}/></symbol>`;
  };
  process.stdout.write(wanted.map(sym).join('\n') + '\n');
}
