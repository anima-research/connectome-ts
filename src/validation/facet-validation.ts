/**
 * Facet Validation System
 * 
 * Runtime validation to ensure facets conform to their expected structure
 * and contain required fields based on their type and aspects.
 */

import { 
  Facet,
  hasContentAspect,
  hasStateAspect,
  hasAgentGeneratedAspect,
  hasStreamAspect,
  hasScopedAspect,
  hasEphemeralAspect
} from '../veil/facet-types';

export enum ValidationLevel {
  Structure = 1,    // Basic structure validation
  Aspect = 2,       // Required aspects validation
  Consistency = 3,  // Consistency checks
  Reference = 4     // Reference validation (not implemented yet)
}

export interface ValidationOptions {
  level?: ValidationLevel;
  throw?: boolean;
  context?: string;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  warnings?: string[];
}

export interface ValidationConfig {
  enabled: boolean;
  level: ValidationLevel;
  throwOnError: boolean;
  logWarnings: boolean;
}

// Global validation config
export const VALIDATION_CONFIG: ValidationConfig = {
  enabled: process.env.NODE_ENV !== 'production' || 
           process.env.ENABLE_FACET_VALIDATION === 'true',
  level: parseInt(process.env.FACET_VALIDATION_LEVEL || '2') as ValidationLevel,
  throwOnError: process.env.NODE_ENV !== 'production',
  logWarnings: true
};

type FacetValidator = (facet: any, options: ValidationOptions) => ValidationResult;

/**
 * Main validation function
 */
export function validateFacet(
  facet: any,
  expectedType?: string,
  options: ValidationOptions = {}
): ValidationResult {
  const {
    level = VALIDATION_CONFIG.level,
    throw: shouldThrow = VALIDATION_CONFIG.throwOnError,
    context = ''
  } = options;

  // Skip if validation disabled
  if (!VALIDATION_CONFIG.enabled) {
    return { valid: true };
  }

  const errors: string[] = [];
  const warnings: string[] = [];
  const facetId = facet?.id || '<no-id>';

  // Level 1: Structure validation
  if (level >= ValidationLevel.Structure) {
    if (!facet || typeof facet !== 'object') {
      return error(`Facet is not an object`, shouldThrow, context);
    }

    if (!facet.id || typeof facet.id !== 'string') {
      errors.push(`Facet ${facetId} missing required 'id' field (string)`);
    }

    if (!facet.type || typeof facet.type !== 'string') {
      errors.push(`Facet ${facetId} missing required 'type' field (string)`);
    }

    if (expectedType && facet.type !== expectedType) {
      errors.push(`Facet ${facetId} has type '${facet.type}' but expected '${expectedType}'`);
    }
  }

  // If structure validation failed, don't continue
  if (errors.length > 0) {
    return formatResult(errors, warnings, shouldThrow, context);
  }

  // Level 2: Aspect validation
  if (level >= ValidationLevel.Aspect) {
    const validator = FACET_VALIDATORS[facet.type];
    if (validator) {
      const result = validator(facet, options);
      errors.push(...(result.error ? [result.error] : []));
      warnings.push(...(result.warnings || []));
    } else if (VALIDATION_CONFIG.logWarnings) {
      warnings.push(`No validator registered for facet type '${facet.type}'`);
    }
  }

  // Level 3: Consistency validation
  if (level >= ValidationLevel.Consistency) {
    const consistencyResult = validateConsistency(facet);
    warnings.push(...(consistencyResult.warnings || []));
  }

  return formatResult(errors, warnings, shouldThrow, context);
}

/**
 * Type-specific validators
 */
const FACET_VALIDATORS: Record<string, FacetValidator> = {
  'speech': validateSpeechFacet,
  'thought': validateThoughtFacet,
  'action': validateActionFacet,
  'event': validateEventFacet,
  'state': validateStateFacet,
  'ambient': validateAmbientFacet,
  'ephemeral': validateEphemeralFacet,
  'agent-activation': validateAgentActivationFacet,
  'rendered-context': validateRenderedContextFacet,
  'stream-change': validateStreamRewriteFacet,
  'scope-change': validateScopeRewriteFacet,
  'state-change': validateStateRewriteFacet,
  'agent-lifecycle': validateAgentLifecycleFacet
};

// Agent Communication Facets
function validateSpeechFacet(facet: any, options: ValidationOptions): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!hasContentAspect(facet) || !facet.content) {
    errors.push(`Speech facet '${facet.id}' must have content`);
  }

  if (!hasAgentGeneratedAspect(facet) || !facet.agentId) {
    errors.push(`Speech facet '${facet.id}' must have agentId`);
  }

  if (!hasStreamAspect(facet) || !facet.streamId) {
    errors.push(`Speech facet '${facet.id}' must have streamId`);
  }

  // Consistency
  if (facet.agentId && !facet.agentName) {
    warnings.push(`Speech facet '${facet.id}' has agentId but no agentName`);
  }

  return { 
    valid: errors.length === 0, 
    error: errors.join('; '),
    warnings: warnings.length > 0 ? warnings : undefined
  };
}

