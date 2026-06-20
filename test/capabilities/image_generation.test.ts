const assert = require("assert").strict;

const {
  classifyImageIntent,
  classifyImageIntentRegex,
  enrichComfyPrompt,
  extractSubject,
  isImageContinuationCommand,
  mightBeImageCommand,
  mightBeImageFollowUp,
  normalizeGenerateSubject,
} = require("../../capabilities/image_generation/image_intent");
const {
  assembleImagePrompt,
} = require("../../capabilities/image_generation/assemble_image_prompt");
const {
  applyCharacterStyle,
  detectExplicitStyleOverride,
  extractSceneBaseline,
  stripFreestyleStyleTags,
  styleTagsFromName,
} = require("../../capabilities/image_generation/image_character_style");
const {
  resolveImageIntent,
} = require("../../capabilities/image_generation/resolve_image_intent");
const {
  enrichImageIntentWithScenePrompt,
} = require("../../capabilities/image_generation/enrich_image_intent");
const {
  patchWorkflow,
  loadWorkflow,
  DEFAULT_COMFYUI_WORKFLOW,
} = require("../../capabilities/image_generation/comfyui_workflow");

describe("image generation intent", () => {
  it("recognizes explicit draw commands and extracts the subject", () => {
    const cases: [string, string][] = [
      ["帮我画一张夕阳下的海", "夕阳下的海"],
      ["画一只戴帽子的橘猫", "戴帽子的橘猫"],
      ["生成图片 赛博朋克城市", "赛博朋克城市"],
      ["画个机器人", "机器人"],
    ];
    for (const [message, expected] of cases) {
      const intent = classifyImageIntent(message);
      assert.equal(intent.kind, "generate", `kind for: ${message}`);
      if (intent.kind === "generate") {
        assert.equal(intent.subject, expected, `subject for: ${message}`);
      }
    }
  });

  it("does not hijack casual conversation that merely mentions 画", () => {
    for (const message of ["这个画面好美", "我下午有个计划", "动画片好看吗"]) {
      assert.equal(classifyImageIntent(message).kind, "none", message);
    }
  });

  it("recognizes implicit photo/selfie requests as generate", () => {
    const cases: [string, string][] = [
      ["看看你这个照片", "generate"],
      ["看看你的照片", "generate"],
      ["给我看照片", "generate"],
      ["发个自拍", "generate"],
      ["来张照片", "generate"],
      ["拍张照片", "generate"],
      ["我想看你的写真", "generate"],
    ];
    for (const [message, expected] of cases) {
      const intent = classifyImageIntentRegex(message);
      assert.equal(intent.kind, expected, `kind for: ${message}`);
    }
  });

  it("rejects questions, negations, and meta-discussion about images", () => {
    const falseCases = [
      "记得我之前让你生成什么图片吗",
      "不是让你生图",
      "你刚才画的是什么",
      "不要画了",
      "别画了",
      "没让你画",
      "不是让你画图",
      "什么图片？",
      "我没说要生图啊",
    ];
    for (const message of falseCases) {
      assert.equal(
        classifyImageIntentRegex(message).kind,
        "none",
        `should be none: ${message}`,
      );
    }
  });

  it("recognizes redraw intent", () => {
    for (const message of ["重画一张", "再画一张", "换一张", "重新生成"]) {
      assert.equal(classifyImageIntent(message).kind, "redraw", message);
    }
  });

  it("recognizes restyle intent and captures the style", () => {
    const intent = classifyImageIntent("换成水彩风格");
    assert.equal(intent.kind, "restyle");
    if (intent.kind === "restyle") {
      assert.equal(intent.style, "水彩");
    }
  });

  it("captures inline subject when restyling", () => {
    const intent = classifyImageIntent("画成赛博朋克风格的猫");
    assert.equal(intent.kind, "restyle");
    if (intent.kind === "restyle") {
      assert.equal(intent.style, "赛博朋克");
      assert.equal(intent.subject, "猫");
    }
  });

  it("returns none for non-image messages", () => {
    assert.equal(classifyImageIntent("现在几点了").kind, "none");
    assert.equal(classifyImageIntent("").kind, "none");
  });

  it("extractSubject strips leading command words and trailing politeness", () => {
    assert.equal(extractSubject("帮我画一只猫谢谢"), "猫");
    assert.equal(extractSubject("画个没有尾巴的猫"), "没有尾巴的猫");
  });

  it("normalizeGenerateSubject strips command verbs from LLM echoes", () => {
    assert.equal(
      normalizeGenerateSubject("画个没有尾巴的猫", "画个没有尾巴的猫"),
      "没有尾巴的猫",
    );
  });

  it("enrichComfyPrompt adds English negation tags for tailless requests", () => {
    assert.match(
      enrichComfyPrompt("没有尾巴的猫"),
      /tailless cat.*no tail/,
    );
  });

  it("assembleImagePrompt is step 2 between intent and ComfyUI", () => {
    const planned = assembleImagePrompt({
      intent: { kind: "generate", subject: "画个没有尾巴的猫" },
      userMessage: "画个没有尾巴的猫",
    });
    assert.equal(planned.ok, true);
    if (planned.ok) {
      assert.equal(planned.assembled.label, "没有尾巴的猫");
      assert.equal(planned.assembled.subject, "没有尾巴的猫");
      assert.match(planned.assembled.comfyPrompt, /tailless cat/);
    }
  });

  it("locks character style and strips LLM freestyle aesthetic tags", () => {
    const planned = assembleImagePrompt({
      intent: {
        kind: "generate",
        subject: "Remi",
        comfyPrompt:
          "1girl, solo, Remi, mouth open, anime style, photorealistic, sucking",
      },
      userMessage: "画 Remi",
    });
    assert.equal(planned.ok, true);
    if (planned.ok) {
      assert.match(planned.assembled.comfyPrompt, /photorealistic/);
      assert.match(planned.assembled.comfyPrompt, /Remi/);
      assert.doesNotMatch(planned.assembled.comfyPrompt, /anime style/i);
      assert.doesNotMatch(planned.assembled.comfyPrompt, /^1girl/i);
    }
  });

  it("restyle updates locked character style for later generates", () => {
    const restyle = assembleImagePrompt({
      intent: { kind: "restyle", style: "动漫", subject: "Remi" },
      userMessage: "换成动漫风格",
      lastImage: {
        subject: "Remi",
        prompt: "masterpiece, photorealistic, Remi standing",
        characterStyle: "photorealistic, 8k raw photo",
      },
    });
    assert.equal(restyle.ok, true);
    if (!restyle.ok) return;

    const next = assembleImagePrompt({
      intent: {
        kind: "generate",
        subject: "Remi sitting",
        comfyPrompt: "Remi sitting on bed, shy smile",
      },
      userMessage: "再画一张 Remi 坐着",
      characterStyle: restyle.assembled.characterStyle,
    });
    assert.equal(next.ok, true);
    if (next.ok) {
      assert.match(next.assembled.comfyPrompt, /anime illustration/i);
      assert.doesNotMatch(next.assembled.comfyPrompt, /8k raw photo/i);
    }
  });

  it("detects image continuation commands when a prior image exists", () => {
    assert.equal(isImageContinuationCommand("更骚点，丝袜脱掉，屁股翘过来"), true);
    assert.equal(mightBeImageFollowUp("更骚点，丝袜脱掉", true), true);
    assert.equal(mightBeImageFollowUp("更骚点，丝袜脱掉", false), false);
    assert.equal(mightBeImageCommand("更骚点，丝袜脱掉"), false);

    const intent = classifyImageIntentRegex("丝袜脱掉，屁股翘过来");
    assert.equal(intent.kind, "refine");
    if (intent.kind === "refine") {
      assert.match(intent.delta, /丝袜脱掉/);
    }
  });

  it("assembleImagePrompt refine keeps subject and locked style from last image", () => {
    const last = {
      subject: "Remi kneeling",
      prompt:
        "masterpiece, best quality, ultra-detailed, photorealistic, cinematic lighting, 8k raw photo, Remi kneeling in stockings",
      characterStyle: "photorealistic, 8k raw photo",
    };
    const planned = assembleImagePrompt({
      intent: {
        kind: "refine",
        delta: "更骚点，丝袜脱掉，屁股翘过来",
        comfyPrompt:
          "Remi kneeling, stockings removed, ass raised high, looking back",
      },
      userMessage: "更骚点，丝袜脱掉，屁股翘过来",
      lastImage: last,
      characterStyle: last.characterStyle,
    });
    assert.equal(planned.ok, true);
    if (planned.ok) {
      assert.equal(planned.assembled.subject, "Remi kneeling");
      assert.match(planned.assembled.label, /改版/);
      assert.match(planned.assembled.comfyPrompt, /stockings removed/i);
      assert.match(planned.assembled.comfyPrompt, /photorealistic/i);
    }

    const baseline = extractSceneBaseline(last.prompt, last.characterStyle);
    assert.match(baseline, /Remi kneeling/i);
    assert.doesNotMatch(baseline, /masterpiece/i);
  });

  it("enrichImageIntent uses pasted prompt without calling LLM", async () => {
    const restore = process.env.REMI_IMAGE_PROMPT_LLM_ENABLED;
    process.env.REMI_IMAGE_PROMPT_LLM_ENABLED = "1";
    try {
      const message =
        "用这个提示词生图：girl on beach, sunset, detailed waves";
      const intent = await enrichImageIntentWithScenePrompt({
        intent: { kind: "generate", subject: "girl on beach, sunset, detailed waves" },
        userMessage: message,
        connId: "test-conn",
      });
      assert.equal(intent.kind, "generate");
      if (intent.kind === "generate") {
        assert.equal(intent.comfyPrompt, "girl on beach, sunset, detailed waves");
      }
    } finally {
      if (restore === undefined) delete process.env.REMI_IMAGE_PROMPT_LLM_ENABLED;
      else process.env.REMI_IMAGE_PROMPT_LLM_ENABLED = restore;
    }
  });

  it("detects 扮演-style overrides in generate messages", () => {
    assert.equal(detectExplicitStyleOverride("扮演吉卜力风格画 Remi"), "吉卜力");
    assert.equal(
      styleTagsFromName("吉卜力"),
      "studio ghibli style, soft colors, hand-drawn animation",
    );
    assert.equal(
      stripFreestyleStyleTags("1girl, solo, anime style, Remi smiling"),
      "Remi smiling",
    );
    assert.match(
      applyCharacterStyle("Remi smiling", "photorealistic, 8k raw photo"),
      /photorealistic.*Remi smiling/,
    );
  });

  it("prefilter flags image-like candidates without finalizing intent", () => {
    assert.equal(mightBeImageCommand("这个画面好美"), true);
    assert.equal(mightBeImageCommand("帮我画一只猫"), true);
    assert.equal(mightBeImageCommand("今天天气真好"), false);
    assert.equal(mightBeImageCommand("我下午有个计划"), false);
  });

  it("regex fallback still matches explicit draw commands", () => {
    assert.equal(classifyImageIntentRegex("帮我画一张夕阳下的海").kind, "generate");
  });

  it("regex matches paste-to-generate commands with 提示词生图", () => {
    const message =
      "用这个提示词生图：masterpiece, best quality, 8k raw photo, cute cat";
    const intent = classifyImageIntentRegex(message);
    assert.equal(intent.kind, "generate");
    if (intent.kind === "generate") {
      assert.equal(intent.subject, "masterpiece, best quality, 8k raw photo, cute cat");
    }
  });

  it("resolveImageIntent skips LLM when prefilter does not match", async () => {
    const restore = process.env.REMI_IMAGE_INTENT_LLM_ENABLED;
    process.env.REMI_IMAGE_INTENT_LLM_ENABLED = "1";
    try {
      const intent = await resolveImageIntent({
        userMessage: "今天天气真好",
        hasPreviousImage: false,
      });
      assert.equal(intent.kind, "none");
    } finally {
      if (restore === undefined) {
        delete process.env.REMI_IMAGE_INTENT_LLM_ENABLED;
      } else {
        process.env.REMI_IMAGE_INTENT_LLM_ENABLED = restore;
      }
    }
  });

  it("resolveImageIntent uses regex when LLM gate is disabled", async () => {
    const restore = process.env.REMI_IMAGE_INTENT_LLM_ENABLED;
    process.env.REMI_IMAGE_INTENT_LLM_ENABLED = "0";
    try {
      const intent = await resolveImageIntent({
        userMessage: "帮我画一只戴帽子的橘猫",
        hasPreviousImage: false,
      });
      assert.equal(intent.kind, "generate");
      if (intent.kind === "generate") {
        assert.equal(intent.subject, "戴帽子的橘猫");
      }
    } finally {
      if (restore === undefined) {
        delete process.env.REMI_IMAGE_INTENT_LLM_ENABLED;
      } else {
        process.env.REMI_IMAGE_INTENT_LLM_ENABLED = restore;
      }
    }
  });
});

