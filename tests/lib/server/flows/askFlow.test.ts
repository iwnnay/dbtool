import { describe, it, expect, beforeAll } from 'vitest';
import { registerDiscoveredFlows, FLOW_REGISTRY } from 'nacelle-core/server';
import * as generalModule from '$lib/server/flows/askGeneralFlow';
import * as databaseModule from '$lib/server/flows/askDatabaseFlow';
import * as tableModule from '$lib/server/flows/askTableFlow';

const EXPECTED = {
	ask_general_flow: 'AskGeneralFlow',
	ask_database_flow: 'AskDatabaseFlow',
	ask_table_flow: 'AskTableFlow'
};

describe('ask flow discovery', () => {
	beforeAll(() => {
		registerDiscoveredFlows({
			'src/lib/server/flows/askGeneralFlow.ts': generalModule,
			'src/lib/server/flows/askDatabaseFlow.ts': databaseModule,
			'src/lib/server/flows/askTableFlow.ts': tableModule
		});
	});

	it('registers one flow per ask scope', () => {
		for (const [flowName, className] of Object.entries(EXPECTED)) {
			expect(FLOW_REGISTRY[flowName], `${flowName} should be registered`).toBeDefined();
			expect(FLOW_REGISTRY[flowName].className).toBe(className);
		}
	});

	it('no longer carries the placeholder flow', () => {
		expect(FLOW_REGISTRY.main_flow).toBeUndefined();
	});

	it('scopes each flow to the state it actually needs', () => {
		const fields = (flowName: string) => FLOW_REGISTRY[flowName].factory().stateFields();
		expect(fields('ask_general_flow')).toEqual(['user_query', 'history', 'result']);
		expect(fields('ask_database_flow')).toContain('context');
		expect(fields('ask_database_flow')).not.toContain('table');
		expect(fields('ask_table_flow')).toContain('table');
	});

	it('builds a graph the debug plot can render', () => {
		for (const flowName of Object.keys(EXPECTED)) {
			const graph = FLOW_REGISTRY[flowName].factory().graphData();
			expect(graph.nodes.map((flowNode) => flowNode.label)).toContain('answer');
			expect(graph.edges.length).toBeGreaterThan(0);
		}
	});

	it('keeps the big schema context out of flow-node traces', () => {
		const flow = FLOW_REGISTRY.ask_database_flow.factory() as unknown as {
			serializeState(state: Record<string, unknown>): Record<string, unknown>;
		};
		const serialized = flow.serializeState({ context: 'x'.repeat(5000), database: 'NGDev' });
		expect(serialized.context).toBe('[5000 chars of schema context]');
		expect(serialized.database).toBe('NGDev');
	});
});
