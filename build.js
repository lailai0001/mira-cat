// XPTV spider bundle builder - auto-generated, do not edit manually
// Reads js/*.js (CSP format), wraps each in isolated scope, bundles with esbuild
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const JS_DIR = path.join(__dirname, 'js');
const DIST_DIR = path.join(__dirname, 'dist');
const SPIDER_FUNCS = ['getConfig', 'getCards', 'getTracks', 'getPlayinfo', 'search'];

function main() {
    const files = fs.readdirSync(JS_DIR).filter(f => f.endsWith('.js')).sort();
    if (!files.length) { console.error('No spiders in js/'); process.exit(1); }

    let parts = [];
    for (const f of files) {
        const name = path.basename(f, '.js');
        const safe = name.replace(/\W/g, '_');
        const code = fs.readFileSync(path.join(JS_DIR, f), 'utf8');
        console.log(`  + ${name}`);
        parts.push(`
;(function(){
var __mod = (function(){
${code}
return {
  appConfig: (typeof appConfig !== 'undefined') ? appConfig : {},
  ${SPIDER_FUNCS.map(fn => `${fn}: (typeof ${fn} !== 'undefined') ? ${fn} : undefined`).join(',\n  ')}
};
})();
__registry["${name}"] = __mod;
})();`);
    }

    const entry = `// mira-cat XPTV bundle - built ${new Date().toISOString()}
var __registry = {};
${parts.join('\n')}
if (typeof globalThis !== 'undefined') { globalThis.__xptvSpiders = __registry; }
if (typeof module !== 'undefined' && module.exports) { module.exports = __registry; }
`;
    const entryPath = path.join(__dirname, 'bundle.entry.js');
    fs.writeFileSync(entryPath, entry);
    if (!fs.existsSync(DIST_DIR)) fs.mkdirSync(DIST_DIR, { recursive: true });
    const out = path.join(DIST_DIR, 'index.js');
    execSync(`npx esbuild ${entryPath} --bundle --minify --platform=node --target=es2020 --outfile=${out}`, {
        cwd: __dirname, stdio: 'inherit'
    });
    const buf = fs.readFileSync(out);
    const md5 = crypto.createHash('md5').update(buf).digest('hex');
    fs.writeFileSync(out + '.md5', md5);
    console.log(`Built ${out} (${buf.length} bytes) md5=${md5}`);
    // cleanup entry
    try { fs.unlinkSync(entryPath); } catch(e) {}
}
main();
