import { describe, it, expect, beforeAll } from 'vitest';
import { join } from 'node:path';
import {
	setConfigDir,
	loadAgentsConfig,
	loadTasksConfig,
	buildTaskSystemPrompt
} from '../../../../nacelle/nacelle-core/src/lib/server/llm/prompts';

const ASK_VARIABLES = {
	context: '# Table: dbo.Patient\nPatientId int NOT NULL PRIMARY KEY',
	database: 'NGDev',
	dialect: 'Microsoft SQL Server T-SQL',
	table: 'dbo.Patient',
	user_query: 'how many rows are there?'
};

describe('ask prompt config', () => {
	beforeAll(() => {
		setConfigDir(join(process.cwd(), 'src', 'lib', 'server', 'config'));
	});

	it('defines the sql_expert agent', () => {
		expect(loadAgentsConfig().sql_expert.role).toContain('SQL Server');
		expect(loadAgentsConfig().sql_expert.role).toContain('PostgreSQL');
	});

	it('defines one task per ask scope', () => {
		const tasks = loadTasksConfig();
		expect(Object.keys(tasks)).toEqual(
			expect.arrayContaining(['ask_general', 'ask_database', 'ask_table'])
		);
		for (const name of ['ask_general', 'ask_database', 'ask_table']) {
			expect(tasks[name].agent).toBe('sql_expert');
		}
	});

	it('renders every ask task from the variables the flow supplies', () => {
		for (const name of ['ask_general', 'ask_database', 'ask_table']) {
			const prompt = buildTaskSystemPrompt(name, ASK_VARIABLES);
			expect(prompt).toContain('Microsoft SQL Server Expert');
			expect(prompt).not.toMatch(/\{\w+\}/);
		}
	});

	it('grounds the database scope in the supplied catalog', () => {
		const prompt = buildTaskSystemPrompt('ask_database', ASK_VARIABLES);
		expect(prompt).toContain('NGDev');
		expect(prompt).toContain('dbo.Patient');
		expect(prompt).toContain('=== SCHEMA CONTEXT ===');
	});

	it('names the target table in the table scope', () => {
		const prompt = buildTaskSystemPrompt('ask_table', ASK_VARIABLES);
		expect(prompt).toContain('dbo.Patient');
		expect(prompt).toContain('=== TABLE CONTEXT ===');
	});

	it('keeps the general scope free of schema context', () => {
		const prompt = buildTaskSystemPrompt('ask_general', ASK_VARIABLES);
		expect(prompt).not.toContain('dbo.Patient');
		expect(prompt).not.toContain('NGDev');
	});

	it('renders the datamap describe task from a table listing', () => {
		const prompt = buildTaskSystemPrompt('describe_tables', {
			tables: 'dbo.Patient [120 rows] PK(PatientId): PatientId int, LastName nvarchar'
		});
		expect(prompt).toContain('Database Schema Cataloguer');
		expect(prompt).toContain('dbo.Patient');
		expect(prompt).not.toMatch(/\{\w+\}/);
	});

	it('fails loudly when a prompt variable is missing', () => {
		expect(() => buildTaskSystemPrompt('ask_table', { context: 'x' })).toThrow(
			/Missing prompt variable/
		);
	});
});
