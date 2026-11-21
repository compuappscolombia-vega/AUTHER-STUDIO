import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFrameoToolArguments,
  createPkcePair,
  extractVideoOrJobFromMcpResult,
  parseMcpResponseText,
  selectFrameoPollTool,
  selectFrameoVideoTool,
} from './frameoMcpClient.ts';

describe('frameoMcpClient helpers', () => {
  it('generates RFC 7636 PKCE S256 verifier and challenge pairs', () => {
    const { codeVerifier, codeChallenge } = createPkcePair();
    assert.ok(codeVerifier.length >= 43);
    assert.ok(codeChallenge.length >= 43);
    assert.notEqual(codeVerifier, codeChallenge);
    assert.equal(codeChallenge.includes('='), false);
  });

  it('parses both direct JSON-RPC responses and text/event-stream SSE MCP envelopes', () => {
    const direct = parseMcpResponseText(
      JSON.stringify({ jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'generate_video' }] } }),
      2
    );
    assert.equal(direct.id, 2);

    const ssePayload = [
      'event: message',
      'data: {"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-03-26"}}',
      '',
      'event: message',
      'data: {"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"frameo_generate_video"}]}}',
    ].join('\n');
    const sseMatched = parseMcpResponseText(ssePayload, 2);
    assert.equal(sseMatched.id, 2);
    assert.ok(Array.isArray((sseMatched.result as { tools: unknown[] }).tools));
  });

  it('selects video generation and polling tools cleanly from discovered MCP tools', () => {
    const tools = [
      { name: 'get_account_credits', description: 'Check remaining credits' },
      { name: 'get_task_status', description: 'Poll video generation task status' },
      {
        name: 'generate_video',
        description: 'Generate cinematic video with Veo 3.1 or Kling O3',
        inputSchema: {
          type: 'object',
          properties: {
            prompt: { type: 'string' },
            model: { type: 'string' },
            aspect_ratio: { type: 'string' },
            duration: { type: 'number' },
            resolution: { type: 'string' },
          },
          required: ['prompt'],
        },
      },
    ];

    const videoTool = selectFrameoVideoTool(tools);
    assert.equal(videoTool?.name, 'generate_video');

    const pollTool = selectFrameoPollTool(tools);
    assert.equal(pollTool?.name, 'get_task_status');

    const args = buildFrameoToolArguments(videoTool!, {
      prompt: 'Foggy northern pier at dawn',
      model: 'Veo 3.1 Rápido',
      aspectRatio: '16:9',
      durationSeconds: 5,
      resolution: '1080p',
    });
    assert.equal(args.prompt, 'Foggy northern pier at dawn');
    assert.equal(args.model, 'Veo 3.1 Rápido');
    assert.equal(args.aspect_ratio, '16:9');
    assert.equal(args.duration, 5);
    assert.equal(args.resolution, '1080p');
  });

  it('extracts video URL or async task_id from structuredContent or text MCP results', () => {
    const withUrl = extractVideoOrJobFromMcpResult({
      content: [
        {
          type: 'text',
          text: JSON.stringify({ status: 'completed', video_url: 'https://cdn.frameo.ai/renders/TOS_EP01_SH003_v004.mp4' }),
        },
      ],
    });
    assert.equal(
      withUrl.videoUrl,
      'https://cdn.frameo.ai/renders/TOS_EP01_SH003_v004.mp4'
    );

    const withJob = extractVideoOrJobFromMcpResult({
      structuredContent: { task_id: 'task_frameo_9981' },
    });
    assert.equal(withJob.jobId, 'task_frameo_9981');
  });
});
