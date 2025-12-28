import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { AuthContext } from '../types';
import { UnauthorizedError } from './errors';

const COGNITO_REGION = process.env.AWS_REGION || 'us-east-1';
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || '';

const client = jwksClient({
  jwksUri: `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/${USER_POOL_ID}/.well-known/jwks.json`,
  cache: true,
  cacheMaxAge: 3600000,
});

function getKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) {
      callback(err);
      return;
    }
    const signingKey = key?.getPublicKey();
    callback(null, signingKey);
  });
}

interface CognitoToken {
  sub: string;
  email: string;
  'cognito:username': string;
  'custom:tenant_id'?: string;
  scope?: string;
  token_use: string;
  exp: number;
}

export async function validateToken(token: string): Promise<AuthContext> {
  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      getKey,
      {
        algorithms: ['RS256'],
      },
      (err, decoded) => {
        if (err) {
          reject(new UnauthorizedError('Invalid token'));
          return;
        }

        const payload = decoded as CognitoToken;

        if (payload.token_use !== 'access' && payload.token_use !== 'id') {
          reject(new UnauthorizedError('Invalid token type'));
          return;
        }

        if (payload.exp * 1000 < Date.now()) {
          reject(new UnauthorizedError('Token expired'));
          return;
        }

        const scopes = payload.scope ? payload.scope.split(' ') : [];

        resolve({
          userId: payload.sub,
          tenantId: payload['custom:tenant_id'] || '',
          email: payload.email,
          scopes,
        });
      }
    );
  });
}

export function extractToken(authHeader?: string): string {
  if (!authHeader) {
    throw new UnauthorizedError('Missing authorization header');
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    throw new UnauthorizedError('Invalid authorization header format');
  }

  return parts[1];
}

export function hasAdminRole(authContext: AuthContext): boolean {
  return authContext.scopes.includes('admin');
}

export function hasScope(authContext: AuthContext, scope: string): boolean {
  return authContext.scopes.includes(scope);
}

export function hasUploadScope(authContext: AuthContext): boolean {
  return authContext.scopes.some(
    (s) => s === 'dms/upload' || s === 'upload'
  );
}

export function hasReadScope(authContext: AuthContext): boolean {
  return authContext.scopes.some((s) => s === 'dms/read' || s === 'read');
}

export function hasDeleteScope(authContext: AuthContext): boolean {
  return authContext.scopes.some((s) => s === 'dms/delete' || s === 'delete');
}

export function validateUploadAgentToken(authContext: AuthContext): void {
  if (!hasUploadScope(authContext)) {
    throw new UnauthorizedError('Token does not have upload scope');
  }

  const allowedScopes = ['dms/upload', 'upload', 'openid'];
  const hasDisallowedScope = authContext.scopes.some(
    (scope) => !allowedScopes.includes(scope)
  );

  if (hasDisallowedScope) {
    throw new UnauthorizedError(
      'Upload agent token has unauthorized scopes'
    );
  }
}