describe("comfyui workflow patch — SD1.5-style (built-in default)", () => {
  it("only patches whitelisted fields, resolving nodes by graph topology", () => {
    const base = JSON.parse(JSON.stringify(DEFAULT_COMFYUI_WORKFLOW));
    const { workflow, warnings } = patchWorkflow(base, {
      prompt: "a red fox in snow",
      negativePrompt: "blurry",
      seed: 12345,
      width: 768,
      height: 1024,
    });

    assert.deepEqual(warnings, []);
    // positive prompt -> node referenced by KSampler.positive (node 6)
    assert.equal(workflow["6"].inputs.text, "a red fox in snow");
    // negative prompt -> node referenced by KSampler.negative (node 7)
    assert.equal(workflow["7"].inputs.text, "blurry");
    // seed -> KSampler (node 3)
    assert.equal(workflow["3"].inputs.seed, 12345);
    // dimensions -> EmptyLatentImage (node 5)
    assert.equal(workflow["5"].inputs.width, 768);
    assert.equal(workflow["5"].inputs.height, 1024);
  });

  it("does not mutate the original workflow object", () => {
    const before = JSON.stringify(DEFAULT_COMFYUI_WORKFLOW);
    const base = JSON.parse(JSON.stringify(DEFAULT_COMFYUI_WORKFLOW));
    patchWorkflow(base, { prompt: "test", seed: 1 });
    assert.equal(JSON.stringify(DEFAULT_COMFYUI_WORKFLOW), before);
  });

  it("clamps dimensions to a sane multiple-of-8 range", () => {
    const base = JSON.parse(JSON.stringify(DEFAULT_COMFYUI_WORKFLOW));
    const { workflow } = patchWorkflow(base, { width: 99999, height: 7 });
    assert.equal(workflow["5"].inputs.width, 2048);
    assert.equal(workflow["5"].inputs.height, 256);
  });
});

