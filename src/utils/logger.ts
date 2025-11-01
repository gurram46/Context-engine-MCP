import winston from 'winston';
import type { ServerConfig } from '@/types';

// Create logger instance with configurable format
export const createLogger = (config: ServerConfig) => {
  const formats = [
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
  ];

  // Add JSON format for production, pretty format for development
  if (config.environment === 'production') {
    formats.push(winston.format.json());
  } else {
    formats.push(
      winston.format.colorize(),
      winston.format.simple(),
      winston.format.printf(({ level, message, timestamp, stack }) => {
        if (stack) {
          return `${timestamp} [${level}]: ${message}\n${stack}`;
        }
        return `${timestamp} [${level}]: ${message}`;
      })
    );
  }

  return winston.createLogger({
    level: config.logLevel,
    format: winston.format.combine(...formats),
    defaultMeta: { service: 'context-engine-mcp' },
    transports: [
      new winston.transports.Console(),
      // Add file transport for production
      ...(config.environment === 'production'
        ? [
            new winston.transports.File({
              filename: 'logs/error.log',
              level: 'error'
            }),
            new winston.transports.File({
              filename: 'logs/combined.log'
            }),
          ]
        : []
      ),
    ],
  });
};

// Default logger instance
export const logger = createLogger({
  port: 8080,
  host: 'localhost',
  environment: (process.env.NODE_ENV as 'development' | 'production' | 'test') || 'development',
  logLevel: (process.env.LOG_LEVEL as 'debug' | 'info' | 'warn' | 'error') || 'info',
  enableHttps: false,
  httpsKeyPath: undefined,
  httpsCertPath: undefined,
  trustProxy: false,
  trustProxyIps: [],
});

// Request logger middleware helper
export const createRequestLogger = () => {
  return {
    info: (message: string, meta?: Record<string, unknown>) => {
      logger.info(message, { ...meta, component: 'request' });
    },
    warn: (message: string, meta?: Record<string, unknown>) => {
      logger.warn(message, { ...meta, component: 'request' });
    },
    error: (message: string, meta?: Record<string, unknown>) => {
      logger.error(message, { ...meta, component: 'request' });
    },
  };
};

// Database logger
export const createDatabaseLogger = () => {
  return {
    info: (message: string, meta?: Record<string, unknown>) => {
      logger.info(message, { ...meta, component: 'database' });
    },
    warn: (message: string, meta?: Record<string, unknown>) => {
      logger.warn(message, { ...meta, component: 'database' });
    },
    error: (message: string, meta?: Record<string, unknown>) => {
      logger.error(message, { ...meta, component: 'database' });
    },
  };
};

// MCP protocol logger
export const createMcpLogger = () => {
  return {
    info: (message: string, meta?: Record<string, unknown>) => {
      logger.info(message, { ...meta, component: 'mcp-protocol' });
    },
    warn: (message: string, meta?: Record<string, unknown>) => {
      logger.warn(message, { ...meta, component: 'mcp-protocol' });
    },
    error: (message: string, meta?: Record<string, unknown>) => {
      logger.error(message, { ...meta, component: 'mcp-protocol' });
    },
  };
};
