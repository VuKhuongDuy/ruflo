/**
 * File Logger Utility
 *
 * Provides file-based logging with module-scoped loggers for structured
 * output across subsystems. Supports log levels, prefixes, and child loggers.
 *
 * @module @claude-flow/shared/utils/file-logger
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

// ============================================================================
// Types
// ============================================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'silent';

export interface FileLoggerConfig {
  /** Log level threshold */
  level: LogLevel;
  /** Log file path (undefined = console only) */
  filePath?: string;
  /** Whether to also log to console */
  console: boolean;
  /** Maximum log file size in bytes before rotation */
  maxFileSize?: number;
  /** Timestamp format */
  timestamps: boolean;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  silent: 4,
};

const DEFAULT_CONFIG: FileLoggerConfig = {
  level: (process.env.CLAUDE_FLOW_LOG_LEVEL as LogLevel) || 'info',
  console: true,
  timestamps: true,
};

// ============================================================================
// FileLogger Class
// ============================================================================

export class FileLogger {
  private config: FileLoggerConfig;
  private prefix: string;
  private stream: fs.WriteStream | null = null;

  constructor(prefix: string = '', config: Partial<FileLoggerConfig> = {}) {
    this.prefix = prefix;
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (this.config.filePath) {
      const dir = path.dirname(this.config.filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      this.stream = fs.createWriteStream(this.config.filePath, { flags: 'a' });
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.config.level];
  }

  private formatMessage(level: LogLevel, message: string): string {
    const parts: string[] = [];
    if (this.config.timestamps) {
      parts.push(new Date().toISOString());
    }
    parts.push(`[${level.toUpperCase()}]`);
    if (this.prefix) {
      parts.push(`[${this.prefix}]`);
    }
    parts.push(message);
    return parts.join(' ');
  }

  private write(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;

    const formatted = this.formatMessage(level, message);

    if (this.config.console) {
      const consoleFn = level === 'error' ? console.error
        : level === 'warn' ? console.warn
        : level === 'debug' ? console.debug
        : console.info;

      if (data) {
        consoleFn(formatted, data);
      } else {
        consoleFn(formatted);
      }
    }

    if (this.stream) {
      const line = data
        ? `${formatted} ${JSON.stringify(data)}\n`
        : `${formatted}\n`;
      this.stream.write(line);
    }
  }

  debug(message: string, data?: Record<string, unknown>): void {
    this.write('debug', message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.write('info', message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.write('warn', message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.write('error', message, data);
  }

  child(subPrefix: string): FileLogger {
    const newPrefix = this.prefix ? `${this.prefix}:${subPrefix}` : subPrefix;
    return new FileLogger(newPrefix, this.config);
  }

  close(): void {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

export function createFileLogger(prefix?: string, config?: Partial<FileLoggerConfig>): FileLogger {
  return new FileLogger(prefix, config);
}

export function createModuleLogger(moduleName: string, config?: Partial<FileLoggerConfig>): FileLogger {
  return new FileLogger(moduleName, { console: true, ...config });
}
