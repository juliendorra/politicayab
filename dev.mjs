import { createServer } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const routes = new Map([
  ['/', ['index.html', 'text/html']],
  ['/style.css', ['style.css', 'text/css']],
  ['/src/app.js', ['src/app.js', 'text/javascript']],
  ['/src/design.js', ['src/design.js', 'text/javascript']],
  ['/src/art.js', ['src/art.js', 'text/javascript']],
  ['/src/knit.js', ['src/knit.js', 'text/javascript']],
  ['/src/ayab-png.js', ['src/ayab-png.js', 'text/javascript']],
  ['/src/color-names.js', ['src/color-names.js', 'text/javascript']],
  ['/src/data/color-names.tsv', ['src/data/color-names.tsv', 'text/tab-separated-values']],
  ['/src/data/yarn-swatches.tsv', ['src/data/yarn-swatches.tsv', 'text/tab-separated-values']],
  ['/mark.svg', ['mark.svg', 'image/svg+xml']],
]);
for (const font of ['pixelify-sans', 'silkscreen', 'press-start-2p', 'tiny5', 'vt323']) {
  const path = `src/fonts/${font}.ttf`;
  routes.set('/' + path, [path, 'font/ttf']);
}
const port = Number(process.env.PORT || 4173);
const host = '127.0.0.1';
const url = `http://${host}:${port}/`;
const identityHeader = 'x-politicayab-preview';
const server = createServer((req, res) => {
  const target = routes.get(req.url?.split('?')[0]);
  if (!target || !['GET', 'HEAD'].includes(req.method)) {
    res.writeHead(404).end();
    return;
  }
  const path = fileURLToPath(new URL(target[0], import.meta.url));
  res.writeHead(200, {
    'Content-Type': `${target[1]}; charset=utf-8`,
    'Content-Length': statSync(path).size,
    'Cache-Control': 'no-store',
    [identityHeader]: '1',
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(path).pipe(res);
});

server.on('error', async error => {
  if (error.code === 'EADDRINUSE') {
    try {
      const response = await fetch(url, {
        method: 'HEAD',
        redirect: 'error',
        signal: AbortSignal.timeout(1500),
      });
      if (response.ok && response.headers.get(identityHeader) === '1') {
        console.log(`PoliticAYAB is already running at ${url}`);
        return;
      }
    } catch {
      // An unrelated listener may not speak HTTP.
    }
    console.error(`Port ${port} is in use. Set PORT to a free port and run npm start again.`);
  } else {
    console.error(error.message);
  }
  process.exitCode = 1;
});

server.listen(port, host, () => console.log(`http://${host}:${server.address().port}/`));
