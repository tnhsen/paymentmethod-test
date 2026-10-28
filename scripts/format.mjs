// Deterministic source formatting using the workspace TypeScript compiler.
import ts from 'typescript';
import { readdir, readFile, writeFile } from 'node:fs/promises';
const printer = ts.createPrinter({ newLine: ts.NewLineKind.LineFeed });
async function format(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', '.next', '.git', 'test-results'].includes(entry.name)) continue;
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) await format(path);
    else if (/\.(ts|tsx)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      const source = ts.createSourceFile(path, await readFile(path, 'utf8'), ts.ScriptTarget.Latest, true);
      await writeFile(path, printer.printFile(source));
    } else if (entry.name.endsWith('.json')) {
      await writeFile(path, JSON.stringify(JSON.parse(await readFile(path, 'utf8')), null, 2) + '\n');
    }
  }
}
for (const dir of ['packages', 'examples', 'tests']) await format(dir);
