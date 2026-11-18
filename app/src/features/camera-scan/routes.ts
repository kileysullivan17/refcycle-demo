// Camera scan server route: POST /api/identify (contracts 4).
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { contextOf } from '../../shared/feature.ts';
import { BodyTooLarge, isJsonRequest, readBody, sendJson } from '../../shared/http.ts';
import { limitBody, usd } from '../../shared/limits.ts';
import { appendLog } from '../../shared/logs.ts';
import { identifyImage, ImageInputError, parseImage, ProviderError, readImageConfig } from './identify.ts';

// 5 MB of image is about 6.7 MB of base64; anything past this cannot be a valid request.
const BODY_LIMIT = 7_200_000;
const IdentifyRequest = z.object({ image: z.string() }).strict();

export async function handle(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (url.pathname !== '/api/identify' || req.method !== 'POST') return false;
  const context = contextOf(req);

  // At the limit, say so before reading the upload. Nothing is counted here.
  if (context.limits.wouldRefuse(context.limits.visitorKey(req), context.limits.config.scanCostUsd)) {
    req.resume();
    sendJson(res, 429, limitBody());
    return true;
  }

  let image: ReturnType<typeof parseImage>;
  try {
    if (!isJsonRequest(req)) throw new ImageInputError('Content-Type must be application/json');
    let json: unknown;
    try {
      json = JSON.parse((await readBody(req, BODY_LIMIT)).toString('utf8'));
    } catch (error) {
      throw new ImageInputError(error instanceof BodyTooLarge ? 'The image is larger than 5 MB' : 'Invalid JSON');
    }
    const parsed = IdentifyRequest.safeParse(json);
    if (!parsed.success) throw new ImageInputError('Provide "image" as a data URL, with no other keys');
    image = parseImage(parsed.data.image);
  } catch (error) {
    sendJson(res, 400, { error: error instanceof ImageInputError ? error.message : 'Invalid input' });
    return true;
  }

  const config = readImageConfig(context.env);
  if (!config) {
    sendJson(res, 502, { error: 'Photo identification is not set up on this server' });
    return true;
  }

  const limits = context.limits;
  const ticket = limits.admit(limits.visitorKey(req), limits.config.scanCostUsd, 'identify');
  if (!ticket.ok) {
    sendJson(res, 429, limitBody());
    return true;
  }
  if (limits.config.enabled) console.log(limits.visitorSourceLine(req, 'identify'));

  const started = Date.now();
  try {
    const { result, usage } = await identifyImage(config, image);
    ticket.settle(usage ? usd(limits.config, usage.inputTokens, usage.outputTokens) : undefined);
    // The log holds time, status, label, model, duration and the token counts the provider reported
    // (null when it reported none). Never the photo (CS-10).
    await appendLog(context.logsDir, 'identify.jsonl', {
      status: result.status,
      label: result.label,
      model: result.model,
      duration_ms: Date.now() - started,
      input_tokens: usage ? usage.inputTokens : null,
      output_tokens: usage ? usage.outputTokens : null,
    });
    sendJson(res, 200, result);
  } catch (error) {
    const provider = error instanceof ProviderError ? error : null;
    if (provider?.rejected) ticket.cancel();
    else ticket.settle();
    await appendLog(context.logsDir, 'identify.jsonl', {
      status: 'error',
      label: null,
      model: `${config.provider}/${config.model}`,
      duration_ms: Date.now() - started,
      input_tokens: null,
      output_tokens: null,
    });
    sendJson(res, 502, { error: provider ? provider.message : 'The photo could not be identified' });
  }
  return true;
}
