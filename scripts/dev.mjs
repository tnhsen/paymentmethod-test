import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const children = new Set();
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  for (const child of children) child.kill('SIGTERM');
}

function launch(name, entry) {
  const child = spawn(process.execPath, ['--import', 'tsx', entry], {
    cwd: root,
    env: process.env,
    stdio: 'inherit',
    windowsHide: true,
  });
  children.add(child);
  child.on('error', (error) => {
    console.error(`[${name}] ${error.message}`);
    stop(1);
  });
  child.on('exit', (code, signal) => {
    children.delete(child);
    if (!stopping) {
      console.error(`[${name}] stopped (${signal ?? code}); stopping both services.`);
      stop(code || 1);
    }
  });
}

process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
process.on('exit', () => {
  for (const child of children) child.kill('SIGTERM');
});

console.log('Starting payment API listener and demo UI (Ctrl+C stops both).');
console.log(`API: http://localhost:${process.env.PORT ?? 4000}`);
console.log(`UI:  http://localhost:${process.env.DEMO_PORT ?? 5173}`);
launch('API', 'packages/server/src/main.ts');
launch('UI', 'examples/plain-html/server.ts');
