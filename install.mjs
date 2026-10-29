#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const source = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (args.some((v,i) => !['--dry-run','--force','--destination'].includes(v) && args[i-1] !== '--destination')) throw new Error('Usage: node install.mjs [--dry-run] [--force] [--destination PATH]');
const index = args.indexOf('--destination');
if (index >= 0 && (!args[index+1] || args[index+1].startsWith('--'))) throw new Error('--destination requires a path');
const destination = path.resolve(index >= 0 ? args[index+1] : process.env.CODEX_HOME || path.join(os.homedir(), '.codex'));
if (destination === source || destination.startsWith(source + path.sep)) throw new Error('Install destination must be outside this repository');
const dry = args.includes('--dry-run'), force = args.includes('--force');
function walk(dir) {
  return fs.readdirSync(dir, {withFileTypes:true}).flatMap(entry => {
    if (entry.name === 'data' || entry.isSymbolicLink()) return [];
    const full = path.join(dir,entry.name);
    return entry.isDirectory() ? walk(full) : entry.isFile() ? [full] : [];
  });
}
const files = ['skills','agents'].flatMap(dir => walk(path.join(source,dir))).map(file => {
  const relative = path.relative(source,file), target = path.join(destination,relative);
  // Refuse symlinked destination components to avoid writing through unexpected links.
  for (let part = target; ; part = path.dirname(part)) {
    if (fs.existsSync(part) && fs.lstatSync(part).isSymbolicLink()) throw new Error('Symlinked destination: '+part);
    if (path.dirname(part) === part) break;
  }
  const exists = fs.existsSync(target);
  if (exists && !fs.statSync(target).isFile()) throw new Error('Target is not a file: '+target);
  return {file,relative,target,exists,changed:!exists || !fs.readFileSync(file).equals(fs.readFileSync(target))};
}).filter(item => item.changed);
const conflicts = files.filter(item => item.exists);
if (conflicts.length && !force) throw new Error('Existing files differ; review and use --force to back up and replace: '+conflicts.map(item=>item.relative).join(', '));
const backup = path.join(destination,'workflow-backups',new Date().toISOString().replaceAll(':','-')+'-'+process.pid);
for (const item of files) {
  if (dry) { console.log('Would install: '+item.target); continue; }
  if (item.exists) {
    const saved = path.join(backup,item.relative);
    fs.mkdirSync(path.dirname(saved),{recursive:true}); fs.copyFileSync(item.target,saved,fs.constants.COPYFILE_EXCL);
  }
  fs.mkdirSync(path.dirname(item.target),{recursive:true}); fs.copyFileSync(item.file,item.target);
}
console.log(`${dry?'Previewed':'Installed'} ${files.length} files at ${destination}`);
if (conflicts.length && !dry) console.log('Backups: '+backup);
