// Keep the renderer origin stable even when another installation owns the port.
// IndexedDB and localStorage must never move to a temporary backend origin.
export async function startLocalService({ createServer, options, protocol, externalFetch, log = () => {} }) {
  try { return await createServer(options); }
  catch (error) { if (error.code !== 'EADDRINUSE') throw error; }
  const server = await createServer({ ...options, port: 0 });
  const origin = `http://${options.host}:${options.port}`;
  const target = `http://${options.host}:${server.address().port}`;
  try {
    protocol.handle('http', async request => {
      const url = new URL(request.url);
      if (url.origin !== origin) return externalFetch(request);
      const headers = new Headers(request.headers);
      headers.delete('host');
      if (headers.get('origin') === origin) headers.set('origin', target);
      const init = { method: request.method, headers, redirect: 'manual', signal: request.signal };
      if (!['GET', 'HEAD'].includes(request.method)) { init.body = request.body; init.duplex = 'half'; }
      return fetch(target + url.pathname + url.search, init);
    });
    server.once('close', () => protocol.unhandle('http'));
  } catch (error) { server.close(); throw error; }
  log(`port ${options.port} occupied; backend ${server.address().port}; storage origin retained`);
  return server;
}
