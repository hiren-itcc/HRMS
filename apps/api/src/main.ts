import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger, LoggerErrorInterceptor } from 'nestjs-pino';
import { AppModule } from './app.module';
import type { Env } from './config/env';

async function bootstrap() {
  // Typed as the Express app so `set('trust proxy', …)` is reachable.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));
  app.useGlobalInterceptors(new LoggerErrorInterceptor());

  /*
   * Read through the validated config rather than raw process.env: env.ts
   * already checks WEB_ORIGIN is a URL and fails fast if it is not. Reading
   * the raw value meant a missing or misspelled origin fell back to localhost
   * in production, where the only symptom is CORS rejecting the real front end
   * and nothing at all in the server log.
   */
  const config = app.get(ConfigService<Env, true>);

  app.use(helmet());
  app.use(cookieParser());
  app.enableCors({ origin: config.get('WEB_ORIGIN', { infer: true }), credentials: true });

  /*
   * Behind a proxy, `req.ip` is the proxy unless Express is told how many hops
   * to skip — which would make the login rate limit count every attempt
   * against one address, and record that same address in every audit row.
   *
   * Off by default because `X-Forwarded-For` is forgeable: trusting it while
   * directly exposed would hand attackers control of the value the throttle
   * keys on. It is a deployment fact, so it comes from configuration.
   */
  const hops = config.get('TRUST_PROXY', { infer: true });
  if (hops > 0) app.set('trust proxy', hops);

  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();

  // Swagger — the API contract for web and the future mobile app (doc 03)
  if (process.env.NODE_ENV !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('HRMS API')
      .setDescription('Human Resource Management System API')
      .setVersion('1.0')
      .addBearerAuth()
      .addCookieAuth('refresh_token')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  await app.listen(config.get('PORT', { infer: true }));
}

void bootstrap();
