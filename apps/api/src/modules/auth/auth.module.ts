import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import type { Env } from '../../config/env';
import { MailModule } from '../mail/mail.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { InviteService } from './invite.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { TokenService } from './token.service';

/** Authentication module (docs/07-auth-architecture.md). */
@Module({
  imports: [
    PassportModule,
    MailModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: { expiresIn: config.get('JWT_ACCESS_TTL', { infer: true }) },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [JwtStrategy, TokenService, AuthService, InviteService],
  // InviteService is exported so the onboarding module can mint a token inside
  // its own create transaction — token crypto stays in one place.
  exports: [JwtModule, TokenService, InviteService],
})
export class AuthModule {}
