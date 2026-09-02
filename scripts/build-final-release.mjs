import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const dist = 'dist';
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
fs.mkdirSync(path.join(dist, 'icons'), { recursive: true });

const textFiles = ['index.html', 'app.js', 'app.css', 'planning-worker.js', 'service-worker.js', 'manifest.webmanifest'];
for (const file of textFiles) fs.copyFileSync(file, path.join(dist, file));
for (const file of fs.readdirSync('icons')) fs.copyFileSync(path.join('icons', file), path.join(dist, 'icons', file));
if (fs.existsSync('INSTALL.md')) fs.copyFileSync('INSTALL.md', path.join(dist, 'INSTALL.md'));

const index = fs.readFileSync('index.html', 'utf8');
const css = fs.readFileSync('app.css', 'utf8').replace(/<\/style/gi, '<\\/style');
const js = fs.readFileSync('app.js', 'utf8').replace(/<\/script/gi, '<\\/script');
let standalone = index
  .replace('<link rel="manifest" href="./manifest.webmanifest">', '')
  .replace('<link rel="icon" href="./icons/icon-192.png">', '')
  .replace('<link rel="stylesheet" href="./app.css">', `<style>\n${css}\n</style>`)
  .replace('<script src="./app.js" defer></script>', `<script>\n${js}\n</script>`);
if (standalone.includes('./app.js') || standalone.includes('./app.css')) throw new Error('Standalone build still contains external core asset references.');
const standaloneName = 'LifeOS_4_4_1_Final_Intelligence_Standalone.html';
fs.writeFileSync(path.join(dist, standaloneName), standalone);

const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const manifestFiles = [
  'app.js', 'service-worker.js', 'planning-worker.js', standaloneName
];
const lines = manifestFiles.map(file => `${sha256(path.join(dist, file))}  ${file}`);
fs.writeFileSync(path.join(dist, 'SHA256SUMS.txt'), lines.join('\n') + '\n');

const appHash = sha256('app.js');
const embeddedStart = standalone.indexOf("'use strict';");
const embeddedEnd = standalone.lastIndexOf('</script>');
if (embeddedStart < 0 || embeddedEnd < embeddedStart) throw new Error('Unable to locate embedded application source for parity verification.');
const embedded = standalone.slice(embeddedStart, embeddedEnd).trimEnd();
const source = fs.readFileSync('app.js', 'utf8').trimEnd().replace(/<\/script/gi, '<\\/script');
const embeddedHash = crypto.createHash('sha256').update(embedded).digest('hex');
const sourceHash = crypto.createHash('sha256').update(source).digest('hex');
if (embeddedHash !== sourceHash) throw new Error(`PWA/Standalone app.js parity failed: ${embeddedHash} != ${sourceHash}`);
fs.writeFileSync(path.join(dist, 'BUILD_PROVENANCE.json'), JSON.stringify({
  appVersion: '4.4.1',
  intelligenceModelVersion: '4.4.2',
  dbSchemaVersion: 16,
  appJsSha256: appHash,
  standaloneEmbeddedAppSha256: embeddedHash,
  parity: true,
  sourceCommit: process.env.GITHUB_SHA || ''
}, null, 2) + '\n');
console.log(`Built ${standaloneName}; PWA/Standalone application-source parity PASS.`);
