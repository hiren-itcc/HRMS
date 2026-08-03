import {
  acceptInviteSchema,
  changePasswordSchema,
  forgotPasswordSchema,
  loginSchema,
  resetPasswordSchema,
} from '@hrms/shared';
import { createZodDto } from 'nestjs-zod';

// One Zod schema (packages/shared) drives web forms AND these DTOs —
// the ZodValidationPipe registered in AppModule validates against them.
export class LoginDto extends createZodDto(loginSchema) {}
export class ForgotPasswordDto extends createZodDto(forgotPasswordSchema) {}
export class ResetPasswordDto extends createZodDto(resetPasswordSchema) {}
export class ChangePasswordDto extends createZodDto(changePasswordSchema) {}
export class AcceptInviteDto extends createZodDto(acceptInviteSchema) {}
