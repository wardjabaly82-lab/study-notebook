// Builds the Claude connector: bundles the server into one file, then packs
// it with the official MCPB tool into build/Study Notebook.mcpb, which the
// installer ships and students double-click to add to the Claude app.
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const esbuild = require('esbuild');

const root = path.join(__dirname, '..');
const src = path.join(root, 'connector');
const out = path.join(src, 'dist');
const bundle = path.join(root, 'build', 'Study Notebook.mcpb');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'server'), { recursive: true });

esbuild.buildSync({
  entryPoints: [path.join(src, 'src', 'server.js')],
  outfile: path.join(out, 'server', 'index.js'),
  bundle: true, platform: 'node', target: 'node18', format: 'cjs',
  legalComments: 'inline', logLevel: 'warning'
});

const manifest = JSON.parse(fs.readFileSync(path.join(src, 'manifest.json'), 'utf8'));
manifest.version = require(path.join(root, 'package.json')).version;
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
fs.copyFileSync(path.join(src, 'icon.png'), path.join(out, 'icon.png'));

const cli = path.join(root, 'node_modules', '@anthropic-ai', 'mcpb', 'dist', 'cli', 'cli.js');
const run = (...args) => execFileSync(process.execPath, [cli, ...args], { stdio: 'inherit' });
run('validate', path.join(out, 'manifest.json'));
fs.rmSync(bundle, { force: true });
run('pack', out, bundle);
console.log('Built', path.relative(root, bundle));
