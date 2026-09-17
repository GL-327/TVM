import { spawn } from 'node:child_process';

/**
 * Restarting Core after it applies a downloaded build.
 *
 * On the appliance systemd restarts Core the moment it exits, and the fresh
 * process hops into the new bundle. A desktop package has nobody watching it:
 * the launcher starts Core in the background and walks away, so exiting there
 * simply switched TVM off and left the interface talking to nothing. Without
 * a supervisor, Core now starts its own replacement — after closing its
 * listener, so the new process can bind the same port.
 */

type Handler = () => Promise<void> | void;

let handler: Handler | null = null;

/** index.ts registers the real shutdown; tests and embedded servers do not. */
export function onRestartRequested(next: Handler | null): void {
  handler = next;
}

export function requestRestart(): void {
  // Let the HTTP response that announced the update reach the client first.
  setTimeout(() => {
    if (handler === null) {
      process.exit(0);
      return;
    }
    void Promise.resolve()
      .then(() => handler?.())
      .catch((error: unknown) => {
        console.error('tvm-core: restart failed', error instanceof Error ? error.message : error);
      })
      .finally(() => process.exit(0));
  }, 250);
}

/** systemd sets INVOCATION_ID for every unit it runs; a launcher can opt in explicitly. */
export function supervised(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env['INVOCATION_ID'] ?? '') !== '' || env['TVM_SUPERVISED'] === '1';
}

/** Starts this same entry point again, detached, so it outlives this process. */
export function relaunchDetached(): void {
  const child = spawn(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    cwd: process.cwd(),
    env: process.env,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.unref();
}
