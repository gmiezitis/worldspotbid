import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import worldMap from '@svg-maps/world';

const projectDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = resolve(projectDirectory, 'public/map');
const maximumChunkBytes = 180_000;
const chunks = [];
let currentChunk = [];
let currentSize = 2;

for (const location of worldMap.locations) {
  if (!/^[a-z]{2}$/.test(location.id)) continue;
  const serializedSize = Buffer.byteLength(JSON.stringify(location)) + 1;
  if (currentChunk.length > 0 && currentSize + serializedSize > maximumChunkBytes) {
    chunks.push(currentChunk);
    currentChunk = [];
    currentSize = 2;
  }
  currentChunk.push(location);
  currentSize += serializedSize;
}

if (currentChunk.length > 0) chunks.push(currentChunk);

rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(outputDirectory, { recursive: true });

const chunkFiles = chunks.map((locations, index) => {
  const filename = `world-${index}.json`;
  writeFileSync(resolve(outputDirectory, filename), JSON.stringify(locations));
  return filename;
});

writeFileSync(resolve(outputDirectory, 'index.json'), JSON.stringify({
  viewBox: worldMap.viewBox,
  chunks: chunkFiles,
}));
