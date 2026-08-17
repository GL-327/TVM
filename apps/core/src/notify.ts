import { spawn } from 'node:child_process';

/**
 * Tell systemd the listening socket is open. Uses systemd-notify so we talk
 * to the datagram socket systemd actually provides. No-ops when
 * NOTIFY_SOCKET is unset (Windows and `pnpm dev`).
 */
export function notifySystemdReady(): void {
  if (process.env['NOTIFY_SOCKET'] === undefined || process.env['NOTIFY_SOCKET'] === '') return;
  try {
    const child = spawn('systemd-notify', ['--ready'], { stdio: 'ignore', detached: true });
    child.on('error', () => {
      // Type=notify will time out if READY never arrives.
    });
    child.unref();
  } catch {
    // Development and Windows have no systemd.
  }
}
