/**
 * E2E fixture setup: copy the built client bundle and the React UMD runtimes
 * into test/e2e/ so harness.html can load them via <script>. Run before the
 * e2e runners. Idempotent; the copied files are gitignored.
 */
import { copyFileSync, existsSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(DIR, '..', '..')

function need(path, hint) {
  if (!existsSync(path)) throw new Error(`missing ${path} — ${hint}`)
  return path
}

// Runtime deps resolve by Node's own up-the-tree rules (a git worktree has no
// node_modules of its own; the shared install lives in the main checkout).
// React's `exports` map hides the /umd subpath, so anchor on package.json.
const require = createRequire(import.meta.url)
function dep(pkg, rel, hint) {
  let root
  try {
    root = dirname(require.resolve(`${pkg}/package.json`))
  } catch {
    throw new Error(`missing ${pkg} — ${hint}`)
  }
  return need(resolve(root, rel), hint)
}

// Built client bundle.
need(resolve(ROOT, 'lib/client.js'), 'run `node build.mjs` first')
copyFileSync(resolve(ROOT, 'lib/client.js'), resolve(DIR, 'client.js'))
// The editor chunk is loaded for real (harness.html `require.async`), so the
// e2e runs exercise the shipped CodeMirror bundle.
need(resolve(ROOT, 'lib/client.editor.js'), 'run `node build.mjs` first')
copyFileSync(resolve(ROOT, 'lib/client.editor.js'), resolve(DIR, 'client.editor.js'))

// React + ReactDOM UMD production builds. NOTE: React 19 removed the /umd
// entrypoints; this fixture (and the pinned react 18.3.1 devDep) depends on
// them, so bumping React past 18 requires vendoring these files instead.
copyFileSync(dep('react', 'umd/react.production.min.js', 'install react (18.x; React 19 dropped /umd)'), resolve(DIR, 'react.production.min.js'))
copyFileSync(dep('react-dom', 'umd/react-dom.production.min.js', 'install react-dom (18.x; React 19 dropped /umd)'), resolve(DIR, 'react-dom.production.min.js'))

// Minimal jsx-runtime shim over React.createElement (UMD ships none).
writeFileSync(resolve(DIR, 'react-jsx-runtime.js'), `(function(){
  var R = window.React;
  function jsx(type, props, key){
    var config = {}; for (var k in props) if (k !== 'children') config[k] = props[k];
    if (key !== undefined) config.key = key;
    var children = props && props.children;
    if (children === undefined) return R.createElement(type, config);
    if (Array.isArray(children)) return R.createElement.apply(null, [type, config].concat(children));
    return R.createElement(type, config, children);
  }
  window.jsxRuntime = { jsx: jsx, jsxs: jsx, Fragment: R.Fragment };
})();
`)

console.log('e2e fixtures ready in', DIR)