function validateThoughtFacet(facet: any, options: ValidationOptions): ValidationResult {
  const errors: string[] = [];

  if (!hasContentAspect(facet) || !facet.content) {
    errors.push(`Thought facet '${facet.id}' must have content`);
  }

  if (!hasAgentGeneratedAspect(facet) || !facet.agentId) {
    errors.push(`Thought facet '${facet.id}' must have agentId`);
  }

  return { 
    valid: errors.length === 0, 
    error: errors.join('; ')
  };
}

function validateActionFacet(facet: any, options: ValidationOptions): ValidationResult {
  const errors: string[] = [];

  if (!hasStateAspect(facet) || !facet.state) {
    errors.push(`Action facet '${facet.id}' must have state`);
  } else {
    if (!facet.state.toolName) {
      errors.push(`Action facet '${facet.id}' must have state.toolName`);
    }
    if (!facet.state.parameters) {
      errors.push(`Action facet '${facet.id}' must have state.parameters`);
    }
  }

  if (!hasAgentGeneratedAspect(facet) || !facet.agentId) {
    errors.push(`Action facet '${facet.id}' must have agentId`);
  }

  return { 
    valid: errors.length === 0, 
    error: errors.join('; ')
  };
}

// Core Content Facets
function validateEventFacet(facet: any, options: ValidationOptions): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!hasContentAspect(facet) || !facet.content) {
    errors.push(`Event facet '${facet.id}' must have content`);
  }

  if (!hasStateAspect(facet) || !facet.state?.source) {
    warnings.push(`Event facet '${facet.id}' should have state.source for turn attribution`);
  }

  return { 
    valid: errors.length === 0, 
    error: errors.join('; '),
    warnings: warnings.length > 0 ? warnings : undefined
  };
}

function validateStateFacet(facet: any, options: ValidationOptions): ValidationResult {
  const errors: string[] = [];

  if (!hasContentAspect(facet) || !facet.content) {
    errors.push(`State facet '${facet.id}' must have content`);
  }

  if (!hasStateAspect(facet) || !facet.state) {
    errors.push(`State facet '${facet.id}' must have state`);
  }

  return { 
    valid: errors.length === 0, 
    error: errors.join('; ')
  };
}

function validateAmbientFacet(facet: any, options: ValidationOptions): ValidationResult {
  const errors: string[] = [];

  if (!hasContentAspect(facet) || !facet.content) {
    errors.push(`Ambient facet '${facet.id}' must have content`);
  }

  return { 
    valid: errors.length === 0, 
    error: errors.join('; ')
  };
}

function validateEphemeralFacet(facet: any, options: ValidationOptions): ValidationResult {
  const errors: string[] = [];

  if (!hasContentAspect(facet) || !facet.content) {
    errors.push(`Ephemeral facet '${facet.id}' must have content`);
  }

  if (!hasEphemeralAspect(facet)) {
    errors.push(`Ephemeral facet '${facet.id}' must have ephemeral: true`);
  }

  return { 
    valid: errors.length === 0, 
    error: errors.join('; ')
  };
}

// System Facets
function validateAgentActivationFacet(facet: any, options: ValidationOptions): ValidationResult {
  const errors: string[] = [];

  if (!hasStateAspect(facet) || !facet.state) {
    errors.push(`Agent activation facet '${facet.id}' must have state`);
  }

  if (!hasEphemeralAspect(facet)) {
    errors.push(`Agent activation facet '${facet.id}' must be ephemeral`);
  }

  return { 
    valid: errors.length === 0, 
    error: errors.join('; ')
  };
}

function validateRenderedContextFacet(facet: any, options: ValidationOptions): ValidationResult {
  const errors: string[] = [];

  if (!hasContentAspect(facet) || !facet.content) {
    errors.push(`Rendered context facet '${facet.id}' must have content`);
  }

  if (!hasEphemeralAspect(facet)) {
    errors.push(`Rendered context facet '${facet.id}' must be ephemeral`);
  }

  if (!hasStateAspect(facet) || !facet.state?.activationId) {
    errors.push(`Rendered context facet '${facet.id}' must have state.activationId`);
  }

  return { 
    valid: errors.length === 0, 
    error: errors.join('; ')
  };
}

