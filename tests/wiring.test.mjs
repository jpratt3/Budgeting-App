// Wiring tests — the mistakes that don't show up until the browser loads.
//
// The frontend has no build step and no type checker, so three classes of error are
// invisible until runtime: a module importing a name nothing exports, an inline on*
// handler that was never published to window, and a getElementById() pointing at an id
// that no longer exists in the markup. Each of those has bitten this codebase at least
// once; these catch them in CI instead.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

import './helpers.mjs'; // installs the localStorage stub the modules expect

const JS_DIR = 'public/js';
const modules = readdirSync(JS_DIR).filter(f => f.endsWith('.js'));
const src = f => readFileSync(`${JS_DIR}/${f}`, 'utf8');
const html = readFileSync('index.html', 'utf8');
const appSrc = src('app.js');

describe('every module links', () => {
  // app.js is excluded: it is the entry point and touches window at import time.
  // Its imports are verified statically below instead.
  for (const f of modules.filter(f => f !== 'app.js')) {
    test(`${f} imports without error`, async () => {
      await import(`../${JS_DIR}/${f}`);
    });
  }
});

// Names published onto window by app.js — the app's entire public surface.
function windowBindings() {
  const m = appSrc.match(/Object\.assign\(window,\s*\{([\s\S]*?)\}\)/);
  assert.ok(m, 'app.js must publish handlers via Object.assign(window, {...})');
  return new Set(m[1].split(',').map(s => s.trim()).filter(Boolean));
}

// Names imported by app.js, so we can prove each binding resolves to a real export.
function appImports() {
  const names = new Set();
  for (const m of appSrc.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
    for (const raw of m[1].split(',')) {
      const n = raw.trim().split(/\s+as\s+/).pop();
      if (n) names.add(n);
    }
  }
  return names;
}

// Every function named inside an inline on* attribute, from the markup and from the
// template strings the render functions emit.
function handlersUsedInMarkup() {
  const BUILTIN = new Set(['stopPropagation', 'toggle', 'add', 'remove', 'contains', 'preventDefault']);
  const used = new Set();
  for (const text of [html, ...modules.map(src)]) {
    for (const attr of text.matchAll(/\bon(?:click|change|input|keydown|blur|submit)="([^"]*)"/g)) {
      for (const call of attr[1].matchAll(/([A-Za-z_$][\w$]*)\s*\(/g)) {
        const name = call[1];
        // esc(...) and friends run while building the template, not in the attribute.
        if (!BUILTIN.has(name) && !/\$\{[^}]*\b$/.test(attr[1].slice(0, call.index))) used.add(name);
      }
    }
  }
  return used;
}

describe('inline handlers are published to window', () => {
  test('every handler used in markup is bound in app.js', () => {
    const bound = windowBindings();
    const templateHelpers = new Set(['esc']); // interpolated at build time, never called from the attribute
    const missing = [...handlersUsedInMarkup()].filter(n => !bound.has(n) && !templateHelpers.has(n));
    assert.deepEqual(missing, [], `unbound handler(s): ${missing.join(', ')}`);
  });

  test('every binding resolves to something app.js actually imports', () => {
    const imported = appImports();
    const unresolved = [...windowBindings()].filter(n => !imported.has(n));
    assert.deepEqual(unresolved, [], `bound but not imported: ${unresolved.join(', ')}`);
  });
});

describe('DOM ids referenced by JS exist', () => {
  test('every literal getElementById target is present in the markup', () => {
    // ids that appear in index.html, or that a render template creates.
    const known = new Set([...html.matchAll(/\bid="([^"$]+)"/g)].map(m => m[1]));
    for (const f of modules) {
      for (const m of src(f).matchAll(/\bid="([^"$]+)"/g)) known.add(m[1]);
    }
    const missing = [];
    for (const f of modules) {
      // Only single-quoted literals with no concatenation — 'bal-' + key is dynamic.
      for (const m of src(f).matchAll(/getElementById\(\s*'([^']+)'\s*\)/g)) {
        if (!known.has(m[1])) missing.push(`${f}: #${m[1]}`);
      }
    }
    assert.deepEqual(missing, [], `dangling id(s): ${missing.join(', ')}`);
  });
});
