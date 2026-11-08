// Runtime configuration from environment variables (.env is loaded by server/index.ts).
// Secrets are kept here only as values used by the backend; they are never logged or returned.
import path from 'node:path';

export type RoutingProviderName = 'provided_distance' | 'manual' | 'fixture' | 'here';

export type Config = {
  version: string;
  host: string;
  port: number;
  sqlitePath: string;
  dataDir: string;
  uploadsDir: string;
  maxUploadBytes: number;
  allowedOrigins: string[];
  allowedHosts: string[];
  webPorts: number[];
  lanAccess: boolean;
  geminiApiKey: string;
  geminiModel: string;
  aiEnabled: boolean;
  autoReviewImports: boolean;
  discoveryAfterCalculation: boolean;
  routingProvider: RoutingProviderName;
  hereApiKey: string;
  logLevel: string;
  nature: NatureConfig;
};

// The nature model (Python builders + SQLite) lives in nature_model/. TraceFlow reads its database
// read-only; every write (rebuild, saved query runs, nutrient runs) goes through its Python tools.
export type NatureConfig = {
  modelDir: string;
  dbPath: string;
  python: string;
  dataDir: string | null;
  jobTimeoutMs: number;
};

export const APP_VERSION = '0.2.0';

const LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost']);
const ROUTING: RoutingProviderName[] = ['provided_distance', 'manual', 'fixture', 'here'];

export class ConfigError extends Error {}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, cwd = process.cwd()): Config {
  const host = (env.API_HOST || '127.0.0.1').trim();
  // Fail closed: the API itself never listens beyond loopback (LAN access goes through Vite).
  if (!LOOPBACK.has(host)) {
    throw new ConfigError(`API_HOST=${host} is not a loopback address. Only 127.0.0.1, ::1 or localhost are allowed.`);
  }
  const port = Number(env.API_PORT || 8787);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ConfigError(`API_PORT=${env.API_PORT} is not a valid port.`);

  const sqliteRaw = env.SQLITE_PATH || './data/traceflow.sqlite';
  const sqlitePath = sqliteRaw === ':memory:' ? ':memory:' : path.resolve(cwd, sqliteRaw);
  const dataDir = sqlitePath === ':memory:' ? path.resolve(cwd, 'data') : path.dirname(sqlitePath);
  const uploadsDir = path.resolve(cwd, env.UPLOADS_DIR || path.join(dataDir, 'uploads'));

  const routing = (env.ROUTING_PROVIDER || 'provided_distance').trim() as RoutingProviderName;
  if (!ROUTING.includes(routing)) throw new ConfigError(`ROUTING_PROVIDER=${routing} must be one of ${ROUTING.join(', ')}.`);

  const vitePort = Number(env.VITE_PORT || 5173);
  // Same-network access (off by default). The API keeps listening on loopback only; the Vite server
  // is what opens to the network. There is no code or login: anyone on the network can use the app.
  const lanAccess = String(env.LAN_ACCESS ?? 'false').toLowerCase() === 'true';
  // Loopback names only; with LAN_ACCESS the API also accepts this machine's *current* network
  // addresses, checked per request (server/services/networkHosts.ts).
  const allowedHosts = ['localhost', '127.0.0.1', '[::1]', '::1'];
  const webPorts = [vitePort, 4173];
  const allowedOrigins = allowedHosts.filter((h) => h !== '::1').flatMap((h) => webPorts.map((p) => `http://${h}:${p}`));

  return {
    version: APP_VERSION,
    host,
    port,
    sqlitePath,
    dataDir,
    uploadsDir,
    maxUploadBytes: Number(env.MAX_UPLOAD_MB || 100) * 1024 * 1024,
    allowedOrigins,
    allowedHosts,
    webPorts,
    lanAccess,
    geminiApiKey: (env.GEMINI_API_KEY || '').trim(),
    geminiModel: (env.GEMINI_MODEL || 'gemini-3.8-flash').trim(),
    aiEnabled: String(env.ENABLE_AI_INVESTIGATION ?? 'true').toLowerCase() !== 'false',
    autoReviewImports: String(env.AUTO_REVIEW_IMPORTS ?? 'true').toLowerCase() !== 'false',
    discoveryAfterCalculation: String(env.DISCOVERY_AFTER_CALCULATION ?? 'true').toLowerCase() !== 'false',
    routingProvider: routing,
    hereApiKey: (env.HERE_API_KEY || '').trim(),
    logLevel: env.LOG_LEVEL || 'info',
    nature: natureConfig(env, cwd),
  };
}

function natureConfig(env: NodeJS.ProcessEnv, cwd: string): NatureConfig {
  const modelDir = path.resolve(cwd, env.NATURE_MODEL_DIR || './nature_model');
  const minutes = Number(env.NATURE_JOB_TIMEOUT_MIN || 20);
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 240) throw new ConfigError(`NATURE_JOB_TIMEOUT_MIN=${env.NATURE_JOB_TIMEOUT_MIN} must be a number of minutes above 0 and at most 240.`);
  return {
    modelDir,
    dbPath: path.resolve(cwd, env.NATURE_SQLITE_PATH || path.join(modelDir, 'analysis/nature/nature.sqlite')),
    python: (env.PYTHON_PATH || 'python3').trim(),
    dataDir: env.APETIT_DATA_DIR ? path.resolve(cwd, env.APETIT_DATA_DIR) : null,
    jobTimeoutMs: minutes * 60_000,
  };
}
