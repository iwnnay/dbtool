import { BaseFlow, node, type FlowState } from 'nacelle-core/server';
import { answerWithTask, redactContext } from '../llm/askNode';

export class AskDatabaseFlow extends BaseFlow {
	static flowName = 'ask_database_flow';
	static description =
		'Answer questions and write dialect-correct SQL against one database, grounded in its datamap catalog.';

	stateSpec = {
		user_query: '',
		database: '',
		dialect: 'Microsoft SQL Server T-SQL',
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
			'ask_database',
			{ database: String(state.database ?? ''), dialect: String(state.dialect ?? ''), context: String(state.context ?? '') },
			state
		)
	);
}
