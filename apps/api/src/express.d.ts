import type { AuthUser } from './auth/auth.types.js';

declare global {
  namespace Express {
    interface Request {
      correlationId: string;
      user?: AuthUser;
    }
  }
}
export {};
