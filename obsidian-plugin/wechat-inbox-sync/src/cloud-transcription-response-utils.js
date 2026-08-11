'use strict';

const { dedupeRepeatedTranscriptionLines } = require('./transcription-quality-utils');

function parseTencentCreateTaskResponse(payload) {
  const data = payload && payload.Response && payload.Response.Data;
  const taskId = data && (data.TaskId || data.TaskID || data.Taskid);
  if (!taskId) {
    const error = payload && payload.Response && payload.Response.Error;
    throw new Error(error ? `${error.Code}: ${error.Message}` : '腾讯云未返回转写任务 ID');
  }
  return taskId;
}

function cleanTencentResultText(text) {
  return String(text || '')
    .replace(/^\[[^\]]+\]\s*/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function tryParseJson(text) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return null;
  }
}

function extractOpenAICompatibleText(payload) {
  const choice = payload && payload.choices && payload.choices[0];
  const content = choice && (
    (choice.delta && choice.delta.content)
    || (choice.message && choice.message.content)
    || choice.text
  );
  if (Array.isArray(content)) {
    return content.map((part) => part.text || part.content || '').join('');
  }
  return typeof content === 'string' ? content : '';
}

function parseAliyunTranscriptionResult(responseText) {
  const text = String(responseText || '').trim();
  const dataLines = text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith('data:'));

  if (dataLines.length) {
    return dataLines
      .map((line) => line.replace(/^data:\s*/, '').trim())
      .filter((line) => line && line !== '[DONE]')
      .map((line) => extractOpenAICompatibleText(tryParseJson(line)))
      .join('')
      .trim();
  }

  const payload = tryParseJson(text);
  if (payload) {
    return extractOpenAICompatibleText(payload).trim();
  }
  return text;
}

function getHeader(headers, name) {
  if (!headers) return '';
  if (headers[name]) return headers[name];
  const lowerName = name.toLowerCase();
  const key = Object.keys(headers).find((item) => item.toLowerCase() === lowerName);
  return key ? headers[key] : '';
}

function formatHttpError(provider, response) {
  const parts = [`${provider}请求失败：HTTP ${response && response.status}`];
  ['X-Api-Status-Code', 'X-Api-Message', 'X-Api-Request-Id'].forEach((name) => {
    const value = getHeader(response && response.headers, name);
    if (value) {
      parts.push(`${name}=${value}`);
    }
  });
  const body = String((response && (response.text || JSON.stringify(response.json || ''))) || '').trim();
  if (body) {
    parts.push(body.slice(0, 500));
  }
  return parts.join('；');
}

function normalizeDoubaoSpeakerText(result) {
  if (!result || typeof result !== 'object') return '';
  const utterances = Array.isArray(result.utterances) ? result.utterances : [];
  if (!utterances.length) return '';
  return dedupeRepeatedTranscriptionLines(utterances
    .map((item) => {
      const text = String((item && (item.text || item.result_text || item.utterance_text)) || '').trim();
      if (!text) return '';
      const additions = item && item.additions && typeof item.additions === 'object' ? item.additions : {};
      const speaker = item && (
        item.speaker
        || item.speaker_id
        || item.spk
        || item.speakerId
        || additions.speaker
        || additions.speaker_id
        || additions.spk
        || additions.speakerId
      );
      return speaker === undefined || speaker === null || speaker === ''
        ? text
        : `说话人${speaker}：${text}`;
    })
    .filter(Boolean)
    .join('\n')
    .trim());
}

function parseDoubaoAsrResult(payload) {
  const data = typeof payload === 'string' ? tryParseJson(payload) : payload;
  const result = data && data.result;
  if (Array.isArray(result)) {
    return dedupeRepeatedTranscriptionLines(result
      .map((item) => normalizeDoubaoSpeakerText(item) || String((item && (item.text || item.result_text || item.utterance_text)) || '').trim())
      .filter(Boolean)
      .join('\n')
      .trim());
  }
  const speakerText = normalizeDoubaoSpeakerText(result);
  if (speakerText) return speakerText;
  const text = (result && (result.text || result.result_text))
    || (data && (data.text || data.transcription))
    || '';
  return dedupeRepeatedTranscriptionLines(String(text || '').trim());
}

function parseDoubaoAsrTaskState(response) {
  if (response.status && (response.status < 200 || response.status >= 300)) {
    throw new Error(formatHttpError('豆包语音识别', response));
  }

  const statusCode = getHeader(response.headers, 'X-Api-Status-Code');
  if (statusCode && statusCode !== '20000000') {
    if (statusCode === '20000001' || statusCode === '20000002') {
      return {
        status: 'processing',
        transcription: '',
      };
    }
    throw new Error(formatHttpError('豆包语音识别', response));
  }

  const transcription = parseDoubaoAsrResult(response.json || response.text);
  return {
    status: transcription ? 'success' : 'empty',
    transcription,
  };
}

function parseTencentTaskStatusResponse(payload) {
  const data = payload && payload.Response && payload.Response.Data;
  const error = payload && payload.Response && payload.Response.Error;
  if (error) {
    return {
      status: 3,
      statusStr: 'failed',
      transcription: '',
      errorMsg: `${error.Code}: ${error.Message}`,
    };
  }

  const status = Number(data && data.Status);
  const statusStr = String((data && data.StatusStr) || '').toLowerCase();
  return {
    status,
    statusStr,
    transcription: cleanTencentResultText(data && data.Result),
    errorMsg: (data && (data.ErrorMsg || data.ErrorMessage)) || '',
  };
}

module.exports = {
  parseTencentCreateTaskResponse,
  cleanTencentResultText,
  tryParseJson,
  extractOpenAICompatibleText,
  parseAliyunTranscriptionResult,
  getHeader,
  formatHttpError,
  normalizeDoubaoSpeakerText,
  parseDoubaoAsrResult,
  parseDoubaoAsrTaskState,
  parseTencentTaskStatusResponse,
};
