-- Phase 4B review hardening: audit interrupted upload compensation.
ALTER TYPE "OrganizationAuditAction"
  ADD VALUE 'KNOWLEDGE_DOCUMENT_UPLOAD_FAILED';

ALTER TYPE "OrganizationAuditAction"
  ADD VALUE 'KNOWLEDGE_DOCUMENT_UPLOAD_CLEANED';
