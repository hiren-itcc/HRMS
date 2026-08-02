import type {
  ChangePasswordInput,
  ForgotPasswordInput,
  LoginInput,
  ResetPasswordInput,
} from '@hrms/shared';
import type { AuthResponse, SessionUser } from '@hrms/types';
import { api } from '@/lib/api-client';

export const authApi = {
  login: (input: LoginInput) =>
    api<AuthResponse>('/auth/login', { method: 'POST', body: JSON.stringify(input) }),

  refresh: () => api<AuthResponse>('/auth/refresh', { method: 'POST' }),

  logout: () => api<void>('/auth/logout', { method: 'POST' }),

  forgotPassword: (input: ForgotPasswordInput) =>
    api<{ message: string }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  resetPassword: (input: ResetPasswordInput) =>
    api<{ message: string }>('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  // Returns a fresh token: the old one still asserts mustChangePassword, and
  // the API refuses every route while that claim is set.
  changePassword: (input: ChangePasswordInput) =>
    api<{ message: string; accessToken: string }>('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify(input),
    }),

  me: () => api<SessionUser>('/auth/me'),
};
