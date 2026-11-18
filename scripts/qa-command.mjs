import { spawn } from 'node:child_process';

/** Await Node tools without starving HTTP socket and cancellation events in the parent. */
export function runNodeCommand(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { stdio: 'inherit', windowsHide: true, ...options });
    child.once('error', reject);
    child.once('close', (code) => resolve(code ?? 1));
  });
}
