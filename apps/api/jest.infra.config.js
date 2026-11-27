// Testes contra RabbitMQ e S3 reais. Requerem RABBITMQ_URL e S3_ENDPOINT (ver README). Falham se não estiverem definidos.
module.exports = { preset: 'ts-jest', testEnvironment: 'node', rootDir: '.', testMatch: ['<rootDir>/test/**/*.infra-spec.ts'], testTimeout: 60000 };
