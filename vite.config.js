import { defineConfig, loadEnv } from 'vite';
import { createCityMapMiddleware } from './server/city-map.js';
import { createGeocodeMiddleware } from './server/geocode.js';
import cesium from 'vite-plugin-cesium';

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
      server.middlewares.use('/api/city-map', createCityMapMiddleware());
      server.middlewares.use('/api/geocode', createGeocodeMiddleware({ key: values.key }));
      server.middlewares.use('/api/cesium-config', values.cesiumConfig);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api/maps-config', send);
      server.middlewares.use('/api/city-map', createCityMapMiddleware());
      server.middlewares.use('/api/geocode', createGeocodeMiddleware({ key: values.key }));
      server.middlewares.use('/api/cesium-config', values.cesiumConfig);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  // Keep the original explorer's assets accessible during development, but
  // this procedural scene needs none of them in its production output.
  return {
    plugins: [cesium(), mapsConfigPlugin({
      key: env.VITE_GOOGLE_MAPS_API_KEY || '',
      mapId: env.VITE_GOOGLE_MAP_ID || '',
      cesiumConfig(_req, res) {
        const liveEnv = loadEnv(mode, process.cwd(), '');
        const token = liveEnv.VITE_CESIUM_ION_TOKEN || env.VITE_CESIUM_ION_TOKEN || process.env.VITE_CESIUM_ION_TOKEN || '';
        const googleTilesKey = liveEnv.VITE_GOOGLE_MAPS_API_KEY || env.VITE_GOOGLE_MAPS_API_KEY || process.env.VITE_GOOGLE_MAPS_API_KEY || '';
        res.statusCode = token ? 200 : 503;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({ token, googleTilesKey }));
      },
    })],
    build: { copyPublicDir: false, chunkSizeWarningLimit: 1800 },
  };
});