describe("comfyui workflow patch — split-model (z_image_turbo style)", () => {
  // Minimal z_image_turbo-style workflow for unit tests
  const Z_IMAGE_TURBO_WORKFLOW = {
    "9":  { class_type: "SaveImage", inputs: { filename_prefix: "Remi", images: ["43", 0] } },
    "39": { class_type: "CLIPLoader", inputs: { clip_name: "qwen_3_4b.safetensors", type: "lumina2", device: "default" } },
    "40": { class_type: "VAELoader", inputs: { vae_name: "ae.safetensors" } },
    "41": { class_type: "EmptySD3LatentImage", inputs: { width: 1024, height: 1024, batch_size: 1 } },
    "42": { class_type: "ConditioningZeroOut", inputs: { conditioning: ["45", 0] } },
    "43": { class_type: "VAEDecode", inputs: { samples: ["44", 0], vae: ["40", 0] } },
    "44": { class_type: "KSampler", inputs: { seed: 12345, steps: 9, cfg: 1, sampler_name: "res_multistep", scheduler: "simple", denoise: 1, model: ["47", 0], positive: ["45", 0], negative: ["42", 0], latent_image: ["41", 0] } },
    "45": { class_type: "CLIPTextEncode", inputs: { text: "default prompt", clip: ["39", 0] } },
    "46": { class_type: "UNETLoader", inputs: { unet_name: "z_image_turbo_bf16.safetensors", weight_dtype: "default" } },
    "47": { class_type: "ModelSamplingAuraFlow", inputs: { shift: 3, model: ["46", 0] } },
  };

  it("patches prompt, seed, dimensions on split-model workflows", () => {
    const base = JSON.parse(JSON.stringify(Z_IMAGE_TURBO_WORKFLOW));
    const { workflow, warnings } = patchWorkflow(base, {
      prompt: "a cute cat",
      seed: 42,
      width: 768,
      height: 768,
    });

    assert.deepEqual(warnings, []);
    assert.equal(workflow["45"].inputs.text, "a cute cat");
    assert.equal(workflow["44"].inputs.seed, 42);
    assert.equal(workflow["41"].inputs.width, 768);
    assert.equal(workflow["41"].inputs.height, 768);
  });

  it("silently skips negative prompt when ConditioningZeroOut has no text field", () => {
    const base = JSON.parse(JSON.stringify(Z_IMAGE_TURBO_WORKFLOW));
    const { warnings } = patchWorkflow(base, {
      prompt: "a cat",
      negativePrompt: "blurry",
    });
    // Should NOT produce a warning about missing negative node
    assert.deepEqual(warnings, []);
  });

  it("patches UNETLoader when checkpoint override is given", () => {
    const base = JSON.parse(JSON.stringify(Z_IMAGE_TURBO_WORKFLOW));
    const { workflow } = patchWorkflow(base, {
      prompt: "test",
      checkpoint: "other_model.safetensors",
    });
    assert.equal(workflow["46"].inputs.unet_name, "other_model.safetensors");
  });
});
