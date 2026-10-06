const test = require('node:test');
const assert = require('node:assert/strict');
const { processSalesConversation } = require('../src/agent/engine');

test('agent returns a structured qualification response without a Gemini key', async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'your_gemini_api_key';
  try {
    const result = await processSalesConversation('We are evaluating a sales solution for our team.');
    assert.equal(typeof result.reply, 'string');
    assert.equal(result.currentState, 'QUALIFIED');
    assert.ok(result.leadScore >= 0 && result.leadScore <= 100);
    assert.equal(typeof result.objectionHandling.active, 'boolean');
  } finally {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});

test('agent identifies an objection and returns a bounded score', async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'your_gemini_api_key';
  try {
    const result = await processSalesConversation('The price seems expensive for our budget.', [], 'QUALIFIED', 40);
    assert.equal(result.currentState, 'OBJECTION_HANDLING');
    assert.equal(result.objectionHandling.active, true);
    assert.equal(result.objectionHandling.category, 'PRICE');
    assert.ok(result.leadScore >= 0 && result.leadScore <= 100);
  } finally {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});

test('agent progresses a clear demo request to closing', async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'your_gemini_api_key';
  try {
    const result = await processSalesConversation('Can we schedule a demo next week?', [], 'QUALIFIED', 55);
    assert.equal(result.currentState, 'CLOSING');
    assert.equal(result.objectionHandling.active, false);
    assert.ok(result.leadScore > 55 && result.leadScore <= 100);
  } finally {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});

test('a cold lead with a demo request is qualified before closing', async () => {
  const previousKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'your_gemini_api_key';
  try {
    const result = await processSalesConversation('Can we schedule a demo next week?');
    assert.equal(result.currentState, 'QUALIFIED');
    assert.ok(result.leadScore > 0 && result.leadScore <= 100);
  } finally {
    if (previousKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousKey;
  }
});
