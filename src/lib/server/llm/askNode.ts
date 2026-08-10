import { invokeTaskModelStream, type FlowState, type LlmMessage } from 'nacelle-core/server';
import { ASK_ALIAS } from './model';

export const ASK_AGENT = 'sql_expert';

export async function answerWithTask(
	taskName: string,
	variables: Record<string, unknown>,
	state: FlowState
): Promise<{ result: string }> {
	const call = await invokeTaskModelStream({
		alias: ASK_ALIAS,
		taskName,
		taskAgent: ASK_AGENT,
		variables: { ...variables, user_query: String(state.user_query ?? '') },
		history: (state.history ?? []) as LlmMessage[],
		stepName: taskName,
		options: { temperature: 0.2 }
	});
	return { result: call.content };
}

export function redactContext(state: FlowState): unknown {
	const context = String(state.context ?? '');
	return { ...state, context: context ? `[${context.length} chars of schema context]` : '' };
}
