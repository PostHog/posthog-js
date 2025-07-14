import { PostHog } from 'posthog-node';
/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

export interface Env {
	PH_API_KEY: string;
	PH_HOST: string;
	PH_PERSONAL_API_KEY: string;
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
		const posthog = new PostHog(env.PH_API_KEY, {
			host: env.PH_HOST,
			personalApiKey: env.PH_PERSONAL_API_KEY,
			featureFlagsPollingInterval: 10000,
		});

		posthog.capture({ distinctId: `user-${Date.now()}`, event: 'test event', properties: { test: 'test' } });

		await posthog.flush();

		return new Response('Success!');
	},
};
