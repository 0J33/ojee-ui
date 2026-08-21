#!/usr/bin/env bash
# ============================================================
# ojee-ui DOM checks — driven by agent-browser (not Playwright).
#
# The contrast checker (tests/check-contrast.mjs) proves the TOKENS
# are sound. This proves the RENDERED page is: it serves the
# showcase, then asserts the things only a real layout can answer —
# touch-target sizes, focus rings, reduced-motion, no horizontal
# overflow, the mobile nav swap, and a full axe-core pass.
#
#   bash tests/check-dom.sh            # all themes
#   bash tests/check-dom.sh ember      # one theme
#
# Note: `agent-browser eval` pretty-prints objects across several
# lines, so every probe below deliberately returns a single SCALAR
# (a string or a number). That keeps the harness free of JSON
# parsing, which is where the first version of this script went
# wrong — it double-encoded and reported false failures.
# ============================================================
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${OJEE_UI_TEST_PORT:-4173}"
BASE="http://127.0.0.1:${PORT}"
if [ "$#" -gt 0 ]; then THEMES=("$@"); else THEMES=(ojee ember paper); fi

fail=0; pass=0
ok()  { pass=$((pass+1)); printf '  PASS  %s\n' "$*"; }
bad() { fail=$((fail+1)); printf '  FAIL  %s\n' "$*"; }

# ── serve the showcase ──────────────────────────────────────────────
python3 -m http.server "$PORT" --bind 127.0.0.1 --directory "$ROOT" >/dev/null 2>&1 &
SERVER_PID=$!

# Own a private browser session so this never hijacks another agent's
# page, and always tear both down — including on failure.
export AGENT_BROWSER_SESSION="ojee-ui-test-$$"
cleanup() {
  agent-browser close >/dev/null 2>&1
  kill "$SERVER_PID" >/dev/null 2>&1
  wait "$SERVER_PID" 2>/dev/null
}
trap cleanup EXIT

for _ in $(seq 1 50); do
  curl -fsS "$BASE/index.html" >/dev/null 2>&1 && break
  sleep 0.1
done

# Evaluate an expression and return its single-line scalar result,
# stripped of the surrounding quotes agent-browser prints for strings.
ev() { agent-browser eval "$1" 2>/dev/null | tail -n 1 | sed 's/^"//; s/"$//'; }

