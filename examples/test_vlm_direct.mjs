import { AutoProcessor, AutoModelForVision2Seq, RawImage } from '@huggingface/transformers';

async function runTest() {
  console.log("Loading SmolVLM-500M model and processor...");
  const modelId = 'HuggingFaceTB/SmolVLM-500M-Instruct';
  const processor = await AutoProcessor.from_pretrained(modelId);
  const model = await AutoModelForVision2Seq.from_pretrained(modelId, {
    device: 'cpu',
    dtype: 'q4',
  });
  console.log("Model ready!");

  const testCases = [
    {
      name: "finalfinallogo.png",
      path: "D:/Code Playground/PairIt/finalfinallogo.png",
      prompt: "what is in this image?"
    },
    {
      name: "alerter.png",
      path: "D:/Code Playground/PairIt/alerter.png",
      prompt: "what is in this image?"
    }
  ];

  for (const test of testCases) {
    const rawImg = await RawImage.read(test.path);
    console.log(`\n==================================================`);
    console.log(`Testing Image: ${test.name}`);

    const messages = [
      {
        role: "user",
        content: [
          { type: "image" },
          { type: "text", text: test.prompt }
        ]
      }
    ];

    const formattedPrompt = processor.apply_chat_template(messages, {
      add_generation_prompt: true,
      tokenize: false,
    });

    const inputs = await processor(formattedPrompt, rawImg, {
      do_image_splitting: false,
    });

    const eosTokenId = processor.tokenizer.eos_token_id || 49279;

    const output = await model.generate({
      ...inputs,
      max_new_tokens: 180,
      do_sample: false,
      no_repeat_ngram_size: 3,
      eos_token_id: eosTokenId,
    });

    const decoded = processor.batch_decode(output, { skip_special_tokens: false });
    const rawText = decoded[0] || "";

    const assistantParts = rawText.split(/Assistant:\s*/i);
    let answer = assistantParts.length > 1 ? assistantParts[assistantParts.length - 1] : rawText;
    for (const stopToken of ["<end_of_utterance>", "<|im_end|>", "<|endoftext|>", "User:"]) {
      if (answer.includes(stopToken)) {
        answer = answer.split(stopToken)[0];
      }
    }
    answer = answer.replace(/<\|[^>]*\|>/g, "").replace(/<fake_token[^>]*>/g, "").replace(/<image>/g, "").trim();

    console.log(`Response:\n${answer}`);
  }
}

runTest().catch(console.error);
