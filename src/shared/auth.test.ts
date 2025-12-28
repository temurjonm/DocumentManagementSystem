import {
  hasScope,
  hasUploadScope,
  hasReadScope,
  hasDeleteScope,
  validateUploadAgentToken,
  hasAdminRole,
} from './auth';
import { AuthContext } from '../types';
import { UnauthorizedError } from './errors';

describe('Authentication Scope Validation', () => {
  describe('hasScope', () => {
    it('should return true when context has the specified scope', () => {
      const context: AuthContext = {
        userId: 'user-1',
        tenantId: 'tenant-1',
        email: 'test@example.com',
        scopes: ['dms/upload', 'dms/read'],
      };

      expect(hasScope(context, 'dms/upload')).toBe(true);
      expect(hasScope(context, 'dms/read')).toBe(true);
    });

    it('should return false when context does not have the specified scope', () => {
      const context: AuthContext = {
        userId: 'user-1',
        tenantId: 'tenant-1',
        email: 'test@example.com',
        scopes: ['dms/upload'],
      };

      expect(hasScope(context, 'dms/delete')).toBe(false);
    });
  });

  describe('hasUploadScope', () => {
    it('should return true for dms/upload scope', () => {
      const context: AuthContext = {
        userId: 'user-1',
        tenantId: 'tenant-1',
        email: 'test@example.com',
        scopes: ['dms/upload'],
      };

      expect(hasUploadScope(context)).toBe(true);
    });

    it('should return true for upload scope without prefix', () => {
      const context: AuthContext = {
        userId: 'user-1',
        tenantId: 'tenant-1',
        email: 'test@example.com',
        scopes: ['upload'],
      };

      expect(hasUploadScope(context)).toBe(true);
    });

    it('should return false when upload scope is missing', () => {
      const context: AuthContext = {
        userId: 'user-1',
        tenantId: 'tenant-1',
        email: 'test@example.com',
        scopes: ['dms/read'],
      };

      expect(hasUploadScope(context)).toBe(false);
    });
  });

  describe('hasReadScope', () => {
    it('should return true for dms/read scope', () => {
      const context: AuthContext = {
        userId: 'user-1',
        tenantId: 'tenant-1',
        email: 'test@example.com',
        scopes: ['dms/read'],
      };

      expect(hasReadScope(context)).toBe(true);
    });

    it('should return true for read scope without prefix', () => {
      const context: AuthContext = {
        userId: 'user-1',
        tenantId: 'tenant-1',
        email: 'test@example.com',
        scopes: ['read'],
      };

      expect(hasReadScope(context)).toBe(true);
    });
  });

  describe('hasDeleteScope', () => {
    it('should return true for dms/delete scope', () => {
      const context: AuthContext = {
        userId: 'user-1',
        tenantId: 'tenant-1',
        email: 'test@example.com',
        scopes: ['dms/delete'],
      };

      expect(hasDeleteScope(context)).toBe(true);
    });

    it('should return true for delete scope without prefix', () => {
      const context: AuthContext = {
        userId: 'user-1',
        tenantId: 'tenant-1',
        email: 'test@example.com',
        scopes: ['delete'],
      };

      expect(hasDeleteScope(context)).toBe(true);
    });
  });

  describe('hasAdminRole', () => {
    it('should return true when context has admin scope', () => {
      const context: AuthContext = {
        userId: 'user-1',
        tenantId: 'tenant-1',
        email: 'admin@example.com',
        scopes: ['admin', 'dms/upload'],
      };

      expect(hasAdminRole(context)).toBe(true);
    });

    it('should return false when context does not have admin scope', () => {
      const context: AuthContext = {
        userId: 'user-1',
        tenantId: 'tenant-1',
        email: 'user@example.com',
        scopes: ['dms/upload'],
      };

      expect(hasAdminRole(context)).toBe(false);
    });
  });

  describe('validateUploadAgentToken', () => {
    it('should pass validation for token with only upload scope', () => {
      const context: AuthContext = {
        userId: 'agent-1',
        tenantId: 'tenant-1',
        email: 'agent@example.com',
        scopes: ['dms/upload'],
      };

      expect(() => validateUploadAgentToken(context)).not.toThrow();
    });

    it('should pass validation for token with upload and openid scopes', () => {
      const context: AuthContext = {
        userId: 'agent-1',
        tenantId: 'tenant-1',
        email: 'agent@example.com',
        scopes: ['dms/upload', 'openid'],
      };

      expect(() => validateUploadAgentToken(context)).not.toThrow();
    });

    it('should throw error when token lacks upload scope', () => {
      const context: AuthContext = {
        userId: 'agent-1',
        tenantId: 'tenant-1',
        email: 'agent@example.com',
        scopes: ['dms/read'],
      };

      expect(() => validateUploadAgentToken(context)).toThrow(
        UnauthorizedError
      );
      expect(() => validateUploadAgentToken(context)).toThrow(
        'Token does not have upload scope'
      );
    });

    it('should throw error when token has unauthorized scopes', () => {
      const context: AuthContext = {
        userId: 'agent-1',
        tenantId: 'tenant-1',
        email: 'agent@example.com',
        scopes: ['dms/upload', 'dms/delete'],
      };

      expect(() => validateUploadAgentToken(context)).toThrow(
        UnauthorizedError
      );
      expect(() => validateUploadAgentToken(context)).toThrow(
        'Upload agent token has unauthorized scopes'
      );
    });

    it('should throw error when token has admin scope', () => {
      const context: AuthContext = {
        userId: 'agent-1',
        tenantId: 'tenant-1',
        email: 'agent@example.com',
        scopes: ['dms/upload', 'admin'],
      };

      expect(() => validateUploadAgentToken(context)).toThrow(
        UnauthorizedError
      );
    });
  });
});
