import { once } from 'node:events';
import { performance } from 'node:perf_hooks';
import { createApp } from '../server.mjs';

// Always creates an isolated database; never targets a production installation.
const { server, repository } = createApp({
  dbPath: ':memory:',
  adminPassword: 'isolated-load-test-password',
  logger: () => {},
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
try {
  const login = await fetch(base + '/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'admin', password: 'isolated-load-test-password' }),
  });
  if (!login.ok) throw new Error('Load-test login failed');
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const post = async (path, input) => {
    const response = await fetch(base + '/api/' + path, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(`Fixture setup failed: ${path}`);
  };
  await post('locations', { id: 'STORE', name: 'Store' });
  await post('locations', { id: 'LINE', name: 'Line' });
  await post('products', { id: 'P1', name: 'Component' });
  for (let index = 0; index < 50; index++) {
    await post('trolleys', {
      id: `TR-${index}`,
      type: 'Component',
      capacity: 100,
      location: 'STORE',
    });
  }
  const concurrentClients = 20;
  const requestsPerClient = 20;
  const durations = [];
  const start = performance.now();
  await Promise.all(
    Array.from({ length: concurrentClients }, async () => {
      for (let index = 0; index < requestsPerClient; index++) {
        const requestStart = performance.now();
        const response = await fetch(base + '/api/state', { headers: { Cookie: cookie } });
        const state = await response.json();
        if (!response.ok || state.trolleys.length !== 50)
          throw new Error('Shared-state load smoke failed');
        durations.push(performance.now() - requestStart);
      }
    }),
  );
  const elapsed = performance.now() - start;
  durations.sort((a, b) => a - b);
  const requests = concurrentClients * requestsPerClient;
  console.log(
    JSON.stringify({
      kind: 'isolated_local_smoke',
      node: process.version,
      concurrentClients,
      fleetSize: 50,
      requests,
      failures: 0,
      elapsedMs: Math.round(elapsed),
      requestsPerSecond: Math.round((requests * 1000) / elapsed),
      p50Ms: Math.round(durations[Math.floor(durations.length * 0.5)]),
      p95Ms: Math.round(durations[Math.floor(durations.length * 0.95)]),
      limitation: 'Local read-only smoke; not a production capacity or enterprise SLA measurement',
    }),
  );
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  repository.close();
}
