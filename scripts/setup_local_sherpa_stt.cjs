#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const DEFAULT_MODEL = "sherpa-onnx-streaming-zipformer-small-bilingual-zh-en-2023-02-16";
const modelName = (process.env.STT_SHERPA_MODEL_NAME || DEFAULT_MODEL).trim();
const url = (
  process.env.STT_SHERPA_MODEL_URL ||
  `https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${modelName}.tar.bz2`
).trim();
const modelsRoot = path.resolve(process.cwd(), "models");
const targetDir = path.join(modelsRoot, modelName);
const archivePath = path.join(modelsRoot, `${modelName}.tar.bz2`);

function exists(filePath) {
  return Boolean(filePath) && fs.existsSync(filePath);
}

function hasRequiredFiles(dir) {
  return (
    exists(path.join(dir, "tokens.txt")) &&
    (exists(path.join(dir, "encoder-epoch-99-avg-1.int8.onnx")) ||
      exists(path.join(dir, "encoder-epoch-99-avg-1.onnx"))) &&
    (exists(path.join(dir, "decoder-epoch-99-avg-1.onnx")) ||
      exists(path.join(dir, "decoder-epoch-99-avg-1.int8.onnx"))) &&
    (exists(path.join(dir, "joiner-epoch-99-avg-1.int8.onnx")) ||
      exists(path.join(dir, "joiner-epoch-99-avg-1.onnx")))
  );
}

fs.mkdirSync(modelsRoot, { recursive: true });

if (!hasRequiredFiles(targetDir)) {
  console.log(`[setup-sherpa-stt] downloading ${modelName}`);
  execFileSync("curl", ["-L", "--fail", "-o", archivePath, url], {
    stdio: "inherit",
  });
  console.log(`[setup-sherpa-stt] extracting to ${modelsRoot}`);
  execFileSync("tar", ["-xjf", archivePath, "-C", modelsRoot], {
    stdio: "inherit",
  });
  fs.rmSync(archivePath, { force: true });
} else {
  console.log(`[setup-sherpa-stt] model already present: ${targetDir}`);
}

if (!hasRequiredFiles(targetDir)) {
  console.error(`[setup-sherpa-stt] missing required files under ${targetDir}`);
  process.exit(1);
}

console.log("[setup-sherpa-stt] ready");
console.log(`[setup-sherpa-stt] STT_SHERPA_MODEL_DIR=${targetDir}`);
