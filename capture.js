import fs from 'fs';
import { execSync } from 'child_process';
try {
  execSync('npx vitest run src/core/renderGraph.test.js --reporter=verbose', { stdio: 'pipe' });
  fs.writeFileSync('error.txt', 'SUCCESS');
} catch (e) {
  fs.writeFileSync('error.txt', (e.stdout ? e.stdout.toString() : '') + (e.stderr ? e.stderr.toString() : ''));
}