for THEME in "${THEMES[@]}"; do
  printf '\n=== theme: %s ============================================\n' "$THEME"
  agent-browser open "${BASE}/index.html?theme=${THEME}" >/dev/null 2>&1
  agent-browser set viewport 1280 900 >/dev/null 2>&1
  agent-browser wait 400 >/dev/null 2>&1

  # 1. The theme actually applied. Without this every check below
  #    could pass against the default palette for the wrong reason.
  applied=$(ev "getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()")
  want_bg="unknown"
  case "$THEME" in ojee) want_bg="#08080e";; ember) want_bg="#0d0a06";; paper) want_bg="#f6f5f1";; esac
  if [ "$applied" = "$want_bg" ]; then
    ok "theme applied — --bg is ${applied}"
  else
    bad "theme did not apply — --bg is '${applied}', expected '${want_bg}'"
  fi

  # 2. Touch targets. Small controls keep their drawn size and extend
  #    an invisible ::after hit area, so measuring the border box
  #    alone gives false failures — probe 21px above and below the
  #    centre with elementFromPoint and check the hit lands on the
  #    control (or its own pseudo-element, which reports as the
  #    element itself).
  small=$(ev "(() => {
    const sel = 'button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab], .tab, .nav-link, .tabitem, .togrow, .gate';
    const bad = [];
    for (const el of document.querySelectorAll(sel)) {
      if (el.closest('[aria-hidden=true]')) continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.height >= 44 && r.width >= 44) continue;
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      if (cx < 0 || cx > innerWidth) continue;
      const reach = [cy - 21, cy + 21].every(y => {
        if (y < 0 || y > innerHeight) return true;
        const hit = document.elementFromPoint(cx, y);
        return hit && (hit === el || el.contains(hit) || hit.contains(el));
      });
      if (!reach) bad.push((el.className || el.tagName) + '@' + Math.round(r.width) + 'x' + Math.round(r.height));
    }
    return bad.length ? bad.slice(0, 6).join(' | ') : 'ok';
  })()")
  [ "$small" = "ok" ] && ok "every interactive element reaches a 44px hit area" \
                      || bad "under 44px with no extended hit area: ${small}"

  # 3. Focus ring. The system leans on hover, which phones do not
  #    have — the keyboard path needs its own visible affordance.
  #    Focus must come from a real key press for :focus-visible to
  #    match; a scripted .focus() alone does not always qualify.
  agent-browser press Tab >/dev/null 2>&1
  ring=$(ev "(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return 'nothing focused';
    const s = getComputedStyle(el);
    const w = parseFloat(s.outlineWidth) || 0;
    return (w >= 2 && s.outlineStyle !== 'none') ? 'ok' : (el.className + ' outline:' + s.outlineStyle + ' ' + s.outlineWidth);
  })()")
  [ "$ring" = "ok" ] && ok "keyboard focus draws a >=2px ring" || bad "focus ring missing: ${ring}"

  # 4. Reduced motion collapses every duration. All transitions route
  #    through --dur / --dur-2, so one media block should take the
  #    whole page to ~0 — verify rather than assume.
  agent-browser set media reduced-motion >/dev/null 2>&1
  agent-browser wait 250 >/dev/null 2>&1
  slow=$(ev "[...document.querySelectorAll('*')].filter(el => {
    const cs = getComputedStyle(el);
    return Math.max(parseFloat(cs.transitionDuration) || 0, parseFloat(cs.animationDuration) || 0) > 0.05;
  }).length")
  [ "$slow" = "0" ] && ok "prefers-reduced-motion collapses all transitions" \
                    || bad "${slow} element(s) still animating under reduced-motion"
  agent-browser set media dark >/dev/null 2>&1
  agent-browser wait 150 >/dev/null 2>&1

  # 5. No horizontal overflow. Wide content (tables, charts) must
  #    scroll inside its own container, never the body.
  for W in 375 768 1024; do
    agent-browser set viewport "$W" 800 >/dev/null 2>&1
    agent-browser wait 250 >/dev/null 2>&1
    over=$(ev "document.documentElement.scrollWidth - window.innerWidth")
    if [ -n "$over" ] && [ "$over" -le 1 ] 2>/dev/null; then
      ok "no horizontal overflow at ${W}px"
    else
      culprit=$(ev "(() => {
        const w = innerWidth;
        for (const el of document.querySelectorAll('*')) {
          const r = el.getBoundingClientRect();
          if (r.right > w + 1 || r.left < -1) return el.tagName + '.' + (el.className || '?') + ' right=' + Math.round(r.right);
        }
        return 'unknown';
      })()")
      bad "horizontal overflow at ${W}px by ${over}px — ${culprit}"
    fi
  done

  # 6. Mobile nav swap. Below 860px the top links give way to the
  #    fixed bottom tab bar; both visible at once is a regression.
  agent-browser set viewport 375 800 >/dev/null 2>&1
  agent-browser wait 250 >/dev/null 2>&1
  nav=$(ev "(() => {
    const links = getComputedStyle(document.querySelector('.nav-links')).display;
    const bar = getComputedStyle(document.querySelector('.tabbar')).display;
    return (links === 'none' && bar !== 'none') ? 'ok' : ('links=' + links + ' bar=' + bar);
  })()")
  [ "$nav" = "ok" ] && ok "mobile: top links hidden, bottom tab bar shown" \
                    || bad "mobile nav swap wrong: ${nav}"

  # 7. The tab bar must not cover the last of the content.
  clearance=$(ev "(() => {
    const bar = document.querySelector('.tabbar').getBoundingClientRect().height;
    const pad = parseFloat(getComputedStyle(document.querySelector('.wrap')).paddingBottom);
    return pad >= bar ? 'ok' : ('pad=' + Math.round(pad) + ' bar=' + Math.round(bar));
  })()")
  [ "$clearance" = "ok" ] && ok "content clears the fixed tab bar" \
                          || bad "content sits under the tab bar: ${clearance}"

  # 8. axe-core. Catches the generic WCAG failures a bespoke test
  #    would never think to look for — roles, names, landmarks, order.
  #
  #    Only VIOLATIONS fail the build. axe also reports "incomplete"
  #    for things it cannot decide, and on this system that is always
  #    the same one: `color-contrast` cannot resolve a background
  #    because the root paints a GRADIENT and every surface above it
  #    is translucent, so axe has no single colour to measure against.
  #    That is exactly the gap tests/check-contrast.mjs fills — it
  #    composites the tokens numerically instead of sampling pixels.
  #    Treating incomplete as failure here would mean 345 permanent
  #    false positives and a suite nobody trusts.
  agent-browser set viewport 1280 900 >/dev/null 2>&1
  agent-browser wait 250 >/dev/null 2>&1
  agent-browser a11y --tags wcag2a,wcag2aa,wcag21a,wcag21aa --json >/tmp/ojee-ui-axe.json 2>/dev/null
  axe=$(node -e '
    const fs = require("fs");
    let j;
    try { j = JSON.parse(fs.readFileSync("/tmp/ojee-ui-axe.json", "utf8")); }
    catch { console.log("unparsed"); process.exit(0); }
    const d = j.data || j;
    const v = d.violations || [];
    const inc = (d.incomplete || []).map(x => `${x.id}(${x.nodeCount})`);
    if (v.length) {
      console.log("VIOLATION " + v.map(x => `${x.id}[${x.impact}]:${x.nodeCount}`).join(" "));
    } else {
      console.log("clean " + (inc.length ? "incomplete=" + inc.join(",") : "incomplete=none"));
    }
  ' 2>/dev/null)
  case "$axe" in
    clean*)     ok "axe-core: 0 violations  (${axe#clean })" ;;
    unparsed)   bad "axe-core produced no parseable output" ;;
    *)          bad "axe-core ${axe}" ;;
  esac
done

printf '\n================================================================\n'
printf '  %d passed, %d failed\n' "$pass" "$fail"
printf '================================================================\n'
[ "$fail" -eq 0 ] || exit 1
