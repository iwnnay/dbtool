// A default tool. Any file in this directory that exports a NacelleTool (a plain
// object with `name`, `description`, and `execute`) is auto-registered — see
// hooks.server.ts. A flow can look tools up with getTools() / getTool(name) and
// pass toolSpecs() to the model for function-calling.
import type { NacelleTool } from 'nacelle-core/server';

export const currentTime: NacelleTool = {
	name: 'current_time',
	description: 'Return the current date and time as an ISO 8601 string.',
	parameters: { type: 'object', properties: {}, additionalProperties: false },
	execute: () => new Date().toISOString()
};
