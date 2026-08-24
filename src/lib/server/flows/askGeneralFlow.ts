import { BaseFlow, node, type FlowState } from 'nacelle-core/server';
import { answerWithTask } from '../llm/askNode';

export class AskGeneralFlow extends BaseFlow {
	static flowName = 'ask_general_flow';
	static description =
		'Answer general SQL Server, PostgreSQL, and SQLite questions. No database connection or schema context.';

	stateSpec = {
		user_query: '',
		history: [],
		result: ''
	};
	resultField = 'result';

	answer = node('answer', (state: FlowState) => answerWithTask('ask_general', {}, state));
}
