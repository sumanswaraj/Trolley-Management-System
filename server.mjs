import { fileURLToPath } from 'node:url';
import { createApp } from './src/http/application.mjs';

export { createApp } from './src/http/application.mjs';

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 8080);
  const { server, repository } = createApp();
  server.listen(port, host, () => {
    console.log(JSON.stringify({ event: 'started', host, port }));
  });
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      console.log(JSON.stringify({ event: 'shutdown', signal }));
      server.close(() => { repository.close(); process.exit(0); });
      setTimeout(() => { server.closeAllConnections(); }, 5000).unref();
    });
  }
}
