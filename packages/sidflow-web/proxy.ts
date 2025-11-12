import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  ADMIN_SESSION_COOKIE,
  buildUnauthorizedResponseBody,
  getAdminConfig,
  issueSessionToken,
  parseBasicAuth,
  shouldRenewSession,
  validateSessionToken,
  verifyAdminCredentials,
} from '@/lib/server/admin-auth';

const ADMIN_ROUTE_PATTERN = /^\/(?:admin|api\/admin)(?:\/|$)/;

function applyIsolationHeaders(response: NextResponse): NextResponse {
  response.headers.set('Cross-Origin-Opener-Policy', 'same-origin');
  response.headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
  return response;
}

async function enforceAdminAuthentication(request: NextRequest): Promise<NextResponse | null> {
  const pathname = request.nextUrl.pathname;
  if (!ADMIN_ROUTE_PATTERN.test(pathname)) {
    return null;
  }

  let config;
  try {
    config = getAdminConfig();
  } catch (error) {
    console.error('[admin-auth] Misconfigured admin credentials:', error);
    return applyIsolationHeaders(
      NextResponse.json(
        { error: 'server_error', reason: 'admin-auth-misconfigured' },
        { status: 500 }
      )
    );
  }

  const now = Date.now();
  const existingCookie = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  const sessionValidation = await validateSessionToken(existingCookie, config, now);

  if (sessionValidation.valid && sessionValidation.payload) {
    const response = NextResponse.next();
    if (shouldRenewSession(sessionValidation.payload, config, now)) {
      const { token } = await issueSessionToken(config, now);
      response.cookies.set({
        name: ADMIN_SESSION_COOKIE,
        value: token,
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        path: '/admin',
        maxAge: Math.floor(config.sessionTtlMs / 1000),
      });
    }
    return response;
  }

  const credentials = parseBasicAuth(request.headers.get('authorization'));
  if (verifyAdminCredentials(credentials, config)) {
    const { token } = await issueSessionToken(config, now);
    const response = NextResponse.next();
    response.cookies.set({
      name: ADMIN_SESSION_COOKIE,
      value: token,
      httpOnly: true,
      sameSite: 'strict',
      secure: process.env.NODE_ENV === 'production',
      path: '/admin',
      maxAge: Math.floor(config.sessionTtlMs / 1000),
    });
    return response;
  }

  const response = NextResponse.json(
    buildUnauthorizedResponseBody(sessionValidation.reason ?? 'invalid-credentials'),
    { status: 401 }
  );
  response.headers.set('WWW-Authenticate', 'Basic realm="SIDFlow Admin", charset="UTF-8"');
  if (existingCookie) {
    response.cookies.set({
      name: ADMIN_SESSION_COOKIE,
      value: '',
      path: '/admin',
      maxAge: 0,
    });
  }
  return response;
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const conditional = await enforceAdminAuthentication(request);
  if (conditional) {
    return applyIsolationHeaders(conditional);
  }
  return applyIsolationHeaders(NextResponse.next());
}

export const config = {
  matcher: '/((?!_next/static|_next/image|favicon.ico).*)',
};
