import { defineConfig, loadEnv } from 'vite';

function mapsConfigPlugin(values) {
  const send = (req, res) => {
    res.statusCode = values.key ? 200 : 503;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ key: values.key || '', mapId: values.mapId || '' }));
  };
  return {
    name: 'dehradun-google-maps-runtime-config',
    configureServer(server) {
      server.middlewares.use('/api/maps-config', send);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/maps-config', send);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Keep the original explorer's assets accessible during development, but
  // this procedural scene needs none of them in its production output.
  return {
    plugins: [mapsConfigPlugin({
      key: env.VITE_GOOGLE_MAPS_API_KEY || '',
      mapId: env.VITE_GOOGLE_MAP_ID || '',
    })],
    build: { copyPublicDir: false, chunkSizeWarningLimit: 1800 },
  };
});
