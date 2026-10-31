import { buildSite } from './lib/site.mjs';

const outDir = process.argv[2] ?? '_site';
const catalog = buildSite(process.cwd(), outDir);
console.log(`${catalog.mods.length} mod(s) publicados em ${outDir}`);