// Meta Facets
function validateStreamRewriteFacet(facet: any, options: ValidationOptions): ValidationResult {
  const errors: string[] = [];

  if (!hasStateAspect(facet) || !facet.state) {
    errors.push(`Stream change facet '${facet.id}' must have state`);
  } else {
    if (!facet.state.operation) {
      errors.push(`Stream change facet '${facet.id}' must have state.operation`);
    }
    if (!facet.state.streamId) {
      errors.push(`Stream change facet '${facet.id}' must have state.streamId`);
    }
  }

  return { 
    valid: errors.length === 0, 
    error: errors.join('; ')
  };
}

function validateScopeRewriteFacet(facet: any, options: ValidationOptions): ValidationResult {
  // Similar to stream change
  return validateStreamRewriteFacet(facet, options);
}

function validateStateRewriteFacet(facet: any, options: ValidationOptions): ValidationResult {
  const errors: string[] = [];

  if (!hasStateAspect(facet) || !facet.state) {
    errors.push(`State change facet '${facet.id}' must have state`);
  } else {
    if (!facet.state.targetFacetId) {
      errors.push(`State change facet '${facet.id}' must have state.targetFacetId`);
    }
    if (!facet.state.changes) {
      errors.push(`State change facet '${facet.id}' must have state.changes`);
    }
  }

  return { 
    valid: errors.length === 0, 
    error: errors.join('; ')
  };
}

function validateAgentLifecycleFacet(facet: any, options: ValidationOptions): ValidationResult {
  const errors: string[] = [];

  if (!hasStateAspect(facet) || !facet.state) {
    errors.push(`Agent lifecycle facet '${facet.id}' must have state`);
  } else {
    if (!facet.state.operation) {
      errors.push(`Agent lifecycle facet '${facet.id}' must have state.operation`);
    }
    if (!facet.state.agentId) {
      errors.push(`Agent lifecycle facet '${facet.id}' must have state.agentId`);
    }
  }

  return { 
    valid: errors.length === 0, 
    error: errors.join('; ')
  };
}

/**
 * Consistency validation across aspects
 */
function validateConsistency(facet: Facet): ValidationResult {
  const warnings: string[] = [];

  // Agent consistency
  if (hasAgentGeneratedAspect(facet)) {
    if (facet.agentId && !facet.agentName) {
      warnings.push(`Facet '${facet.id}' has agentId but no agentName`);
    }
  }

  // Stream consistency
  if (hasStreamAspect(facet)) {
    if (facet.streamId && !facet.streamType) {
      warnings.push(`Facet '${facet.id}' has streamId but no streamType`);
    }
  }

  // Ephemeral + persistent state warning
  if (hasEphemeralAspect(facet) && hasStateAspect(facet)) {
    const state = facet.state as any;
    if (state && Object.keys(state).some(k => k.includes('persistent'))) {
      warnings.push(`Facet '${facet.id}' is ephemeral but has persistent-looking state`);
    }
  }

  return { 
    valid: true,
    warnings: warnings.length > 0 ? warnings : undefined
  };
}

/**
 * Helper functions
 */
function error(message: string, shouldThrow: boolean, context: string): ValidationResult {
  const fullMessage = context ? `[${context}] ${message}` : message;
  
  if (shouldThrow) {
    throw new Error(fullMessage);
  }
  
  return { valid: false, error: fullMessage };
}

function formatResult(
  errors: string[], 
  warnings: string[], 
  shouldThrow: boolean,
  context: string
): ValidationResult {
  if (errors.length > 0) {
    const errorMessage = errors.join('; ');
    const fullMessage = context ? `[${context}] ${errorMessage}` : errorMessage;
    
    if (shouldThrow) {
      throw new Error(fullMessage);
    }
    
    return {
      valid: false,
      error: fullMessage,
      warnings: warnings.length > 0 ? warnings : undefined
    };
  }

  // Log warnings if configured
  if (warnings.length > 0 && VALIDATION_CONFIG.logWarnings) {
    const warningMessage = warnings.join('; ');
    const fullMessage = context ? `[${context}] ${warningMessage}` : warningMessage;
    console.warn(`Facet validation warning: ${fullMessage}`);
  }

  return {
    valid: true,
    warnings: warnings.length > 0 ? warnings : undefined
  };
}

/**
 * Register a custom validator for a facet type
 */
export function registerFacetValidator(type: string, validator: FacetValidator): void {
  FACET_VALIDATORS[type] = validator;
}

/**
 * Batch validation helper
 */
export function validateFacets(
  facets: Facet[], 
  options: ValidationOptions = {}
): ValidationResult {
  const allErrors: string[] = [];
  const allWarnings: string[] = [];

  for (const facet of facets) {
    const result = validateFacet(facet, undefined, { ...options, throw: false });
    if (!result.valid && result.error) {
      allErrors.push(result.error);
    }
    if (result.warnings) {
      allWarnings.push(...result.warnings);
    }
  }

  return formatResult(allErrors, allWarnings, options.throw ?? false, options.context ?? '');
}
