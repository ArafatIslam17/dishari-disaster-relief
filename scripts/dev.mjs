// `pnpm dev`: API (after the database is reachable) and the PWA together, with both URLs printed.
import concurrently from 'concurrently';

const API = 'http://localhost:4000/api/health';
const WEB = 'http://localhost:5173';

console.info(`
  Relief Coordination - development
  ---------------------------------
  Web app (field app + dashboard): ${WEB}
  API:                             ${API}
  The API waits for PostgreSQL (DATABASE_URL in .env) before it starts.
`);

const { result } = concurrently(
  [
    { command: 'node scripts/workspace.mjs api dev', name: 'api', prefixColor: 'cyan' },
    { command: 'node scripts/workspace.mjs web dev', name: 'web', prefixColor: 'magenta' },
  ],
  { killOthersOn: ['failure'], restartTries: 0 },
);

result.then(
  () => process.exit(0),
  () => process.exit(1),
);
