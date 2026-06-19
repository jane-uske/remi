const assert = require("assert").strict;

const {
  classifyImageIntent,
  extractSubject,
} = require("../../capabilities/image_generation/image_intent");
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
        assert.equal(intent.prompt, expected, `prompt for: ${message}`);
      }
    }
  });

  it("does not hijack casual conversation that merely mentions 画", () => {
    for (const message of ["这个画面好美", "我下午有个计划", "动画片好看吗"]) {
      assert.equal(classifyImageIntent(message).kind, "none", message);
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
