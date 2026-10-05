/**
 * Central tool registration (Phase 2).
 *
 * Importing this module registers all Phase 2 tools exactly once.
 * Tool names are stable — the future AI planner will reference them.
 *
 * Registered tools:
 *   discovery.search, discovery.import,
 *   research.website, research.lead,
 *   crm.createLead, crm.createTask, crm.createFollowUp, crm.logActivity,
 *   outreach.createDraft,
 *   prospecting.verifyCandidate, prospecting.classifyIndustry,
 *   prospecting.matchEntities
 */
import { registerTool, executeTool, getTool, listTools, listToolDefinitions } from "./registry";
import type { WorkspaceContext } from "./registry";
import { discoverySearchTool, discoveryImportTool } from "./discovery";
import { researchWebsiteTool, researchLeadTool } from "./research";
import {
  createLeadTool,
  createTaskTool,
  createFollowUpTool,
  logActivityTool,
} from "./crm";
import { outreachCreateDraftTool } from "./outreach";
import {
  prospectVerifyCandidateTool,
  prospectClassifyIndustryTool,
  prospectMatchEntitiesTool,
} from "./prospecting";

registerTool(discoverySearchTool);
registerTool(discoveryImportTool);
registerTool(researchWebsiteTool);
registerTool(researchLeadTool);
registerTool(createLeadTool);
registerTool(createTaskTool);
registerTool(createFollowUpTool);
registerTool(logActivityTool);
registerTool(outreachCreateDraftTool);
registerTool(prospectVerifyCandidateTool);
registerTool(prospectClassifyIndustryTool);
registerTool(prospectMatchEntitiesTool);

export { executeTool, getTool, listTools, listToolDefinitions, registerTool };
export type { WorkspaceContext };
export type { ToolDefinition, ToolResult, ToolError } from "./registry";
