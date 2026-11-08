// Gemini adapter (backend only). The API key comes from GEMINI_API_KEY and never leaves
// this process: it is not logged, not stored and not returned in any response.
import { GoogleGenAI, type Content, type Part } from '@google/genai';
import type { Config } from '../config.ts';

export type ToolDecl = { name: string; description: string; parameters: Record<string, unknown> };
export type LlmCall = { name: string; args: Record<string, unknown>; id?: string };
export type LlmTurn = { text: string; calls: LlmCall[]; content: Content | null; usage: { input: number; output: number } };
export type LlmRequest = { system: string; contents: Content[]; tools?: ToolDecl[]; jsonSchema?: Record<string, unknown>; timeoutMs?: number; maxOutputTokens?: number };

export interface LlmClient {
  mode: 'gemini' | 'stub';
  model: string;
  generate(req: LlmRequest): Promise<LlmTurn>;
}

export function aiStatus(cfg: Config) {
  if (!cfg.aiEnabled) return { configured: false, enabled: false, model: cfg.geminiModel, reason: 'ENABLE_AI_INVESTIGATION=false' };
  if (!cfg.geminiApiKey) return { configured: false, enabled: true, model: cfg.geminiModel, reason: 'GEMINI_API_KEY is not set' };
  return { configured: true, enabled: true, model: cfg.geminiModel, reason: null };
}

const TRANSIENT = new Set([429, 500, 502, 503, 504]);

export class GeminiClient implements LlmClient {
  mode = 'gemini' as const;
  model: string;
  private ai: GoogleGenAI;
  private checked: Promise<void> | null = null;
  constructor(cfg: Config) {
    this.model = cfg.geminiModel;
    this.ai = new GoogleGenAI({ apiKey: cfg.geminiApiKey });
  }

  // Confirms the configured model exists before the first call; a wrong id is reported, not faked.
  private ensureModel() {
    if (!this.checked) {
      this.checked = this.ai.models.get({ model: this.model }).then(
        () => undefined,
        (e: unknown) => {
          this.checked = null;
          throw new Error(`Gemini model "${this.model}" is not available: ${errMessage(e)}`);
        },
      );
    }
    return this.checked;
  }

  async generate(req: LlmRequest): Promise<LlmTurn> {
    const deadline = Date.now() + (req.timeoutMs ?? 30000);
    await this.ensureModel();
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error('Gemini request deadline reached');
        const res = await this.ai.models.generateContent({
          model: this.model,
          contents: req.contents,
          config: {
            systemInstruction: req.system,
            temperature: 0,
            ...(req.maxOutputTokens ? { maxOutputTokens: req.maxOutputTokens } : {}),
            abortSignal: AbortSignal.timeout(remaining),
            ...(req.tools?.length ? { tools: [{ functionDeclarations: req.tools.map((t) => ({ name: t.name, description: t.description, parametersJsonSchema: t.parameters })) }] } : {}),
            ...(req.jsonSchema ? { responseMimeType: 'application/json', responseJsonSchema: req.jsonSchema } : {}),
          },
        });
        const content = res.candidates?.[0]?.content ?? null;
        const parts: Part[] = content?.parts ?? [];
        return {
          text: parts.filter((p) => typeof p.text === 'string' && !p.thought).map((p) => p.text).join(''),
          calls: (res.functionCalls || []).map((c) => ({ name: String(c.name), args: (c.args || {}) as Record<string, unknown>, id: c.id })),
          content,
          usage: { input: res.usageMetadata?.promptTokenCount ?? 0, output: res.usageMetadata?.candidatesTokenCount ?? 0 },
        };
      } catch (e) {
        lastErr = e;
        const status = (e as { status?: number }).status;
        if (!status || !TRANSIENT.has(status) || attempt === 2) break;
        if (Date.now() + 800 * (attempt + 1) >= deadline) break;
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
      }
    }
    throw new Error(`Gemini request failed: ${errMessage(lastErr)}`);
  }
}

export function errMessage(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  // Never echo anything that looks like a key back to the client.
  return raw.replace(/AIza[0-9A-Za-z_-]{20,}/g, '[redacted]').slice(0, 500);
}

export function createLlm(cfg: Config): LlmClient | null {
  return aiStatus(cfg).configured ? new GeminiClient(cfg) : null;
}
