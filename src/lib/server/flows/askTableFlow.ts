import { BaseFlow, node, type FlowState } from 'nacelle-core/server';
import { answerWithTask, redactContext } from '../llm/askNode';

export class AskTableFlow extends BaseFlow {
	static flowName = 'ask_table_flow';
	static description =
		'Answer questions about a single table, grounded in its columns, keys, indexes and foreign key relationships.';

	stateSpec = {
		user_query: '',
		database: '',
		dialect: 'Microsoft SQL Server T-SQL',
		table: '',
		context: '',
		history: [],
		result: ''
	};
	resultField = 'result';

	protected serializeState(state: FlowState): unknown {
		return redactContext(state);
	}

	answer = node('answer', (state: FlowState) =>
		answerWithTask(
			'ask_table',
			{
				database: String(state.database ?? ''),
				dialect: String(state.dialect ?? ''),
				table: String(state.table ?? ''),
				context: String(state.context ?? '')
			},
			state
		)
	);
}
