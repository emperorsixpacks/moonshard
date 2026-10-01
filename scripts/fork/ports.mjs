import net from 'node:net';

/** Ask the OS for a free TCP port (test servers must never collide with whatever else runs on this machine). */
export function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** Start `vite` on a free port and wait until it serves THIS app (not some other dev server). */
export async function waitForMoonshard(url, { tries = 120 } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok && (await res.text()).includes('Moonshard')) return;
    } catch { /* still starting */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Moonshard dev server did not come up at ${url}`);
}
