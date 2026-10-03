import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

export interface AuthenticatedUser {
  userId: string;
  email?: string;
}

export type AuthenticatedRequest = Request & { user: AuthenticatedUser };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization ?? '';
    const tokenMatch = /^Bearer\s+(.+)$/i.exec(authorization);

    if (!tokenMatch) {
      throw new UnauthorizedException('Bearer access token is required.');
    }

    try {
      const user = await this.jwtService.verifyAsync<AuthenticatedUser>(tokenMatch[1]);
      if (typeof user.userId !== 'string' || user.userId.length === 0) {
        throw new Error('JWT payload does not contain a user ID.');
      }
      request.user = user;
      return true;
    } catch {
      throw new UnauthorizedException('Access token is invalid or expired.');
    }
  }
}