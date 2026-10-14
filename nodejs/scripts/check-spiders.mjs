/**
 * Spider health check — pre-push gate for the MiraPlayer bundle.
 *
 * Background: 2026-10-14, shipping a spider whose createSpider() returns null
 * (soft-delete attempt on SupJAV) broke the user's whole bundle import —
 * the app hung on import ("一直卡在这"). The engine requires every spider
 * module to default-export a factory returning a non-null object with
 * meta {key, name, type} and an api function. A null/invalid spider throws
 * during registration and aborts initialization.
 *
 * This script mirrors that validation locally: import every spider file,
 * call its factory, and assert the result is a valid spider object.
 * Run before every push:  node scripts/check-spiders.mjs
 * Exit 0 = all healthy; exit 1 = list of broken spiders.
 */
import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';

const spiderDir = path.resolve('src/spider/video');
const files = fs.readdirSync(spiderDir).filter((f) => f.endsWith('.js')).sort();

let ok = 0;
const broken = [];

for (const file of files) {
    const label = `video/${file}`;
    try {
        const mod = await import(pathToFileURL(path.join(spiderDir, file)).href);
        const exported = mod.default;
        let spider;
        if (typeof exported === 'function') {
            // 工厂格式: export default function createSpider()
            try {
                spider = await exported();
            } catch (e) {
                broken.push([label, `factory threw: ${e.message}`]);
                continue;
            }
        } else if (exported && typeof exported === 'object') {
            // 旧格式: export default { meta, api }（loader 兼容）
            // 或数组格式: export default [spider, ...]（如 cmsources.js）
            spider = exported;
        } else {
            broken.push([label, `default export is ${exported === null ? 'null' : typeof exported} (no factory, no object)`]);
            continue;
        }
        const candidates = Array.isArray(spider) ? spider : [spider];
        if (!candidates.length) {
            broken.push([label, 'exports an empty spider array']);
            continue;
        }
        const problems = [];
        for (const s of candidates) {
            if (s === null || typeof s !== 'object') {
                problems.push(`entry is ${s === null ? 'null' : typeof s} (would break app import)`);
                continue;
            }
            const meta = s.meta || {};
            if (!meta.key || !meta.name || meta.type === undefined) {
                problems.push(`invalid meta: ${JSON.stringify(meta)}`);
                continue;
            }
            if (typeof s.api !== 'function') {
                problems.push(`spider(${meta.key}).api is not a function`);
            }
        }
        if (problems.length) {
            broken.push([label, problems.join('; ')]);
            continue;
        }
        ok++;
    } catch (e) {
        broken.push([label, `import failed: ${e.message}`]);
    }
}

console.log(`checked ${files.length} spiders: ${ok} ok, ${broken.length} broken`);
for (const [label, reason] of broken) {
    console.log(`  BROKEN ${label}: ${reason}`);
}
process.exit(broken.length ? 1 : 0);
