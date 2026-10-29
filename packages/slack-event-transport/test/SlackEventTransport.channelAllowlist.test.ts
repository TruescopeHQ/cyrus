import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlackEventTransport } from "../src/SlackEventTransport.js";
import type { SlackEventTransportConfig } from "../src/types.js";
import { testEventEnvelope, testThreadedMessageEnvelope } from "./fixtures.js";

const secret = "test-secret";

function setup() {
	const routes: Record<
		string,
		(req: unknown, reply: unknown) => Promise<void>
	> = {};
	const fastify = {
		post: vi.fn((path: string, ...args: unknown[]) => {
			routes[path] = (args.length === 1 ? args[0] : args[1]) as never;
		}),
	};
	const transport = new SlackEventTransport({
		fastifyServer:
			fastify as unknown as SlackEventTransportConfig["fastifyServer"],
		verificationMode: "proxy",
		secret,
	});
	transport.register();
	const onEvent = vi.fn();
	transport.on("event", onEvent);
	const send = async (envelope: unknown) => {
		const reply = {
			code: vi.fn().mockReturnThis(),
			send: vi.fn().mockReturnThis(),
		};
		await routes["/slack-webhook"]!(
			{ body: envelope, headers: { authorization: `Bearer ${secret}` } },
			reply,
		);
		return reply;
	};
	return { onEvent, send };
}

describe("SlackEventTransport channel allowlist", () => {
	const mentionChannel = testEventEnvelope.event.channel;

	beforeEach(() => {
		delete process.env.CYRUS_SLACK_ALLOWED_CHANNELS;
	});
	afterEach(() => {
		delete process.env.CYRUS_SLACK_ALLOWED_CHANNELS;
	});

	it("allows every channel when the env var is unset", async () => {
		const { onEvent, send } = setup();
		await send(testEventEnvelope);
		expect(onEvent).toHaveBeenCalledTimes(1);
	});

	it("emits events from an allowlisted channel", async () => {
		process.env.CYRUS_SLACK_ALLOWED_CHANNELS = ` CXXXX , ${mentionChannel} `;
		const { onEvent, send } = setup();
		await send(testEventEnvelope);
		expect(onEvent).toHaveBeenCalledTimes(1);
	});

	it("drops app_mention from other channels but still replies 200", async () => {
		process.env.CYRUS_SLACK_ALLOWED_CHANNELS = "COTHER";
		const { onEvent, send } = setup();
		const reply = await send(testEventEnvelope);
		expect(onEvent).not.toHaveBeenCalled();
		expect(reply.code).toHaveBeenCalledWith(200);
		expect(reply.send).toHaveBeenCalledWith({ success: true, ignored: true });
	});

	it("drops threaded follow-up messages from other channels", async () => {
		process.env.CYRUS_SLACK_ALLOWED_CHANNELS = "COTHER";
		const { onEvent, send } = setup();
		await send(testThreadedMessageEnvelope);
		expect(onEvent).not.toHaveBeenCalled();
	});
});
