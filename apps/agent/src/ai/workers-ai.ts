import { createParser } from "eventsource-parser";
import { estimateTokens, modelUsage, tokenCount, tokens, type Usage } from "./provider";

export interface StepMeter {
  inputEstimate: number;
  input?: number;
  output?: number;
  cached?: number;
  outputChars?: number;
}

interface RawChunk {
  response?: unknown;
  choices?: { delta?: { content?: unknown; reasoning_content?: unknown } }[];
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; prompt_tokens_details?: { cached_tokens?: unknown } };
}

function capture(meter: StepMeter, response: unknown): void {
  const chunk = response as RawChunk | null;
  const delta = chunk?.choices?.[0]?.delta;
  for (const text of [chunk?.response, delta?.content, delta?.reasoning_content]) {
    if (typeof text === "string") meter.outputChars = (meter.outputChars ?? 0) + text.length;
  }
  const usage = chunk?.usage;
  if (!usage) return;
  meter.input = tokenCount(usage.prompt_tokens) ?? meter.input;
  meter.output = tokenCount(usage.completion_tokens) ?? meter.output;
  meter.cached = tokenCount(usage.prompt_tokens_details?.cached_tokens) ?? meter.cached;
}

export function meteredBinding(binding: Ai, steps: StepMeter[]): Ai {
  return new Proxy(binding, {
    get(target, key) {
      if (key !== "run") {
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async (...args: Parameters<Ai["run"]>) => {
        const inputs = args[1] as { messages?: unknown; tools?: unknown };
        const meter: StepMeter = {
          inputEstimate: estimateTokens(JSON.stringify({ messages: inputs.messages, tools: inputs.tools })),
        };
        steps.push(meter);
        const response = await target.run(...args);
        if (!(response instanceof ReadableStream)) {
          capture(meter, response);
          return response;
        }
        const decoder = new TextDecoder();
        let observing = true;
        const parser = createParser({
          maxBufferSize: 1024 * 1024,
          onError: (error) => { if (error.type === "max-buffer-size-exceeded") observing = false; },
          onEvent: ({ data }) => {
            if (data === "[DONE]") return;
            try { capture(meter, JSON.parse(data)); } catch { /* Accounting must not change inference parsing. */ }
          },
        });
        return response.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            if (observing) parser.feed(decoder.decode(chunk, { stream: true }));
            controller.enqueue(chunk);
          },
          flush() {
            if (observing) parser.feed(decoder.decode());
            parser.reset();
          },
        }));
      };
    },
  });
}

export function stepUsage(model: string, meter: StepMeter, outputChars: number): Usage {
  const outputEstimate = estimateTokens(Math.max(outputChars, meter.outputChars ?? 0));
  return modelUsage(model, true, tokens(meter.input, meter.inputEstimate), tokens(meter.output, outputEstimate), meter.cached);
}

// ============================================================
// ENRUTAMIENTO DE MODELOS (NUEVO)
// ============================================================
export const MODELO_CHAT = "@cf/qwen/qwen3.8-27b"; // Personalidad, criterio, conversación
export const MODELO_TRABAJO = "@cf/zai-org/glm-5.3-flash"; // Tool calling, código, orquestación

export function elegirModelo(mensaje: string, esAutomatizacion: boolean = false): string {
  if (esAutomatizacion) return MODELO_TRABAJO;
  if (/cloudflare_execute|run_code|generate_code|deploy_worker|list_workers|get_worker|get_worker_content|list_kv|get_kv|put_kv|list_d1|query_d1|list_pages|get_usage|generate_image|store_image|get_image|list_images/i.test(mensaje)) {
    return MODELO_TRABAJO;
  }
  return MODELO_CHAT;
          }
