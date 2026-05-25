#!/usr/bin/env node
/* Local VLM smoke test for LM Studio / OpenAI-compatible chat-completions servers. */
const fs = require('node:fs');
const path = require('node:path');
try { require('dotenv/config'); } catch {}

function usage(code = 0) {
  console.log(`Usage:
  node scripts/local-vlm-smoke.cjs --list-models
  node scripts/local-vlm-smoke.cjs --image ./report.png --model <loaded-vlm-model-id>

Env:
  REMI_VLM_BASE_URL   default: REMI_LLM_BASE_URL or http://127.0.0.1:1234/v1
  REMI_VLM_API_KEY    default: REMI_LLM_API_KEY or lm-studio
  REMI_VLM_MODEL      default: REMI_LLM_MODEL
  REMI_VLM_MAX_TOKENS default: 1200
`);
  process.exit(code);
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function has(name) {
  return process.argv.includes(name);
}

function mimeFor(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'application/octet-stream';
}

function endpoint(baseUrl, suffix) {
  return `${baseUrl.replace(/\/$/, '')}${suffix}`;
}

async function requestJson(url, body, apiKey, timeoutMs) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: body ? 'POST' : 'GET',
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        Authorization: `Bearer ${apiKey}`,
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ac.signal,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 1200)}`);
    return text ? JSON.parse(text) : {};
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const baseUrl = arg('--base-url') || process.env.REMI_VLM_BASE_URL || process.env.REMI_LLM_BASE_URL || 'http://127.0.0.1:1234/v1';
  const apiKey = arg('--api-key') || process.env.REMI_VLM_API_KEY || process.env.REMI_LLM_API_KEY || 'lm-studio';
  const model = arg('--model') || process.env.REMI_VLM_MODEL || process.env.REMI_LLM_MODEL;
  const timeoutMs = Number(arg('--timeout-ms') || process.env.REMI_VLM_TIMEOUT_MS || 120000);
  const maxTokens = Number(arg('--max-tokens') || process.env.REMI_VLM_MAX_TOKENS || 1200);

  if (has('--help') || has('-h')) usage(0);

  if (has('--list-models')) {
    const body = await requestJson(endpoint(baseUrl, '/models'), null, apiKey, timeoutMs);
    const ids = (body.data || []).map((m) => m.id).filter(Boolean);
    console.log(ids.length ? ids.join('\n') : JSON.stringify(body, null, 2));
    return;
  }

  const image = arg('--image');
  if (!image || !model) usage(1);
  if (!fs.existsSync(image)) throw new Error(`image not found: ${image}`);

  const prompt = arg('--prompt') || `你是家庭医疗资料整理助手。请只基于图片原文抽取结构化草稿，不要做医学诊断，不要把推测当事实。输出 JSON，字段包括 document_type, event_date, report_date, institution, findings, metrics, warnings。metrics 每项包含 name, value, unit, reference_range, flag, source_text, confidence。`;
  const dataUrl = `data:${mimeFor(image)};base64,${fs.readFileSync(image).toString('base64')}`;

  const body = {
    model,
    temperature: 0,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: 'You extract structured facts from Chinese medical/family documents. Be conservative. Return JSON only when possible.' },
      { role: 'user', content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: dataUrl } },
      ] },
    ],
  };

  const res = await requestJson(endpoint(baseUrl, '/chat/completions'), body, apiKey, timeoutMs);
  const content = res.choices?.[0]?.message?.content || JSON.stringify(res, null, 2);
  console.log(content.trim());
}

main().catch((err) => {
  console.error(`[vlm:smoke] ${err.message || err}`);
  process.exit(1);
});

