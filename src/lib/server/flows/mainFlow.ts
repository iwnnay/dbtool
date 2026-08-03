// Starter flow. One node calls the LLM via `main_task` (config/tasks.yml). Edit
// this — or add more flows alongside and register them in ./index.ts — to build
// your app. See https://… (nacelle-core docs) for OrchestratedFlow, vision, etc.
import { BaseFlow, node, invokeTaskModel, type FlowState } from 'nacelle-core/server';

export class MainFlow extends BaseFlow {
	static flowName = 'main_flow';
	static description = 'Starter flow — replace me.';

	stateSpec = { user_query: '', result: '' };
	resultField = 'result';

	respond = node('respond', async (state: FlowState) => {
		const call = await invokeTaskModel({
			alias: 'simple',
			taskName: 'main_task',
			taskAgent: 'assistant',
			variables: { user_query: state.user_query },
			stepName: 'respond'
		});
		return { result: call.content };
	});
}
