// Starts the local API and Vite together; stops both when either exits or on Ctrl+C.
import { spawn } from 'node:child_process';

const procs = [];
let stopping = false;
const start = (name, cmd, args, color) => {
  const p = spawn(cmd, args, { stdio: ['inherit', 'pipe', 'pipe'], env: process.env });
  const prefix = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (stream, out) => {
    let buf = '';
    stream.on('data', (d) => {
      buf += d.toString();
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const l of lines) out.write(prefix + l + '\n');
    });
  };
  pipe(p.stdout, process.stdout);
  pipe(p.stderr, process.stderr);
  p.on('exit', (code, signal) => {
    if (!stopping) {
      console.error(`${prefix}exited (${signal || code}); stopping the other process.`);
      stop(code || 1);
    }
  });
  procs.push(p);
};
const stop = (code = 0) => {
  stopping = true;
  for (const p of procs) if (p.exitCode === null) p.kill('SIGTERM');
  setTimeout(() => process.exit(code), 300);
};
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

start('api', process.execPath, ['--disable-warning=ExperimentalWarning', '--watch-path=server', 'server/index.ts'], '36');
start('web', process.execPath, ['node_modules/vite/bin/vite.js'], '35');
