import { buildClient, resolveModelForAlias, resolveProviderName } from 'nacelle-core/server';

export const ASK_ALIAS = 'ask';

export interface AskModelStatus {
	ok: boolean;
	model: string;
	error?: string;
}

export async function askModelStatus(): Promise<AskModelStatus> {
	let model = '(unresolved)';
	try {
		model = resolveModelForAlias(ASK_ALIAS);
		await buildClient(resolveProviderName()).models.list();
		return { ok: true, model };
	} catch (caught) {
		return { ok: false, model, error: (caught as Error).message };
	}
}
