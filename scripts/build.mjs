import { readFile } from 'node:fs/promises'
import { build } from 'esbuild'
import { buildViewerRuntime } from './patch-viewer.mjs'

const { name } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
await Promise.all([buildViewerRuntime(), build({
  entryPoints: ['src/client.jsx'],
  outfile: 'lib/client.cjs',
  bundle: true,
  platform: 'browser',
  format: 'cjs',
  target: 'es2022',
  jsx: 'automatic',
  external: ['react', 'react/jsx-runtime'],
  loader: { '.css': 'text' },
  banner: {
    js: `window.__ModuleLoader__.load({id:${JSON.stringify(name)},factory:(require)=>{var module={exports:{}};var exports=module.exports;`,
  },
  footer: { js: 'return module.exports;}});' },
})])
