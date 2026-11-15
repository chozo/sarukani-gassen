// 公開用ファイルを dist/sarukani-gassen/ に書き出す（index.html と public/ の中身）。毎回 dist/ を空にしてから出力する
// 使い方: npm run build
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'dist', 'sarukani-gassen');
fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(root, 'index.html'), path.join(out, 'index.html'));
fs.cpSync(path.join(root, 'public'), out, { recursive: true });
console.log(fs.readdirSync(out).map(f => `dist/sarukani-gassen/${f}`).join('\n'));
