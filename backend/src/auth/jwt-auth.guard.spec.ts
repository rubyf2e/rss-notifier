import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JwtAuthGuard, AuthenticatedRequest } from './jwt-auth.guard';

describe('JWT 驗證 Guard', () => {
  let guard: JwtAuthGuard;
  let jwtService: { verifyAsync: jest.Mock };
  let request: Partial<AuthenticatedRequest>;

  beforeEach(() => {
    jwtService = { verifyAsync: jest.fn() };
    guard = new JwtAuthGuard(jwtService as unknown as JwtService);
    request = { headers: {} };
  });

  function createContext(): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  it('拒絕缺少 Bearer token 的請求', async () => {
    await expect(guard.canActivate(createContext())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('拒絕無效或過期的 JWT', async () => {
    request.headers = { authorization: 'Bearer invalid-token' } as AuthenticatedRequest['headers'];
    jwtService.verifyAsync.mockRejectedValue(new Error('invalid token'));

    await expect(guard.canActivate(createContext())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('驗證 JWT 並將使用者識別資訊放入 request', async () => {
    const user = { userId: 'user-public-id', email: 'user@example.com' };
    request.headers = { authorization: 'Bearer valid-token' } as AuthenticatedRequest['headers'];
    jwtService.verifyAsync.mockResolvedValue(user);

    await expect(guard.canActivate(createContext())).resolves.toBe(true);

    expect(jwtService.verifyAsync).toHaveBeenCalledWith('valid-token');
    expect(request.user).toEqual(user);
  });

  it('拒絕沒有 userId 的 JWT payload', async () => {
    request.headers = { authorization: 'Bearer token-without-user' } as AuthenticatedRequest['headers'];
    jwtService.verifyAsync.mockResolvedValue({ email: 'user@example.com' });

    await expect(guard.canActivate(createContext())).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});