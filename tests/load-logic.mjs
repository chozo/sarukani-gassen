// index.html の <script id="logic"> だけを取り出して、DOM なしで評価する
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

export function loadLogic() {
  const html = readFileSync(fileURLToPath(new URL('../index.html', import.meta.url)), 'utf8');
  const m = html.match(/<script id="logic">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('logic script not found');
  const ctx = vm.createContext({ Math, Object, Infinity });
  vm.runInContext(m[1], ctx, { filename: 'index.html#logic' });
  return ctx.SaruLogic;
}
