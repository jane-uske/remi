class RemPcmCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const mono = input[0];
    if (!mono || mono.length === 0) return true;

    // Copy into a transferable buffer; input memory is reused by the engine.
    const copy = new Float32Array(mono.length);
    copy.set(mono);
    this.port.postMessage(copy, [copy.buffer]);
    return true;
  }
}

registerProcessor("remi-pcm-capture-processor", RemPcmCaptureProcessor);
