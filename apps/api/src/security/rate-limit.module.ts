import { ArgumentsHost, Catch, ExceptionFilter, Global, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { MemoryRateLimiter, RateLimitedException, RateLimiter, RedisRateLimiter } from './rate-limiter';

@Catch(RateLimitedException)
export class RateLimitedFilter implements ExceptionFilter {
  catch(e: RateLimitedException, host: ArgumentsHost) {
    host.switchToHttp().getResponse().status(429).set('Retry-After', String(e.retryAfterSec)).json(e.getResponse());
  }
}

/** REDIS_URL definido ⇒ Redis (partilhado entre instâncias); senão memória (só dev/testes, por processo). */
@Global() @Module({
  providers: [{ provide: RateLimiter, useFactory: (): RateLimiter => (process.env.REDIS_URL ? new RedisRateLimiter(process.env.REDIS_URL, process.env.REDIS_PREFIX) : new MemoryRateLimiter()) },
              { provide: APP_FILTER, useClass: RateLimitedFilter }],
  exports: [RateLimiter],
})
export class RateLimitModule {}
