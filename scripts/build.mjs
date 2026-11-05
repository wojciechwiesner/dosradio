import { build } from 'vite';

async function main() {
  await build({
    configFile: './vite.config.ts',
  });
  console.log('Build complete');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
