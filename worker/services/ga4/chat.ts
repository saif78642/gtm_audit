// ── GA4 Chat service: Gemini function-calling loop ────────────────────────────

import { GoogleGenAI } from '@google/genai';
import { Env } from '../../types';
import { GEMINI_MODEL } from '../../types';
import { getOAuthAccessToken } from './oauth';
import { executeGA4Function, GA4_FUNCTION_DECLARATIONS } from './api';

const GA4_SYSTEM_INSTRUCTION = `You are an expert Google Analytics 4 (GA4) Analyst.
You have access to GA4 tools that can query live data from the user's Google Analytics property.
When the user asks a question, use the available tools to fetch the relevant data, then analyze and explain the results.

Key rules:
1. Always use the tools to GET DATA before answering — never guess or invent numbers.
2. Use run_report for most analytics queries (events, sessions, users, conversions, etc.).
3. Use run_realtime_report for questions about "right now" or "today so far".
4. Use run_funnel_report for funnel analysis questions.
5. Use get_account_summaries if the user hasn't specified a property ID or wants to browse.
6. Use get_property_details for info about a specific property's configuration.
7. Use get_custom_dimensions_and_metrics before querying custom dimensions/metrics.
8. Be concise and data-driven. Present findings clearly with numbers.
9. Format currency values appropriately when they appear in results.
10. When listing dimensions/metrics, always use the exact API names (e.g. 'eventName', 'totalUsers', 'sessions').`;

export async function runGA4Chat(
  geminiAi: GoogleGenAI,
  conversationHistory: { role: string; parts: { text: string }[] }[],
  question: string,
  ga4PropertyId: string,
  db: D1Database,
  userId: string,
  env: Env,
): Promise<string> {
  const accessToken = await getOAuthAccessToken(db, userId, env);
  let contents = [...conversationHistory, { role: 'user', parts: [{ text: question }] }];
  const MAX_TOOL_TURNS = 20;
  const currentInstruction = ga4PropertyId
    ? `${GA4_SYSTEM_INSTRUCTION}\n\nThe user has currently selected GA4 Property ID: ${ga4PropertyId}. Use this property ID by default for all queries unless specified otherwise.`
    : GA4_SYSTEM_INSTRUCTION;

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const response = await geminiAi.models.generateContent({
      model: GEMINI_MODEL, contents: contents as any,
      config: { systemInstruction: currentInstruction, tools: [{ functionDeclarations: GA4_FUNCTION_DECLARATIONS }], temperature: 0.3 },
    });
    const candidate = response.candidates?.[0];
    if (!candidate || !candidate.content?.parts?.length) break;
    const parts = candidate.content.parts;
    const functionCalls = parts.filter((p: any) => p.functionCall).map((p: any) => p.functionCall);
    const textParts = parts.filter((p: any) => p.text).map((p: any) => p.text).join('');
    if (functionCalls.length > 0) {
      contents.push({ role: 'model', parts: parts } as any);
      const functionResponses = [];
      for (const fc of functionCalls) {
        const resultStr = await executeGA4Function(fc.name!, (fc.args || {}) as Record<string, unknown>, accessToken);
        functionResponses.push({ functionResponse: { id: fc.id || fc.name, name: fc.name!, response: { name: fc.name!, content: resultStr } } });
      }
      contents.push({ role: 'user', parts: functionResponses } as any);
    } else { return textParts; }
  }
  throw new Error('GA4 chat exceeded maximum tool call turns without a text response.');
}
