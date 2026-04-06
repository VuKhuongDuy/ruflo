/**
 * Memory package loggers — thin wrappers around console with prefixed output.
 * Each subsystem gets its own named logger for easy filtering.
 */

interface Logger {
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  debug(...args: unknown[]): void;
  child(name: string): Logger;
}

function createLogger(name: string): Logger {
  const prefix = `[memory:${name}]`;
  return {
    info: (...args: unknown[]) => console.log(prefix, ...args),
    warn: (...args: unknown[]) => console.warn(prefix, ...args),
    error: (...args: unknown[]) => console.error(prefix, ...args),
    debug: (...args: unknown[]) => {
      if (process.env.CLAUDE_FLOW_LOG_LEVEL === 'debug') {
        console.log(prefix, '[DEBUG]', ...args);
      }
    },
    child: (childName: string) => createLogger(`${name}:${childName}`),
  };
}

export const memoryLogger = createLogger('core');
export const agentdbLogger = createLogger('agentdb');
export const hnswLogger = createLogger('hnsw');
export const sqliteLogger = createLogger('sqlite');
export const sqljsLogger = createLogger('sqljs');
export const hybridLogger = createLogger('hybrid');
export const cacheLogger = createLogger('cache');
export const migrationLogger = createLogger('migration');
export const databaseProviderLogger = createLogger('db-provider');
