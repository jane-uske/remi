# Local VLM Smoke Test

This is a narrow feasibility probe for local vision-language models served through an OpenAI-compatible endpoint such as LM Studio.

It does not write family memory, does not confirm drafts, and does not bypass the parent review gate. It only sends one local image to the local VLM endpoint and prints the model output.

## 1. Start a local OpenAI-compatible server

In LM Studio:

1. Download a vision model, for example Qwen2.5 VL 7B, Qwen3 VL 4B, or Qwen3 VL 8B.
2. Load the model.
3. Start the local server.
4. Keep the base URL as `http://127.0.0.1:1234/v1` unless you changed it.

## 2. Check visible models

```bash
npm run vlm:smoke -- --list-models
```

Or explicitly:

```bash
REMI_VLM_BASE_URL=http://127.0.0.1:1234/v1 \
REMI_VLM_API_KEY=lm-studio \
npm run vlm:smoke -- --list-models
```

Use the printed model id in the next command.

## 3. Run one image smoke test

```bash
REMI_VLM_BASE_URL=http://127.0.0.1:1234/v1 \
REMI_VLM_API_KEY=lm-studio \
REMI_VLM_MODEL="<model-id-from-list-models>" \
npm run vlm:smoke -- --image ./data/inbox/assets/example.png
```

You can also pass the model inline:

```bash
npm run vlm:smoke -- --image ./data/inbox/assets/example.png --model "<model-id>"
```

## 4. What counts as pass

The model is worth further testing only if it can:

- identify document type;
- extract dates without confusing report date and sample date;
- extract Chinese metric names and result values;
- preserve ultrasound findings without inventing conclusions;
- avoid medical diagnosis unless the report explicitly says it;
- output something close to parseable JSON.

If you still need to re-read the original image and rewrite almost everything, the model fails the product bar even if it technically runs.

## 5. Recommended first models

Test in this order:

1. Qwen2.5 VL 7B
2. Qwen3 VL 4B
3. Qwen3 VL 8B
4. olmOCR 2 7B

olmOCR may be useful as OCR evidence, but Remi needs structured draft extraction, not only text recognition.

