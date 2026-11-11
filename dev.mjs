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
  ['/mark.svg', ['mark.svg', 'image/svg+xml']],
]);
const port = Number(process.env.PORT || 4173);
createServer((req, res) => {
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
  });
  if (req.method === 'HEAD') res.end();
  else createReadStream(path).pipe(res);
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}/`));
