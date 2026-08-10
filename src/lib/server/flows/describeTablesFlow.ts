import { BaseFlow, invokeTaskModelStream, node, type FlowState } from 'nacelle-core/server';
import { ASK_ALIAS } from '../llm/model';

export class DescribeTablesFlow extends BaseFlow {
	static flowName = 'describe_tables_flow';
	static description =
		'Write one-line descriptions for a batch of tables, used to enrich a database datamap.';

	stateSpec = {
		tables: '',
		result: ''
	};
	resultField = 'result';

	protected serializeState(state: FlowState): unknown {
		const tables = String(state.tables ?? '');
		return { ...state, tables: tables ? `[${tables.length} chars of table listing]` : '' };
	}

	describe = node('describe', async (state: FlowState) => {
		const call = await invokeTaskModelStream({
			alias: ASK_ALIAS,
			taskName: 'describe_tables',
			taskAgent: 'schema_cataloguer',
			variables: { tables: String(state.tables ?? '') },
			stepName: 'describe_tables',
			options: { temperature: 0.15 }
		});
		return { result: call.content };
	});
}
