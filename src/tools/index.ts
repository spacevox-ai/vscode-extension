/**
 * Tools Module
 * 
 * Central export for the work.studio tool system.
 * 
 * Architecture:
 * - types.ts: Core type definitions
 * - BaseTool.ts: Abstract base class with Template Method pattern
 * - ToolRegistry.ts: Singleton registry with execution management
 * - impl/*: Concrete tool implementations
 * 
 * Usage:
 * ```typescript
 * import { ToolRegistry, registerAllTools, ToolContext } from './tools';
 * 
 * // Initialize
 * const registry = ToolRegistry.getInstance();
 * registerAllTools(registry);
 * 
 * // Execute a tool
 * const result = await registry.execute('read_file', { path: 'src/main.ts' }, context);
 * 
 * // Get tools for AI
 * const tools = registry.getToolsForAI('openai');
 * ```
 */

// Types
export type {
    ToolCategory,
    ToolExecutionHint,
    ToolParameterType,
    ToolParameterSchema,
    ToolDefinition,
    ToolRequest,
    ToolResult,
    ToolContext,
    ToolConfig,
    ValidationResult,
    ITool,
    ToolEventType,
    AIStreamEvent,
    ChatMessage,
} from './types';

// Base classes
export { BaseTool } from './BaseTool';
export { ToolRegistry } from './ToolRegistry';

// Tool implementations
export * from './impl';

// Registration helper
export { registerAllTools, getAllTools, TOOL_SUMMARY } from './impl';
