var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// src/date-utils.js
var require_date_utils = __commonJS({
  "src/date-utils.js"(exports2, module2) {
    "use strict";
    var CHINA_TIME_OFFSET_MS = 8 * 60 * 60 * 1e3;
    function pad22(value) {
      return String(value).padStart(2, "0");
    }
    __name(pad22, "pad2");
    function getChinaTimeParts2(createdAt, now = Date.now()) {
      const parsed = new Date(createdAt);
      const date = Number.isNaN(parsed.getTime()) ? new Date(now) : parsed;
      const shifted = new Date(date.getTime() + CHINA_TIME_OFFSET_MS);
      return {
        year: shifted.getUTCFullYear(),
        month: pad22(shifted.getUTCMonth() + 1),
        day: pad22(shifted.getUTCDate()),
        hour: pad22(shifted.getUTCHours()),
        minute: pad22(shifted.getUTCMinutes()),
        second: pad22(shifted.getUTCSeconds())
      };
    }
    __name(getChinaTimeParts2, "getChinaTimeParts");
    function getDateFolderName2(createdAt) {
      const parts = getChinaTimeParts2(createdAt);
      return `${parts.year}-${parts.month}-${parts.day}`;
    }
    __name(getDateFolderName2, "getDateFolderName");
    function formatCreatedTime2(createdAt) {
      const parts = getChinaTimeParts2(createdAt);
      return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
    }
    __name(formatCreatedTime2, "formatCreatedTime");
    function getTitleTimePart2(createdAt) {
      const parts = getChinaTimeParts2(createdAt);
      return `${parts.hour}${parts.minute}${parts.second}`;
    }
    __name(getTitleTimePart2, "getTitleTimePart");
    module2.exports = {
      formatCreatedTime: formatCreatedTime2,
      getChinaTimeParts: getChinaTimeParts2,
      getDateFolderName: getDateFolderName2,
      getTitleTimePart: getTitleTimePart2,
      pad2: pad22
    };
  }
});

// src/transcription-quality-utils.js
var require_transcription_quality_utils = __commonJS({
  "src/transcription-quality-utils.js"(exports2, module2) {
    "use strict";
    function dedupeRepeatedTranscriptionLines(text) {
      const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      if (!lines.length) return "";
      const deduped = [];
      let previousLine = "";
      for (const line of lines) {
        if (line === previousLine) {
          continue;
        } else {
          previousLine = line;
        }
        deduped.push(line);
      }
      return deduped.join("\n").trim();
    }
    __name(dedupeRepeatedTranscriptionLines, "dedupeRepeatedTranscriptionLines");
    function normalizeTranscriptionQualityUnit2(value) {
      return String(value || "").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "").trim();
    }
    __name(normalizeTranscriptionQualityUnit2, "normalizeTranscriptionQualityUnit");
    function getTranscriptionQualityUnits2(text) {
      const source = String(text || "").trim();
      if (!source) return [];
      const lines = source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const rawUnits = lines.length >= 3 ? lines : source.match(/[^。！？!?；;\r\n]+[。！？!?；;]?/g) || lines;
      return rawUnits.map(normalizeTranscriptionQualityUnit2).filter((unit) => unit.length >= 4);
    }
    __name(getTranscriptionQualityUnits2, "getTranscriptionQualityUnits");
    function getTranscriptionQualityIssue2(text) {
      const units = getTranscriptionQualityUnits2(text);
      if (!units.length) return "";
      const promptLeakPattern = /^(?:请|請)(?:输入|輸入|输出|輸出)(?:简体|簡體)中文$/;
      const promptLeakCount = units.filter((unit) => promptLeakPattern.test(unit)).length;
      if (promptLeakCount >= 2 || promptLeakCount === 1 && units.length === 1) {
        return "prompt-leak";
      }
      const counts = /* @__PURE__ */ new Map();
      let longestConsecutiveRun = 1;
      let currentRun = 1;
      let previousUnit = "";
      units.forEach((unit) => {
        counts.set(unit, (counts.get(unit) || 0) + 1);
        if (unit === previousUnit) {
          currentRun += 1;
          longestConsecutiveRun = Math.max(longestConsecutiveRun, currentRun);
        } else {
          currentRun = 1;
          previousUnit = unit;
        }
      });
      const maxCount = Math.max(...counts.values());
      const repeatedShare = maxCount / units.length;
      const consecutiveShare = longestConsecutiveRun / units.length;
      if (
        // A normal course can repeat an important sentence across chunks. Only
        // reject a repeat when it dominates the recognised transcription.
        units.length <= 5 && longestConsecutiveRun >= 3 && consecutiveShare >= 0.6 || longestConsecutiveRun >= 4 && consecutiveShare >= 0.5 || maxCount >= 6 && repeatedShare >= 0.6
      ) {
        return "repeated-lines";
      }
      return "";
    }
    __name(getTranscriptionQualityIssue2, "getTranscriptionQualityIssue");
    function createTranscriptionQualityError2(text, source = "转写") {
      const issue = getTranscriptionQualityIssue2(text);
      if (!issue) return null;
      const reason = issue === "prompt-leak" ? "检测到提示词泄漏" : "检测到重复句循环";
      const error = new Error(`${source}结果质量异常：${reason}，已放弃该媒体地址并尝试备用地址。`);
      error.code = "TRANSCRIPTION_LOW_QUALITY";
      error.qualityIssue = issue;
      return error;
    }
    __name(createTranscriptionQualityError2, "createTranscriptionQualityError");
    function assertUsableTranscription2(text, source = "转写") {
      const transcription = String(text || "").trim();
      if (!transcription) {
        throw new Error(`${source}命令没有返回文本`);
      }
      const qualityError = createTranscriptionQualityError2(transcription, source);
      if (qualityError) throw qualityError;
      return transcription;
    }
    __name(assertUsableTranscription2, "assertUsableTranscription");
    module2.exports = {
      assertUsableTranscription: assertUsableTranscription2,
      createTranscriptionQualityError: createTranscriptionQualityError2,
      dedupeRepeatedTranscriptionLines,
      getTranscriptionQualityIssue: getTranscriptionQualityIssue2,
      getTranscriptionQualityUnits: getTranscriptionQualityUnits2,
      normalizeTranscriptionQualityUnit: normalizeTranscriptionQualityUnit2
    };
  }
});

// src/cloud-transcription-response-utils.js
var require_cloud_transcription_response_utils = __commonJS({
  "src/cloud-transcription-response-utils.js"(exports2, module2) {
    "use strict";
    var { dedupeRepeatedTranscriptionLines } = require_transcription_quality_utils();
    function parseTencentCreateTaskResponse2(payload) {
      const data = payload && payload.Response && payload.Response.Data;
      const taskId = data && (data.TaskId || data.TaskID || data.Taskid);
      if (!taskId) {
        const error = payload && payload.Response && payload.Response.Error;
        throw new Error(error ? `${error.Code}: ${error.Message}` : "腾讯云未返回转写任务 ID");
      }
      return taskId;
    }
    __name(parseTencentCreateTaskResponse2, "parseTencentCreateTaskResponse");
    function cleanTencentResultText(text) {
      return String(text || "").replace(/^\[[^\]]+\]\s*/gm, "").replace(/\n{3,}/g, "\n\n").trim();
    }
    __name(cleanTencentResultText, "cleanTencentResultText");
    function tryParseJson2(text) {
      try {
        return JSON.parse(text);
      } catch (error) {
        return null;
      }
    }
    __name(tryParseJson2, "tryParseJson");
    function extractOpenAICompatibleText2(payload) {
      const choice = payload && payload.choices && payload.choices[0];
      const content = choice && (choice.delta && choice.delta.content || choice.message && choice.message.content || choice.text);
      if (Array.isArray(content)) {
        return content.map((part) => part.text || part.content || "").join("");
      }
      return typeof content === "string" ? content : "";
    }
    __name(extractOpenAICompatibleText2, "extractOpenAICompatibleText");
    function parseAliyunTranscriptionResult2(responseText) {
      const text = String(responseText || "").trim();
      const dataLines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.startsWith("data:"));
      if (dataLines.length) {
        return dataLines.map((line) => line.replace(/^data:\s*/, "").trim()).filter((line) => line && line !== "[DONE]").map((line) => extractOpenAICompatibleText2(tryParseJson2(line))).join("").trim();
      }
      const payload = tryParseJson2(text);
      if (payload) {
        return extractOpenAICompatibleText2(payload).trim();
      }
      return text;
    }
    __name(parseAliyunTranscriptionResult2, "parseAliyunTranscriptionResult");
    function getHeader(headers, name) {
      if (!headers) return "";
      if (headers[name]) return headers[name];
      const lowerName = name.toLowerCase();
      const key = Object.keys(headers).find((item) => item.toLowerCase() === lowerName);
      return key ? headers[key] : "";
    }
    __name(getHeader, "getHeader");
    function formatHttpError2(provider, response) {
      const parts = [`${provider}请求失败：HTTP ${response && response.status}`];
      ["X-Api-Status-Code", "X-Api-Message", "X-Api-Request-Id"].forEach((name) => {
        const value = getHeader(response && response.headers, name);
        if (value) {
          parts.push(`${name}=${value}`);
        }
      });
      const body = String(response && (response.text || JSON.stringify(response.json || "")) || "").trim();
      if (body) {
        parts.push(body.slice(0, 500));
      }
      return parts.join("；");
    }
    __name(formatHttpError2, "formatHttpError");
    function normalizeDoubaoSpeakerText(result) {
      if (!result || typeof result !== "object") return "";
      const utterances = Array.isArray(result.utterances) ? result.utterances : [];
      if (!utterances.length) return "";
      return dedupeRepeatedTranscriptionLines(utterances.map((item) => {
        const text = String(item && (item.text || item.result_text || item.utterance_text) || "").trim();
        if (!text) return "";
        const additions = item && item.additions && typeof item.additions === "object" ? item.additions : {};
        const speaker = item && (item.speaker || item.speaker_id || item.spk || item.speakerId || additions.speaker || additions.speaker_id || additions.spk || additions.speakerId);
        return speaker === void 0 || speaker === null || speaker === "" ? text : `说话人${speaker}：${text}`;
      }).filter(Boolean).join("\n").trim());
    }
    __name(normalizeDoubaoSpeakerText, "normalizeDoubaoSpeakerText");
    function parseDoubaoAsrResult2(payload) {
      const data = typeof payload === "string" ? tryParseJson2(payload) : payload;
      const result = data && data.result;
      if (Array.isArray(result)) {
        return dedupeRepeatedTranscriptionLines(result.map((item) => normalizeDoubaoSpeakerText(item) || String(item && (item.text || item.result_text || item.utterance_text) || "").trim()).filter(Boolean).join("\n").trim());
      }
      const speakerText = normalizeDoubaoSpeakerText(result);
      if (speakerText) return speakerText;
      const text = result && (result.text || result.result_text) || data && (data.text || data.transcription) || "";
      return dedupeRepeatedTranscriptionLines(String(text || "").trim());
    }
    __name(parseDoubaoAsrResult2, "parseDoubaoAsrResult");
    function parseDoubaoAsrTaskState2(response) {
      if (response.status && (response.status < 200 || response.status >= 300)) {
        throw new Error(formatHttpError2("豆包语音识别", response));
      }
      const statusCode = getHeader(response.headers, "X-Api-Status-Code");
      if (statusCode && statusCode !== "20000000") {
        if (statusCode === "20000001" || statusCode === "20000002") {
          return {
            status: "processing",
            transcription: ""
          };
        }
        throw new Error(formatHttpError2("豆包语音识别", response));
      }
      const transcription = parseDoubaoAsrResult2(response.json || response.text);
      return {
        status: transcription ? "success" : "empty",
        transcription
      };
    }
    __name(parseDoubaoAsrTaskState2, "parseDoubaoAsrTaskState");
    function parseTencentTaskStatusResponse2(payload) {
      const data = payload && payload.Response && payload.Response.Data;
      const error = payload && payload.Response && payload.Response.Error;
      if (error) {
        return {
          status: 3,
          statusStr: "failed",
          transcription: "",
          errorMsg: `${error.Code}: ${error.Message}`
        };
      }
      const status = Number(data && data.Status);
      const statusStr = String(data && data.StatusStr || "").toLowerCase();
      return {
        status,
        statusStr,
        transcription: cleanTencentResultText(data && data.Result),
        errorMsg: data && (data.ErrorMsg || data.ErrorMessage) || ""
      };
    }
    __name(parseTencentTaskStatusResponse2, "parseTencentTaskStatusResponse");
    module2.exports = {
      parseTencentCreateTaskResponse: parseTencentCreateTaskResponse2,
      cleanTencentResultText,
      tryParseJson: tryParseJson2,
      extractOpenAICompatibleText: extractOpenAICompatibleText2,
      parseAliyunTranscriptionResult: parseAliyunTranscriptionResult2,
      getHeader,
      formatHttpError: formatHttpError2,
      normalizeDoubaoSpeakerText,
      parseDoubaoAsrResult: parseDoubaoAsrResult2,
      parseDoubaoAsrTaskState: parseDoubaoAsrTaskState2,
      parseTencentTaskStatusResponse: parseTencentTaskStatusResponse2
    };
  }
});

// src/wechat-channels-decrypt-utils.js
var require_wechat_channels_decrypt_utils = __commonJS({
  "src/wechat-channels-decrypt-utils.js"(exports2, module2) {
    var WECHAT_CHANNELS_ENCRYPTED_HEAD_BYTES = 131072;
    function u64(value) {
      return BigInt.asUintN(64, value);
    }
    __name(u64, "u64");
    var _Isaac64 = class _Isaac64 {
      constructor(seed) {
        this.randrsl = new Array(256).fill(0n);
        this.mm = new Array(256).fill(0n);
        this.randcnt = 0;
        this.aa = 0n;
        this.bb = 0n;
        this.cc = 0n;
        this.randrsl[0] = u64(seed);
        this.randinit(true);
      }
      mix(a, b, c, d, e, f, g, h) {
        a = u64(a - e);
        f = u64(f ^ h >> 9n);
        h = u64(h + a);
        b = u64(b - f);
        g = u64(g ^ u64(a << 9n));
        a = u64(a + b);
        c = u64(c - g);
        h = u64(h ^ b >> 23n);
        b = u64(b + c);
        d = u64(d - h);
        a = u64(a ^ u64(c << 15n));
        c = u64(c + d);
        e = u64(e - a);
        b = u64(b ^ d >> 14n);
        d = u64(d + e);
        f = u64(f - b);
        c = u64(c ^ u64(e << 20n));
        e = u64(e + f);
        g = u64(g - c);
        d = u64(d ^ f >> 17n);
        f = u64(f + g);
        h = u64(h - d);
        e = u64(e ^ u64(g << 14n));
        g = u64(g + h);
        return [a, b, c, d, e, f, g, h];
      }
      randinit(flag) {
        let a = 0x9e3779b97f4a7c13n;
        let b = a;
        let c = a;
        let d = a;
        let e = a;
        let f = a;
        let g = a;
        let h = a;
        for (let index = 0; index < 4; index += 1) {
          [a, b, c, d, e, f, g, h] = this.mix(a, b, c, d, e, f, g, h);
        }
        for (let index = 0; index < 256; index += 8) {
          if (flag) {
            a = u64(a + this.randrsl[index]);
            b = u64(b + this.randrsl[index + 1]);
            c = u64(c + this.randrsl[index + 2]);
            d = u64(d + this.randrsl[index + 3]);
            e = u64(e + this.randrsl[index + 4]);
            f = u64(f + this.randrsl[index + 5]);
            g = u64(g + this.randrsl[index + 6]);
            h = u64(h + this.randrsl[index + 7]);
          }
          [a, b, c, d, e, f, g, h] = this.mix(a, b, c, d, e, f, g, h);
          this.mm[index] = a;
          this.mm[index + 1] = b;
          this.mm[index + 2] = c;
          this.mm[index + 3] = d;
          this.mm[index + 4] = e;
          this.mm[index + 5] = f;
          this.mm[index + 6] = g;
          this.mm[index + 7] = h;
        }
        if (flag) {
          for (let index = 0; index < 256; index += 8) {
            a = u64(a + this.mm[index]);
            b = u64(b + this.mm[index + 1]);
            c = u64(c + this.mm[index + 2]);
            d = u64(d + this.mm[index + 3]);
            e = u64(e + this.mm[index + 4]);
            f = u64(f + this.mm[index + 5]);
            g = u64(g + this.mm[index + 6]);
            h = u64(h + this.mm[index + 7]);
            [a, b, c, d, e, f, g, h] = this.mix(a, b, c, d, e, f, g, h);
            this.mm[index] = a;
            this.mm[index + 1] = b;
            this.mm[index + 2] = c;
            this.mm[index + 3] = d;
            this.mm[index + 4] = e;
            this.mm[index + 5] = f;
            this.mm[index + 6] = g;
            this.mm[index + 7] = h;
          }
        }
        this.isaac64();
        this.randcnt = 256;
      }
      isaac64() {
        this.cc = u64(this.cc + 1n);
        this.bb = u64(this.bb + this.cc);
        for (let index = 0; index < 256; index += 1) {
          const x = this.mm[index];
          switch (index % 4) {
            case 0:
              this.aa = u64(~u64(this.aa ^ u64(this.aa << 21n)));
              break;
            case 1:
              this.aa = u64(this.aa ^ this.aa >> 5n);
              break;
            case 2:
              this.aa = u64(this.aa ^ u64(this.aa << 12n));
              break;
            default:
              this.aa = u64(this.aa ^ this.aa >> 33n);
              break;
          }
          this.aa = u64(this.aa + this.mm[(index + 128) % 256]);
          const y = u64(this.mm[Number(x >> 3n & 255n)] + this.aa + this.bb);
          this.mm[index] = y;
          this.bb = u64(this.mm[Number(y >> 11n & 255n)] + x);
          this.randrsl[index] = this.bb;
        }
      }
      next() {
        if (this.randcnt === 0) {
          this.isaac64();
          this.randcnt = 256;
        }
        this.randcnt -= 1;
        return this.randrsl[this.randcnt];
      }
      generate(length) {
        const result = Buffer.alloc(Math.max(0, Number(length) || 0));
        let position = 0;
        while (position < result.length) {
          const value = this.next();
          for (let shift = 56; shift >= 0 && position < result.length; shift -= 8) {
            result[position] = Number(value >> BigInt(shift) & 0xffn);
            position += 1;
          }
        }
        return result;
      }
    };
    __name(_Isaac64, "Isaac64");
    var Isaac64 = _Isaac64;
    function parseWechatChannelsDecryptKey(decryptKey) {
      const value = String(decryptKey || "").trim();
      if (!value) return null;
      try {
        if (/^0x[0-9a-f]+$/i.test(value) || /^\d+$/.test(value)) {
          return u64(BigInt(value));
        }
      } catch (error) {
        return null;
      }
      return null;
    }
    __name(parseWechatChannelsDecryptKey, "parseWechatChannelsDecryptKey");
    function generateWechatChannelsDecryptorBytes2(decryptKey, length) {
      const seed = parseWechatChannelsDecryptKey(decryptKey);
      if (seed === null) return Buffer.alloc(0);
      return new Isaac64(seed).generate(length);
    }
    __name(generateWechatChannelsDecryptorBytes2, "generateWechatChannelsDecryptorBytes");
    function decryptWechatChannelsMediaBuffer2(buffer, decryptKey, limit = WECHAT_CHANNELS_ENCRYPTED_HEAD_BYTES) {
      const input = Buffer.from(buffer || []);
      const seed = parseWechatChannelsDecryptKey(decryptKey);
      if (seed === null || !input.length) return input;
      const result = Buffer.from(input);
      const decryptLength = Math.min(result.length, Math.max(0, Number(limit) || 0));
      const keyBytes = new Isaac64(seed).generate(decryptLength);
      for (let index = 0; index < decryptLength; index += 1) {
        result[index] ^= keyBytes[index];
      }
      return result;
    }
    __name(decryptWechatChannelsMediaBuffer2, "decryptWechatChannelsMediaBuffer");
    module2.exports = {
      generateWechatChannelsDecryptorBytes: generateWechatChannelsDecryptorBytes2,
      decryptWechatChannelsMediaBuffer: decryptWechatChannelsMediaBuffer2
    };
  }
});

// src/feishu-markdown-utils.js
var require_feishu_markdown_utils = __commonJS({
  "src/feishu-markdown-utils.js"(exports2, module2) {
    function stripMarkdownCodeBlocks2(markdown) {
      return String(markdown || "").replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]+`/g, " ");
    }
    __name(stripMarkdownCodeBlocks2, "stripMarkdownCodeBlocks");
    function normalizeTitleForCompare2(text) {
      return String(text || "").replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "").replace(/[-–—]\s*飞书云文档\s*$/i, "").replace(/^#+\s*/, "").replace(/\*\*/g, "").replace(/\s+/g, "").trim();
    }
    __name(normalizeTitleForCompare2, "normalizeTitleForCompare");
    function normalizeFeishuMarkdownLine2(line) {
      return String(line || "").replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "").replace(/^-\s*$/, "").replace(/^-\s+/, "- ").replace(/^Plain Text复制$/i, "").replace(/^代码块$/i, "").trim();
    }
    __name(normalizeFeishuMarkdownLine2, "normalizeFeishuMarkdownLine");
    function shouldDropFeishuLine2(line, title) {
      const text = String(line || "").trim();
      if (!text) return true;
      const plainText = text.replace(/^#{1,6}\s+/, "").replace(/^[-*]\s+/, "").trim();
      const normalized = normalizeTitleForCompare2(text);
      const normalizedTitle = normalizeTitleForCompare2(title);
      const noise = /* @__PURE__ */ new Set([
        "飞书云文档",
        "与我分享",
        "登录/注册",
        "帮助中心",
        "效率指南",
        "添加快捷方式",
        "最近修改",
        "搜索",
        "墨度",
        "莞尔",
        "分享",
        "回复...",
        "附件不支持打印",
        "上传日志",
        "联系客服",
        "功能更新",
        "header-v2",
        "评论（0）",
        "跳转至首条评论",
        "Plain Text",
        "Plain Text复制",
        "复制",
        "Bash",
        "重播",
        "播放",
        "直播",
        "进入全屏",
        "画中画",
        "原画",
        "点击按住可拖动视频",
        "星辰大海",
        "蟹",
        "蟹老板-老王1",
        "正在以画中画形式播放",
        "语句划分",
        "音频时长核定",
        "画面规划",
        "画面代码审查",
        "多AIAGENT优化",
        "人点赞"
      ]);
      if (noise.has(text) || noise.has(plainText)) return true;
      if (/^\d{1,3}%$/.test(plainText)) return true;
      if (/^\d+(?:\.\d+)?\s*(?:KB|MB|GB)$/i.test(plainText)) return true;
      if (/^(?:-\s*)?\d{3,4}p$/i.test(plainText)) return true;
      if (/^(?:-\s*)?\d+(?:\.\d+)?x$/i.test(plainText)) return true;
      if (/^\d{1,2}月\d{1,2}日修改$/.test(plainText)) return true;
      if (/^(?:\d{1,2}:\d{2}|\/|[0-9]+(?:\.[0-9]+)?x)$/.test(plainText)) return true;
      if (/^\S{1,30}的云文档$/.test(plainText)) return true;
      if (/^[\u{1F300}-\u{1FAFF}\u2600-\u27BF]+$/u.test(plainText)) return true;
      if (normalizedTitle && normalized.includes(normalizedTitle) && normalized !== normalizedTitle && normalized.length <= normalizedTitle.length + 24) return true;
      if (/添加快捷方式\s*最近修改\s*[:：]?/.test(text)) return true;
      if (/^最近修改\s*[:：]?/.test(text)) return true;
      if (/^你可能还想问/.test(text)) return true;
      if (/^查询.*更多相关内容$/.test(text)) return true;
      if (/^推荐内容由\s*AI\s*生成$/i.test(text)) return true;
      if (/^加载中/.test(text)) return true;
      if (/^本文暂未(?:引用|被).*文档/.test(text)) return true;
      if (/^取消发送$/.test(text)) return true;
      if (/^\d+\s*人点赞$/.test(text)) return true;
      if (/^-\s+.+\s-\s+.+/.test(text) && text.length > 40) return true;
      if (/^-\s*(?:上传日志|联系客服|功能更新|帮助中心|效率指南)$/.test(text)) return true;
      if (/^-\s*(?:第[一二三四五六七八九十\d]+(?:次|个)?风口|规律：|什么是|举个例子|知识付费|最后|第[一二三四五六七八九十\d]+[步层：])/.test(text)) return true;
      if (/^图\s*\d+$/i.test(text)) return true;
      if (/^\d{1,2}$/.test(text)) return true;
      if (/^\+\d+$/.test(text)) return true;
      if (/^共有\s*\d+\s*个协作者$/.test(text)) return true;
      if (/^最近修改\s*[:：]?\s*/.test(text)) return true;
      if (/^昨天\s*\d{1,2}:\d{2}$/.test(text)) return true;
      if (/^\d{4}[-/年]\d{1,2}[-/月]\d{1,2}/.test(text)) return true;
      if (/^最新修改时间为/.test(text)) return true;
      if (/^\d+\s*字$/.test(text)) return true;
      if (/^评论/.test(text)) return true;
      if (/^[春壹始]$/.test(text)) return true;
      if (/^[\u4e00-\u9fa5]{1,4}$/.test(text) && /(?:斤|斧|淇|钖|作者|头像)/.test(text)) return true;
      if (/成长笔记(?:昨天\s*\d{1,2}:\d{2})?$/.test(text)) return true;
      if (/^春树.*云文档$/.test(text)) return true;
      if (normalizedTitle && normalized === normalizedTitle) return true;
      return false;
    }
    __name(shouldDropFeishuLine2, "shouldDropFeishuLine");
    function formatFeishuHeadingLine2(line) {
      const text = String(line || "").trim();
      if (/^#\s+(?:创建项目|或者克隆|应输出)/.test(text)) return `\\${text}`;
      if (/^#{1,6}\s+/.test(text) || /^!\[/.test(text) || /^[-*]\s+/.test(text) || /^\d+\.\s+/.test(text)) {
        return text;
      }
      const numericSection = text.match(/^(\d+)\.(\d{1,3})(.+)$/);
      if (numericSection && Number(numericSection[1]) <= 6 && !/^(?:[+]|MB|GB|KB|（推荐|推荐)/i.test(numericSection[3].trim())) {
        return numericSection[2].length >= 2 ? `### ${text}` : `## ${text}`;
      }
      const length = Array.from(text).length;
      if (length >= 4 && length <= 34) {
        if (/^[一二三四五六七八九十]+[、.．]\s*.+/.test(text)) return `# ${text}`;
        if (/^[（(]\d+[）)]\s*.+/.test(text)) return `### ${text}`;
        if (/^\d{4}年之前，我没有任何目标$/.test(text)) return `## ${text}`;
        if (/^(第[一二三四五六七八九十\d]+[、.．]?\s*)?[^，。！？!?]{0,16}风口[：:]/.test(text)) return `## ${text}`;
        if (/^(什么是.+原理|举个例子|最后|知识付费的下一个形态)$/.test(text)) return `## ${text}`;
        if (/^第[一二三四五六七八九十\d]+[步层：:]/.test(text)) return `### ${text}`;
      }
      return text;
    }
    __name(formatFeishuHeadingLine2, "formatFeishuHeadingLine");
    function isFeishuTocBulletLine(line) {
      const text = String(line || "").trim().replace(/^[-*]\s+/, "");
      return /^[一二三四五六七八九十]+[、.．]/.test(text) || /^\d+\.\d/.test(text) || /^[（(]\d+[）)]/.test(text) || /^第[一二三四五六七八九十\d]+[步层：:]/.test(text) || /^.+(?:成果|经验|收获|流程|配置|安装|教学|优化|什么|想法|视频|画面|审查|制作|下一步).*$/.test(text);
    }
    __name(isFeishuTocBulletLine, "isFeishuTocBulletLine");
    function removeFeishuTocBlocks(lines) {
      const output = [];
      for (let index = 0; index < lines.length; index += 1) {
        const line = String(lines[index] || "");
        if (!/^[-*]\s+/.test(line.trim())) {
          output.push(line);
          continue;
        }
        const block = [];
        let cursor = index;
        while (cursor < lines.length && /^[-*]\s+/.test(String(lines[cursor] || "").trim())) {
          block.push(String(lines[cursor] || ""));
          cursor += 1;
        }
        const tocCount = block.filter(isFeishuTocBulletLine).length;
        if (block.length >= 4 && tocCount >= Math.ceil(block.length * 0.65)) {
          index = cursor - 1;
          continue;
        }
        output.push(...block);
        index = cursor - 1;
      }
      return output;
    }
    __name(removeFeishuTocBlocks, "removeFeishuTocBlocks");
    function repairFeishuMarkdownTables(markdown) {
      const lines = String(markdown || "").split(/\r?\n/);
      const output = [];
      for (let index = 0; index < lines.length; index += 1) {
        const current = String(lines[index] || "").trim();
        if (current === "|") continue;
        const nextNonBlank = [];
        let scan = index;
        while (scan < lines.length && nextNonBlank.length < 8) {
          const value = String(lines[scan] || "").trim();
          if (value && value !== "|") nextNonBlank.push({ value, index: scan });
          scan += 1;
        }
        let headers = null;
        let separatorPattern = null;
        if (current === "组件" && nextNonBlank.some((item) => item.value === "要求") && nextNonBlank.some((item) => item.value === "说明")) {
          headers = ["组件", "要求", "说明"];
          separatorPattern = /^\|\s*---\s*\|\s*---\s*\|\s*---\s*\|$/;
        } else if (current === "序号" && nextNonBlank.some((item) => item.value === "版本") && nextNonBlank.some((item) => item.value === "用途") && nextNonBlank.some((item) => item.value === "是否必须")) {
          headers = ["序号", "版本", "用途", "是否必须"];
          separatorPattern = /^\|\s*---\s*\|\s*---\s*\|\s*---\s*\|\s*---\s*(?:\|\s*---\s*)?\|$/;
        }
        if (!headers || !nextNonBlank.some((item) => separatorPattern.test(item.value))) {
          output.push(lines[index]);
          continue;
        }
        const separator = nextNonBlank.find((item) => separatorPattern.test(item.value));
        const cells = [];
        let cursor = separator.index + 1;
        while (cursor < lines.length) {
          const value = String(lines[cursor] || "").trim();
          if (!value) {
            cursor += 1;
            continue;
          }
          if (value === "|" || /^#{1,6}\s+/.test(value) || /^!\[/.test(value) || /^\[[^\]]+]\(/.test(value)) break;
          if (headers.includes(value) && cells.length) break;
          if (shouldDropFeishuLine2(value, "")) {
            cursor += 1;
            continue;
          }
          cells.push(value.replace(/\|/g, "\\|"));
          cursor += 1;
          if (cells.length >= 30) break;
        }
        const rows = [];
        for (let cellIndex = 0; cellIndex + headers.length - 1 < cells.length; cellIndex += headers.length) {
          rows.push(cells.slice(cellIndex, cellIndex + headers.length));
        }
        if (rows.length) {
          output.push(`| ${headers.join(" | ")} |`);
          output.push(`| ${headers.map(() => "---").join(" | ")} |`);
          rows.forEach((row) => output.push(`| ${row.join(" | ")} |`));
          index = Math.max(index, cursor - 1);
          continue;
        }
        output.push(lines[index]);
      }
      return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    }
    __name(repairFeishuMarkdownTables, "repairFeishuMarkdownTables");
    function removeFeishuResidualTableLines(markdown) {
      const residue = /* @__PURE__ */ new Set(["组件", "要求", "说明", "CPU", "内存", "硬盘", "序号", "版本", "用途", "是否必须"]);
      const lines = String(markdown || "").split(/\r?\n/);
      const output = [];
      let recentlySawTable = 0;
      lines.forEach((line) => {
        const text = String(line || "").trim();
        if (/^\|.+\|$/.test(text)) {
          recentlySawTable = 8;
          output.push(line);
          return;
        }
        if (recentlySawTable > 0 && residue.has(text)) {
          recentlySawTable -= 1;
          return;
        }
        if (recentlySawTable > 0) recentlySawTable -= 1;
        output.push(line);
      });
      return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    }
    __name(removeFeishuResidualTableLines, "removeFeishuResidualTableLines");
    function isFeishuCodeLanguageLine2(line) {
      return /^(?:Bash|Shell|PowerShell|JavaScript|TypeScript|Python|JSON|YAML|HTML|CSS)$/i.test(String(line || "").trim());
    }
    __name(isFeishuCodeLanguageLine2, "isFeishuCodeLanguageLine");
    function isFeishuCommandLikeLine(line) {
      const text = String(line || "").trim();
      if (!text) return false;
      if (/^#\s+/.test(text)) return true;
      if (/^\\#\s+/.test(text)) return true;
      if (/^(?:npx|npm|pnpm|yarn|node|python|pip|conda|ffmpeg|git|cd|mkdir|curl|brew|uv|powershell|pwsh|setx|export)\b/i.test(text)) return true;
      if (/^(?:[A-Za-z]:\\|\.\/|\.\.\/|~\/)/.test(text)) return true;
      if (/^[A-Z_][A-Z0-9_]*=/.test(text)) return true;
      return false;
    }
    __name(isFeishuCommandLikeLine, "isFeishuCommandLikeLine");
    function isFeishuNarrativeAfterCode(line) {
      const text = String(line || "").trim();
      if (!text) return true;
      if (/^#{1,6}\s+/.test(text) || /^[-*]\s+/.test(text) || /^\d+\.\s+/.test(text) || /^\|.+\|$/.test(text)) return true;
      return /[。！？；：]$/.test(text) || /^[\u4e00-\u9fa5].{4,}$/.test(text);
    }
    __name(isFeishuNarrativeAfterCode, "isFeishuNarrativeAfterCode");
    function formatFeishuCodeBlocks(markdown) {
      const lines = String(markdown || "").split(/\r?\n/);
      const output = [];
      for (let index = 0; index < lines.length; index += 1) {
        const current = String(lines[index] || "").trim();
        if (!isFeishuCodeLanguageLine2(current)) {
          output.push(lines[index]);
          continue;
        }
        const language = current.toLowerCase() === "bash" || current.toLowerCase() === "shell" ? "bash" : current.toLowerCase();
        const codeLines = [];
        let cursor = index + 1;
        while (cursor < lines.length) {
          const value = String(lines[cursor] || "").trim();
          if (!value) {
            cursor += 1;
            continue;
          }
          if (isFeishuCodeLanguageLine2(value) || /^```/.test(value) || /^#{1,6}\s+/.test(value) || /^\|.+\|$/.test(value)) break;
          if (isFeishuCommandLikeLine(value)) {
            codeLines.push(value.replace(/^\\#/, "#"));
            cursor += 1;
            continue;
          }
          if (codeLines.length && isFeishuNarrativeAfterCode(value)) break;
          if (!codeLines.length) break;
          codeLines.push(value.replace(/^\\#/, "#"));
          cursor += 1;
        }
        if (!codeLines.length) {
          output.push(lines[index]);
          continue;
        }
        if (output.length && String(output[output.length - 1] || "").trim()) output.push("");
        output.push(`\`\`\`${language}`);
        output.push(...codeLines);
        output.push("```");
        output.push("");
        index = cursor - 1;
      }
      return output.join("\n").replace(/\n{3,}/g, "\n\n").trim();
    }
    __name(formatFeishuCodeBlocks, "formatFeishuCodeBlocks");
    function isFeishuRecommendationTitleLine(line) {
      const text = String(line || "").trim();
      if (!text || /^#{1,6}\s+/.test(text) || /^[-*]\s+/.test(text) || /^\|.+\|$/.test(text) || /^!\[/.test(text) || /^\[[^\]]+]\(/.test(text)) return false;
      if (text.length < 8 || text.length > 80) return false;
      if (/[。！？；：]$/.test(text)) return false;
      return /(?:REMOTION|Remotion|AI|Agent|Hermes|Qwen|TTS|部署|教程|经验|分享|方法|踩坑|实操|策略|指南)/i.test(text);
    }
    __name(isFeishuRecommendationTitleLine, "isFeishuRecommendationTitleLine");
    function trimFeishuTrailingRecommendations(lines) {
      const source = Array.isArray(lines) ? lines.slice() : [];
      let lastContentIndex = source.length - 1;
      while (lastContentIndex >= 0 && !String(source[lastContentIndex] || "").trim()) lastContentIndex -= 1;
      if (lastContentIndex < 0) return source;
      let start = lastContentIndex;
      while (start >= 0 && isFeishuRecommendationTitleLine(source[start])) start -= 1;
      const count = lastContentIndex - start;
      if (count >= 3) return source.slice(0, start + 1);
      return source;
    }
    __name(trimFeishuTrailingRecommendations, "trimFeishuTrailingRecommendations");
    function hasFeishuDanglingTableTail(lines) {
      const source = (Array.isArray(lines) ? lines : []).map((line) => String(line || "").trim()).filter(Boolean);
      if (source.length < 10) return false;
      const joined = source.join("\n");
      if (!/(?:安装清单总览|逐步安装指南|配置要求|以下是所有需要安装的软件和工具)/.test(joined)) return false;
      const tail = source.slice(-18);
      const shortFragmentCount = tail.filter((line) => {
        if (/^#{1,6}\s+/.test(line) || /^[-*]\s+/.test(line) || /^!\[/.test(line)) return false;
        if (/[。！？；：]$/.test(line)) return false;
        return line.length <= 28;
      }).length;
      const toolFragmentCount = tail.filter((line) => /^(?:Node\.js|npm|FFmpeg|Python|Conda|CUDA Toolkit|Remotion|v?\d|必须|推荐|用途|版本|序号|是否必须)/i.test(line)).length;
      return shortFragmentCount >= 8 && toolFragmentCount >= 4;
    }
    __name(hasFeishuDanglingTableTail, "hasFeishuDanglingTableTail");
    function isFeishuMarkdownLikelyTruncated2(markdown) {
      const lines = String(markdown || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const trimmed = trimFeishuTrailingRecommendations(lines);
      if (trimmed.length <= lines.length - 3) return true;
      if (hasFeishuDanglingTableTail(lines)) return true;
      if (lines.length < 20) return false;
      const lastHeadingIndex = lines.map((line, index) => /^#{1,6}\s+/.test(line) ? index : -1).filter((index) => index >= 0).pop() ?? -1;
      const tail = lines.slice(Math.max(0, lines.length - 12));
      return lastHeadingIndex >= 0 && lines.length - lastHeadingIndex < 12 && tail.filter(isFeishuRecommendationTitleLine).length >= 3;
    }
    __name(isFeishuMarkdownLikelyTruncated2, "isFeishuMarkdownLikelyTruncated");
    function postProcessFeishuMarkdown2(markdown, title = "") {
      let lines = String(markdown || "").split(/\r?\n/).map((line) => String(line || "").trim()).filter((line) => line && (!shouldDropFeishuLine2(line, title) || isFeishuCodeLanguageLine2(line)));
      const commentsIndex = lines.findIndex((line) => /^(?:真诚点赞，手留余香|全文评论)$/.test(line));
      if (commentsIndex >= 0) {
        lines = lines.slice(0, commentsIndex);
      }
      lines = removeFeishuTocBlocks(lines);
      lines = lines.map((line) => {
        if (/^[-*]\s+读完这篇/.test(line)) return line.replace(/^[-*]\s+/, "# ");
        if (/^[-*]\s+/.test(line) && isFeishuTocBulletLine(line)) return "";
        return formatFeishuHeadingLine2(line);
      }).filter(Boolean);
      lines = trimFeishuTrailingRecommendations(lines);
      return formatFeishuCodeBlocks(removeFeishuResidualTableLines(repairFeishuMarkdownTables(lines.join("\n")))).replace(/\n{3,}/g, "\n\n").trim();
    }
    __name(postProcessFeishuMarkdown2, "postProcessFeishuMarkdown");
    module2.exports = {
      stripMarkdownCodeBlocks: stripMarkdownCodeBlocks2,
      normalizeTitleForCompare: normalizeTitleForCompare2,
      normalizeFeishuMarkdownLine: normalizeFeishuMarkdownLine2,
      shouldDropFeishuLine: shouldDropFeishuLine2,
      formatFeishuHeadingLine: formatFeishuHeadingLine2,
      isFeishuCodeLanguageLine: isFeishuCodeLanguageLine2,
      postProcessFeishuMarkdown: postProcessFeishuMarkdown2,
      isFeishuMarkdownLikelyTruncated: isFeishuMarkdownLikelyTruncated2
    };
  }
});

// src/progress-notice-utils.js
var require_progress_notice_utils = __commonJS({
  "src/progress-notice-utils.js"(exports2, module2) {
    "use strict";
    function buildSyncNotice2(count) {
      return count ? `已同步 ${count} 条内容到 Obsidian` : "没有需要同步的新内容";
    }
    __name(buildSyncNotice2, "buildSyncNotice");
    function buildSyncResultNotice2(written = [], skipped = [], conversionWarnings = [], failed = []) {
      const writtenCount = Array.isArray(written) ? written.length : 0;
      const failedItems = Array.isArray(failed) ? failed : [];
      let message = !writtenCount && failedItems.length ? `同步失败：${failedItems.length} 条内容未同步：${failedItems[0].message}` : buildSyncNotice2(writtenCount);
      if (Array.isArray(skipped) && skipped.length) {
        message += buildSkippedSyncNotice2(skipped);
      }
      message += buildConversionWarningsNotice2(
        Array.isArray(conversionWarnings) ? conversionWarnings : []
      );
      if (writtenCount && failedItems.length) {
        message += `，${failedItems.length} 条失败：${failedItems[0].message}`;
      }
      return message;
    }
    __name(buildSyncResultNotice2, "buildSyncResultNotice");
    function buildSkippedSyncNotice2(skipped = []) {
      const cloudProcessingCount = skipped.filter((item) => item && item.reason === "cloud-transcription-processing").length;
      const locallyQuarantinedCount = skipped.filter((item) => item && item.reason === "locally-quarantined-unrecoverable").length;
      const deletedExpiredXiaohongshuCount = skipped.filter((item) => item && item.reason === "deleted-expired-xhs-shortlink").length;
      const otherSkippedCount = skipped.filter((item) => item && item.reason !== "already-synced-local" && item.reason !== "cloud-transcription-processing" && item.reason !== "locally-quarantined-unrecoverable" && item.reason !== "deleted-expired-xhs-shortlink").length;
      const parts = [];
      if (cloudProcessingCount) {
        parts.push(`${cloudProcessingCount} 条云端转写中，完成后再同步`);
      }
      if (locallyQuarantinedCount) {
        parts.push(`${locallyQuarantinedCount} 条历史失效内容已在本机忽略`);
      }
      if (deletedExpiredXiaohongshuCount) {
        parts.push(`${deletedExpiredXiaohongshuCount} 条原小红书临时链接已失效，已生成失效说明文件并删除云端旧记录；请重新复制原笔记链接后再保存`);
      }
      if (otherSkippedCount) {
        parts.push(`${otherSkippedCount} 条已跳过`);
      }
      return parts.length ? `，${parts.join("，")}` : "";
    }
    __name(buildSkippedSyncNotice2, "buildSkippedSyncNotice");
    function normalizeProgressPercent2(value) {
      const number = Number(value);
      if (!Number.isFinite(number)) return null;
      return Math.max(0, Math.min(100, Math.floor(number)));
    }
    __name(normalizeProgressPercent2, "normalizeProgressPercent");
    function parseLocalAsrProgressLog2(text) {
      const source = String(text || "");
      const values = {};
      source.split(/\r?\n/).forEach((line) => {
        const match = /^([A-Za-z][A-Za-z0-9_]*)=(.*)$/.exec(String(line || "").trim());
        if (match) values[match[1]] = match[2];
      });
      if (!Object.prototype.hasOwnProperty.call(values, "progressStage") && !Object.prototype.hasOwnProperty.call(values, "progressCurrent") && !Object.prototype.hasOwnProperty.call(values, "progressTotal") && !Object.prototype.hasOwnProperty.call(values, "progressPercent")) {
        return null;
      }
      const current = Number(values.progressCurrent);
      const total = Number(values.progressTotal);
      let percent = normalizeProgressPercent2(values.progressPercent);
      if (percent === null && Number.isFinite(current) && Number.isFinite(total) && total > 0) {
        percent = normalizeProgressPercent2(current * 100 / total);
      }
      if (percent === null) percent = 0;
      return {
        stage: values.progressStage || "",
        current: Number.isFinite(current) ? current : 0,
        total: Number.isFinite(total) ? total : 0,
        percent,
        startedAt: String(values.progressStartedAt || "").trim(),
        heartbeatAt: String(values.progressHeartbeatAt || "").trim(),
        pid: Number.isFinite(Number(values.progressPid)) ? Number(values.progressPid) : 0
      };
    }
    __name(parseLocalAsrProgressLog2, "parseLocalAsrProgressLog");
    function formatProgressElapsed2(startedAt, now = Date.now()) {
      const started = new Date(startedAt || "").getTime();
      if (!Number.isFinite(started) || started <= 0 || !Number.isFinite(now) || now < started) return "";
      return `${Math.max(0, Math.floor((now - started) / 1e3))} 秒`;
    }
    __name(formatProgressElapsed2, "formatProgressElapsed");
    function isProgressHeartbeatStale2(heartbeatAt, now = Date.now(), thresholdMs = 20 * 1e3) {
      const heartbeat = new Date(heartbeatAt || "").getTime();
      return Number.isFinite(heartbeat) && heartbeat > 0 && Number.isFinite(now) && now - heartbeat > thresholdMs;
    }
    __name(isProgressHeartbeatStale2, "isProgressHeartbeatStale");
    function buildLocalAsrProgressKey2(progress = {}, now = Date.now()) {
      const heartbeatState = isProgressHeartbeatStale2(progress.heartbeatAt, now) ? "stale" : "fresh";
      return `${progress.stage || ""}|${Number(progress.current) || 0}|${Number(progress.total) || 0}|${Number(progress.percent) || 0}|${progress.heartbeatAt || ""}|${heartbeatState}`;
    }
    __name(buildLocalAsrProgressKey2, "buildLocalAsrProgressKey");
    function buildSyncProgressMessage2({
      bindingLabel = "",
      stage = "",
      current = 0,
      total = 0,
      title = "",
      percent = null,
      localProgressStage = "",
      localProgressCurrent = 0,
      localProgressTotal = 0,
      localProgressStartedAt = "",
      localProgressHeartbeatAt = "",
      now = Date.now()
    } = {}) {
      const label = bindingLabel ? `${bindingLabel}：` : "";
      const countText = total ? `${current}/${total}` : "";
      const normalizedPercent = normalizeProgressPercent2(percent);
      const percentText = normalizedPercent === null ? "" : ` (${normalizedPercent}%)`;
      const suffix = title ? `：${title}` : "";
      if (stage === "fetching") return `${label}正在同步，正在获取待同步内容`;
      if (stage === "empty") return `${label}没有需要同步的新内容`;
      if (stage === "processing") return `${label}正在处理 ${countText}${suffix}`;
      if (stage === "downloading") return `${label}正在下载附件 ${countText}${percentText}${suffix}`;
      if (stage === "transcribing") {
        if (isProgressHeartbeatStale2(localProgressHeartbeatAt, now)) {
          return `${label}本地转写任务可能无响应，可暂停后重试${suffix}`;
        }
        const elapsed = formatProgressElapsed2(localProgressStartedAt, now);
        const elapsedText = elapsed ? `，已运行 ${elapsed}` : "";
        if (localProgressStage === "preparing" || localProgressStage === "segmenting") {
          return `${label}正在准备音频${elapsedText}${suffix}`;
        }
        if (localProgressStage === "transcribing" && Number(localProgressTotal) > 0 && Number(localProgressCurrent) <= 0) {
          return `${label}正在转写第 1/${localProgressTotal} 段${elapsedText}${suffix}`;
        }
        if (localProgressStage === "transcribing" && Number(localProgressTotal) > 0) {
          return `${label}正在转写第 ${Math.min(Number(localProgressCurrent) + 1, Number(localProgressTotal))}/${localProgressTotal} 段${elapsedText}${suffix}`;
        }
        return `${label}正在转写音视频 ${countText}${percentText}${elapsedText}${suffix}`;
      }
      if (stage === "writing") return `${label}正在写入 Obsidian ${countText}${suffix}`;
      if (stage === "marking") return `${label}正在更新同步状态 ${countText}${suffix}`;
      return `${label}正在同步${countText ? ` ${countText}` : ""}${suffix}`;
    }
    __name(buildSyncProgressMessage2, "buildSyncProgressMessage");
    function buildConversionWarningsNotice2(warnings = []) {
      const normalized = (Array.isArray(warnings) ? warnings : []).map((item) => String(item || "").trim()).filter(Boolean);
      if (!normalized.length) return "";
      return `，${normalized.length} 条内容处理不完整：${normalized[0]}`;
    }
    __name(buildConversionWarningsNotice2, "buildConversionWarningsNotice");
    module2.exports = {
      buildConversionWarningsNotice: buildConversionWarningsNotice2,
      buildLocalAsrProgressKey: buildLocalAsrProgressKey2,
      buildSkippedSyncNotice: buildSkippedSyncNotice2,
      buildSyncNotice: buildSyncNotice2,
      buildSyncProgressMessage: buildSyncProgressMessage2,
      buildSyncResultNotice: buildSyncResultNotice2,
      formatProgressElapsed: formatProgressElapsed2,
      isProgressHeartbeatStale: isProgressHeartbeatStale2,
      normalizeProgressPercent: normalizeProgressPercent2,
      parseLocalAsrProgressLog: parseLocalAsrProgressLog2
    };
  }
});

// src/ai-metadata-error-utils.js
var require_ai_metadata_error_utils = __commonJS({
  "src/ai-metadata-error-utils.js"(exports2, module2) {
    "use strict";
    function classifyAiMetadataError2(error) {
      const responseStatus = Number(error && error.response && error.response.status);
      if (responseStatus === 429) return "rate-limited";
      if (responseStatus >= 500 && responseStatus <= 599) return "upstream-service-error";
      const raw = error && typeof error === "object" ? [error.code, error.message].filter(Boolean).join(" ") : String(error || "");
      const normalized = raw.toLowerCase();
      if ([
        "rate-limited",
        "upstream-service-error",
        "request-timeout",
        "empty-response",
        "service-error"
      ].includes(normalized)) {
        return normalized;
      }
      if (/\b429\b|too many requests|rate[-_\s]?limit/.test(normalized)) {
        return "rate-limited";
      }
      if (/\b5\d\d\b|bad gateway|service unavailable|upstream/.test(normalized)) {
        return "upstream-service-error";
      }
      if (/timed?\s*out|timeout|etimedout|econnaborted/.test(normalized)) {
        return "request-timeout";
      }
      if (/empty|no usable|没有返回可用/.test(normalized)) {
        return "empty-response";
      }
      return "service-error";
    }
    __name(classifyAiMetadataError2, "classifyAiMetadataError");
    function buildAiMetadataErrorComment2(error) {
      return `<!-- wechat-inbox-ai-metadata-error: ${classifyAiMetadataError2(error)} -->`;
    }
    __name(buildAiMetadataErrorComment2, "buildAiMetadataErrorComment");
    function buildAiMetadataConversionWarning2(error) {
      const detail = {
        "rate-limited": "请求过于频繁",
        "upstream-service-error": "AI 服务暂时异常",
        "request-timeout": "AI 请求超时",
        "empty-response": "AI 未返回可用结果",
        "service-error": "AI 服务暂时不可用"
      }[classifyAiMetadataError2(error)];
      return `正文已同步，但 AI 简介/关键词未生成（${detail}）。`;
    }
    __name(buildAiMetadataConversionWarning2, "buildAiMetadataConversionWarning");
    module2.exports = {
      buildAiMetadataConversionWarning: buildAiMetadataConversionWarning2,
      buildAiMetadataErrorComment: buildAiMetadataErrorComment2,
      classifyAiMetadataError: classifyAiMetadataError2
    };
  }
});

// src/diagnostic-redaction-utils.js
var require_diagnostic_redaction_utils = __commonJS({
  "src/diagnostic-redaction-utils.js"(exports2, module2) {
    "use strict";
    function redactSensitiveObject2(value, key = "") {
      if (/token|code|secret|authorization|cookie/i.test(String(key || ""))) return "[REDACTED]";
      if (Array.isArray(value)) return value.map((item) => redactSensitiveObject2(item));
      if (value && typeof value === "object") {
        return Object.fromEntries(
          Object.entries(value).map(([entryKey, entryValue]) => [
            entryKey,
            redactSensitiveObject2(entryValue, entryKey)
          ])
        );
      }
      return value;
    }
    __name(redactSensitiveObject2, "redactSensitiveObject");
    function redactKnownCredentials2(text, settings = {}) {
      const entitlement = settings.localTranscriptionEntitlementStatus || {};
      const credentials = [
        settings.token,
        settings.pendingRedeemCode,
        entitlement.code,
        entitlement.bindingToken,
        ...Array.isArray(settings.bindings) ? settings.bindings.map((item) => item && item.token) : []
      ].map((item) => String(item || "").trim()).filter(Boolean).sort((a, b) => b.length - a.length);
      return credentials.reduce(
        (result, credential) => result.split(credential).join("[REDACTED]"),
        String(text || "")
      );
    }
    __name(redactKnownCredentials2, "redactKnownCredentials");
    module2.exports = {
      redactKnownCredentials: redactKnownCredentials2,
      redactSensitiveObject: redactSensitiveObject2
    };
  }
});

// src/vault-path-utils.js
var require_vault_path_utils = __commonJS({
  "src/vault-path-utils.js"(exports2, module2) {
    "use strict";
    var DEFAULT_VAULT_INBOX_DIR = "临时收集";
    function normalizeVaultPath2(value) {
      return String(value || "").replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+|\/+$/g, "");
    }
    __name(normalizeVaultPath2, "normalizeVaultPath");
    function normalizeConfiguredVaultPath2(value, fallback = DEFAULT_VAULT_INBOX_DIR) {
      const raw = String(value || "").trim();
      const safeFallback = normalizeVaultPath2(fallback) || DEFAULT_VAULT_INBOX_DIR;
      if (!raw) return safeFallback;
      if (/^[\\/]/.test(raw) || /^[a-z]:[\\/]/i.test(raw) || raw.includes("\0")) {
        return safeFallback;
      }
      const normalized = normalizeVaultPath2(raw);
      const segments = normalized.split("/");
      if (!normalized || segments.some((segment) => !segment || segment === "." || segment === "..")) {
        return safeFallback;
      }
      return normalized;
    }
    __name(normalizeConfiguredVaultPath2, "normalizeConfiguredVaultPath");
    function shouldPersistNormalizedInboxDir2(savedSettings, mergedSettings) {
      if (!savedSettings || typeof savedSettings !== "object") return true;
      const savedInboxDir = String(savedSettings.inboxDir || "").trim();
      const mergedInboxDir = String(mergedSettings && mergedSettings.inboxDir || "").trim();
      return savedInboxDir !== mergedInboxDir;
    }
    __name(shouldPersistNormalizedInboxDir2, "shouldPersistNormalizedInboxDir");
    module2.exports = {
      DEFAULT_VAULT_INBOX_DIR,
      normalizeConfiguredVaultPath: normalizeConfiguredVaultPath2,
      normalizeVaultPath: normalizeVaultPath2,
      shouldPersistNormalizedInboxDir: shouldPersistNormalizedInboxDir2
    };
  }
});

// src/input-normalization-utils.js
var require_input_normalization_utils = __commonJS({
  "src/input-normalization-utils.js"(exports2, module2) {
    "use strict";
    function normalizeNoteSaveMode2(value, noteSaveModes, defaultMode) {
      const normalized = String(value || "").trim();
      return Object.prototype.hasOwnProperty.call(noteSaveModes || {}, normalized) ? normalized : defaultMode;
    }
    __name(normalizeNoteSaveMode2, "normalizeNoteSaveMode");
    function normalizeNotePropertyFields2(value, notePropertyFieldKeys) {
      const allowedFields = Array.isArray(notePropertyFieldKeys) ? notePropertyFieldKeys : [];
      const seen = /* @__PURE__ */ new Set();
      return String(value || "").split(",").map((item) => item.trim()).filter((item) => {
        if (!allowedFields.includes(item) || seen.has(item)) return false;
        seen.add(item);
        return true;
      }).join(",");
    }
    __name(normalizeNotePropertyFields2, "normalizeNotePropertyFields");
    function normalizeBindCodeInput2(code) {
      const compact = String(code || "").trim().toUpperCase().replace(/[-\u2010-\u2015]/g, "-").replace(/[^A-Z0-9]/g, "");
      if (compact.length === 6) {
        return `${compact.slice(0, 3)}-${compact.slice(3)}`;
      }
      return String(code || "").trim().toUpperCase().replace(/[-\u2010-\u2015]/g, "-").replace(/\s+/g, "");
    }
    __name(normalizeBindCodeInput2, "normalizeBindCodeInput");
    module2.exports = {
      normalizeBindCodeInput: normalizeBindCodeInput2,
      normalizeNotePropertyFields: normalizeNotePropertyFields2,
      normalizeNoteSaveMode: normalizeNoteSaveMode2
    };
  }
});

// src/record-metadata-utils.js
var require_record_metadata_utils = __commonJS({
  "src/record-metadata-utils.js"(exports2, module2) {
    "use strict";
    function getRecordAuthor2(metadata = {}) {
      return metadata.author || metadata.accountName || metadata.nickname || metadata.nickName || metadata.sourceName || "";
    }
    __name(getRecordAuthor2, "getRecordAuthor");
    function getRecordDescription2(metadata = {}) {
      return metadata.description || metadata.summary || metadata.excerpt || metadata.abstract || "";
    }
    __name(getRecordDescription2, "getRecordDescription");
    function getRecordKeywords2(metadata = {}) {
      const value = metadata.keywords || metadata.tags || metadata.hashtags || [];
      if (Array.isArray(value)) return value;
      return String(value || "").split(/[,，、\s]+/).map((item) => item.trim()).filter(Boolean);
    }
    __name(getRecordKeywords2, "getRecordKeywords");
    function stripMarkdownForDescription2(markdown) {
      return String(markdown || "").split(/\r?\n/).filter((line) => !/^#{1,6}\s+/.test(String(line || "").trim())).join("\n").replace(/!\[[^\]]*]\([^)]+\)/g, "").replace(/\[\[([^\]]+)]]/g, "").replace(/^[-*]\s+/gm, "").replace(/^\|.*\|$/gm, "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
    }
    __name(stripMarkdownForDescription2, "stripMarkdownForDescription");
    function extractKeywordsFromText2(text, title = "") {
      const source = `${title || ""} ${text || ""}`;
      const keywords = [];
      const candidates = [
        "风口",
        "小红书",
        "AI",
        "知识库",
        "飞书",
        "复盘",
        "电商",
        "公众号",
        "流量",
        "创新",
        "创业"
      ];
      candidates.forEach((candidate) => {
        if (source.includes(candidate) && !keywords.includes(candidate)) keywords.push(candidate);
      });
      if (keywords.length) return keywords.slice(0, 8);
      return Array.from(new Set(String(source || "").match(/[\p{L}\p{N}]{2,12}/gu) || [])).slice(0, 6);
    }
    __name(extractKeywordsFromText2, "extractKeywordsFromText");
    function enrichExtractedWebpageMetadata2(metadata = {}) {
      const next = { ...metadata };
      const text = stripMarkdownForDescription2(next.markdown || next.content || "");
      if (!next.description && text) {
        const sentences = text.split(/[。！？!?]\s*/).map((item) => item.trim()).filter((item) => item.length >= 8);
        next.description = (sentences[0] || text).slice(0, 120);
      }
      if (!getRecordKeywords2(next).length) {
        next.keywords = extractKeywordsFromText2(`${next.description || ""} ${text}`, next.title || "");
      }
      return next;
    }
    __name(enrichExtractedWebpageMetadata2, "enrichExtractedWebpageMetadata");
    module2.exports = {
      enrichExtractedWebpageMetadata: enrichExtractedWebpageMetadata2,
      extractKeywordsFromText: extractKeywordsFromText2,
      getRecordAuthor: getRecordAuthor2,
      getRecordDescription: getRecordDescription2,
      getRecordKeywords: getRecordKeywords2,
      stripMarkdownForDescription: stripMarkdownForDescription2
    };
  }
});

// src/record-state-utils.js
var require_record_state_utils = __commonJS({
  "src/record-state-utils.js"(exports2, module2) {
    "use strict";
    function isCloudTranscriptionWaitingRecord2(record) {
      const metadata = record && record.metadata || {};
      const status = String(metadata.transcriptionStatus || "").toLowerCase();
      const source = String(metadata.transcriptionSource || metadata.transcriptionProvider || "").toLowerCase();
      const isCloudRecord = metadata.transcriptionMode === "cloud" || metadata.cloudTranscriptionRequested === true || source.includes("cloud-pretranscription") || source.includes("cloud");
      const hasTranscription = String(metadata.transcription || "").trim().length > 0;
      return isCloudRecord && !hasTranscription && ["pending", "queued", "processing"].includes(status);
    }
    __name(isCloudTranscriptionWaitingRecord2, "isCloudTranscriptionWaitingRecord");
    function isAudioVideoTranscriptionIncompleteRecord2(record) {
      const metadata = record && record.metadata || {};
      const status = String(metadata.transcriptionStatus || "").toLowerCase();
      const hasTranscription = String(metadata.transcription || "").trim().length > 0;
      const hasPersistableMarkdown = String(metadata.markdown || metadata.snapshot || metadata.contentSnapshot || "").trim().length > 0;
      if (hasPersistableMarkdown) return false;
      const isAudioVideoRecord = String(record && record.type || "").toLowerCase() === "voice" || metadata.webpageMediaType === "audio_video" || Boolean(metadata.audioFileID) || metadata.transcriptOnly === true;
      if (!isAudioVideoRecord || hasTranscription) return false;
      return ["pending", "queued", "processing", "failed"].includes(status);
    }
    __name(isAudioVideoTranscriptionIncompleteRecord2, "isAudioVideoTranscriptionIncompleteRecord");
    module2.exports = {
      isAudioVideoTranscriptionIncompleteRecord: isAudioVideoTranscriptionIncompleteRecord2,
      isCloudTranscriptionWaitingRecord: isCloudTranscriptionWaitingRecord2
    };
  }
});

// src/record-identity-utils.js
var require_record_identity_utils = __commonJS({
  "src/record-identity-utils.js"(exports2, module2) {
    "use strict";
    var RECORD_ID_MARKER_NAME = "wechat-inbox-record-id";
    function normalizeYamlScalar2(value) {
      const text = String(value || "").trim();
      if (text.startsWith('"') && text.endsWith('"') || text.startsWith("'") && text.endsWith("'")) {
        return text.slice(1, -1).trim();
      }
      return text;
    }
    __name(normalizeYamlScalar2, "normalizeYamlScalar");
    function getFrontmatterBlock2(markdown) {
      const source = String(markdown || "").replace(/^\uFEFF/, "");
      const match = /^---\s*\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
      return match ? match[1] : "";
    }
    __name(getFrontmatterBlock2, "getFrontmatterBlock");
    function getFrontmatterScalar2(markdown, fieldName) {
      const block = getFrontmatterBlock2(markdown);
      if (!block || !fieldName) return "";
      const escapedField = String(fieldName).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const lines = block.split(/\r?\n/);
      for (const line of lines) {
        const fieldMatch = new RegExp(`^\\s*${escapedField}\\s*:\\s*(.*?)\\s*$`, "i").exec(line);
        if (fieldMatch) return normalizeYamlScalar2(fieldMatch[1]);
      }
      return "";
    }
    __name(getFrontmatterScalar2, "getFrontmatterScalar");
    function getRecordIdFromFrontmatter2(markdown) {
      return getFrontmatterScalar2(markdown, "id");
    }
    __name(getRecordIdFromFrontmatter2, "getRecordIdFromFrontmatter");
    function getRecordIdFromHiddenMarker2(markdown) {
      const match = new RegExp(`<!--\\s*${RECORD_ID_MARKER_NAME}\\s*:\\s*([\\s\\S]*?)\\s*-->`, "i").exec(String(markdown || ""));
      return match ? normalizeYamlScalar2(match[1]).replace(/-->/g, "").trim() : "";
    }
    __name(getRecordIdFromHiddenMarker2, "getRecordIdFromHiddenMarker");
    function getRecordIdFromMarkdown2(markdown) {
      return getRecordIdFromFrontmatter2(markdown) || getRecordIdFromHiddenMarker2(markdown);
    }
    __name(getRecordIdFromMarkdown2, "getRecordIdFromMarkdown");
    function hasRecordIdInFrontmatter2(markdown, recordId) {
      const expected = String(recordId || "").trim();
      return Boolean(expected && getRecordIdFromMarkdown2(markdown) === expected);
    }
    __name(hasRecordIdInFrontmatter2, "hasRecordIdInFrontmatter");
    function buildRecordIdMarker2(recordId) {
      const id = String(recordId || "").replace(/-->/g, "").trim();
      return id ? `<!-- ${RECORD_ID_MARKER_NAME}: ${id} -->` : "";
    }
    __name(buildRecordIdMarker2, "buildRecordIdMarker");
    function normalizeRecordUrlForCompare2(url) {
      const raw = String(url || "").trim();
      if (!raw) return "";
      try {
        const parsed = new URL(raw);
        parsed.hash = "";
        parsed.protocol = parsed.protocol.toLowerCase();
        parsed.hostname = parsed.hostname.toLowerCase();
        return parsed.toString().replace(/\/$/, "");
      } catch (error) {
        return raw.replace(/#.*$/, "").replace(/\/$/, "");
      }
    }
    __name(normalizeRecordUrlForCompare2, "normalizeRecordUrlForCompare");
    function hasRecordUrlInFrontmatter2(markdown, recordUrl) {
      const expected = normalizeRecordUrlForCompare2(recordUrl);
      if (!expected) return false;
      const actual = normalizeRecordUrlForCompare2(getFrontmatterScalar2(markdown, "url"));
      return Boolean(actual && actual === expected);
    }
    __name(hasRecordUrlInFrontmatter2, "hasRecordUrlInFrontmatter");
    module2.exports = {
      buildRecordIdMarker: buildRecordIdMarker2,
      getFrontmatterBlock: getFrontmatterBlock2,
      getFrontmatterScalar: getFrontmatterScalar2,
      getRecordIdFromFrontmatter: getRecordIdFromFrontmatter2,
      getRecordIdFromHiddenMarker: getRecordIdFromHiddenMarker2,
      getRecordIdFromMarkdown: getRecordIdFromMarkdown2,
      hasRecordIdInFrontmatter: hasRecordIdInFrontmatter2,
      hasRecordUrlInFrontmatter: hasRecordUrlInFrontmatter2,
      normalizeRecordUrlForCompare: normalizeRecordUrlForCompare2,
      normalizeYamlScalar: normalizeYamlScalar2
    };
  }
});

// src/sync-lifecycle-utils.js
var require_sync_lifecycle_utils = __commonJS({
  "src/sync-lifecycle-utils.js"(exports2, module2) {
    "use strict";
    var crypto2 = require("node:crypto");
    var SYNC_LIFECYCLE_FAILURE_MESSAGES = Object.freeze({
      UNSUPPORTED_PLATFORM: "暂不支持此平台",
      NETWORK_FAILED: "网络连接失败，请稍后重新同步",
      EXTRACTION_FAILED: "内容解析失败，请重新同步",
      TRANSCRIPTION_FAILED: "音视频转写失败，请重新同步",
      OCR_FAILED: "图片文字识别失败，请重新同步",
      LOCAL_COMPONENT_UNAVAILABLE: "本地转写组件不可用，请检查后重新同步",
      WRITE_FAILED: "写入 Obsidian 失败，请重新同步",
      SYNC_FAILED: "同步处理失败，请重新同步"
    });
    var MAX_PENDING_SYNC_LIFECYCLE_ATTEMPTS = 100;
    function sanitizeSyncNoteTitle2(value) {
      const source = String(value || "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();
      const basename = source.split(/[\\/]/).pop() || "";
      return basename.replace(/\.md$/i, "").trim().slice(0, 200);
    }
    __name(sanitizeSyncNoteTitle2, "sanitizeSyncNoteTitle");
    function getSyncNoteTitleFromPath2(filePath) {
      return sanitizeSyncNoteTitle2(String(filePath || "").split(/[\\/]/).pop() || "");
    }
    __name(getSyncNoteTitleFromPath2, "getSyncNoteTitleFromPath");
    function categorizeSyncFailure2(error) {
      const code = String(error && error.code || "").trim().toUpperCase();
      const message = String(error && error.message || error || "").trim().toUpperCase();
      if (code === "UNSUPPORTED_PLATFORM" || /UNSUPPORTED_(?:PLATFORM|RECORD_TYPE|SITE)/.test(code) || /UNSUPPORTED (?:PLATFORM|RECORD TYPE|SITE)/.test(message) || /\u6682\u4e0d\u652f\u6301\u6b64\u5e73\u53f0|\u4e0d\u652f\u6301(?:\u6b64|\u8be5)?\u5e73\u53f0/.test(message)) {
        return "UNSUPPORTED_PLATFORM";
      }
      if (/NETWORK|TIMEOUT|ECONN|ENOTFOUND|FETCH/.test(code) || /NETWORK|TIMEOUT|ECONN|ENOTFOUND|FETCH/.test(message)) return "NETWORK_FAILED";
      if (/LOCAL_COMPONENT|COMPONENT_UNAVAILABLE/.test(code)) return "LOCAL_COMPONENT_UNAVAILABLE";
      if (/OCR/.test(code) || /OCR|\u6587\u5b57\u8bc6\u522b/.test(message)) return "OCR_FAILED";
      if (/TRANSCR|ASR|AUDIO|VOICE/.test(code) || /TRANSCR|ASR|\u8f6c\u5199|\u97f3\u9891|\u8bed\u97f3/.test(message)) {
        return "TRANSCRIPTION_FAILED";
      }
      if (/WRITE|VAULT|NOTE|FILE_SAVE/.test(code) || /WRITE|VAULT|NOTE|\u5199\u5165|\u7b14\u8bb0/.test(message)) {
        return "WRITE_FAILED";
      }
      if (/EXTRACT|XIAOHONGSHU|WEBPAGE|HTML|LINK/.test(code) || /EXTRACT|\u63d0\u53d6|\u7f51\u9875|\u5c0f\u7ea2\u4e66/.test(message)) {
        return "EXTRACTION_FAILED";
      }
      return "SYNC_FAILED";
    }
    __name(categorizeSyncFailure2, "categorizeSyncFailure");
    function normalizeLifecycleTimestamp(value) {
      const source = String(value || "").trim();
      if (!source) return "";
      const timestamp = new Date(source);
      return Number.isNaN(timestamp.getTime()) ? "" : timestamp.toISOString();
    }
    __name(normalizeLifecycleTimestamp, "normalizeLifecycleTimestamp");
    function normalizePendingSyncLifecycleAttempts2(value) {
      const byIdentity = /* @__PURE__ */ new Map();
      for (const source of Array.isArray(value) ? value : []) {
        if (!source || typeof source !== "object" || Array.isArray(source)) continue;
        const recordId = String(source.recordId || "").trim().slice(0, 128);
        const attemptId = String(source.attemptId || "").trim();
        const bindingFingerprint = String(source.bindingFingerprint || "").trim().toLowerCase();
        const stage = String(source.stage || "").trim().toLowerCase();
        if (!recordId || !/^[A-Za-z0-9_-]{8,128}$/.test(attemptId) || !/^[a-f0-9]{16,64}$/.test(bindingFingerprint) || !["processing", "failed", "committed"].includes(stage)) continue;
        const normalized = {
          recordId,
          attemptId,
          bindingFingerprint,
          stage,
          code: stage === "failed" ? String(source.code || "SYNC_FAILED").trim().toUpperCase().replace(/[^A-Z0-9_]/g, "").slice(0, 64) || "SYNC_FAILED" : "",
          noteTitle: stage === "committed" ? sanitizeSyncNoteTitle2(source.noteTitle) : "",
          createdAt: normalizeLifecycleTimestamp(source.createdAt),
          updatedAt: normalizeLifecycleTimestamp(source.updatedAt)
        };
        if (!normalized.code) delete normalized.code;
        if (!normalized.noteTitle) delete normalized.noteTitle;
        byIdentity.set(`${bindingFingerprint}:${recordId}`, normalized);
      }
      return [...byIdentity.values()].slice(-MAX_PENDING_SYNC_LIFECYCLE_ATTEMPTS);
    }
    __name(normalizePendingSyncLifecycleAttempts2, "normalizePendingSyncLifecycleAttempts");
    function getSyncLifecycleBindingFingerprint2(value) {
      const token = String(value || "").trim();
      if (!token) return "";
      return crypto2.createHash("sha256").update(token, "utf8").digest("hex").slice(0, 32);
    }
    __name(getSyncLifecycleBindingFingerprint2, "getSyncLifecycleBindingFingerprint");
    function createSyncLifecycleOutcomeError(code, message) {
      const error = new Error(String(message || "同步处理失败"));
      error.code = String(code || "SYNC_FAILED").trim().toUpperCase() || "SYNC_FAILED";
      return error;
    }
    __name(createSyncLifecycleOutcomeError, "createSyncLifecycleOutcomeError");
    function getMeaningfulMarkdownLength(markdown) {
      return String(markdown || "").replace(/!\[[^\]]*\]\([^)]+\)|!\[\[[^\]]+\]\]/g, " ").replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/https?:\/\/\S+/gi, " ").replace(/<[^>]+>/g, " ").replace(/[\s`#>*_\-|[\](){},.!?:;\u3000\uff0c\u3002\uff01\uff1f\uff1a\uff1b\u3001\u201c\u201d\u2018\u2019\u2026\u00b7]+/g, "").length;
    }
    __name(getMeaningfulMarkdownLength, "getMeaningfulMarkdownLength");
    function isLikelyWebpageShell(url, markdown) {
      if (!/^https?:\/\//i.test(String(url || ""))) return false;
      const text = String(markdown || "");
      if (/微信扫一扫可打开此内容|当前已为你保存原始链接|仅保存原始链接/.test(text)) {
        return true;
      }
      const shellPatterns = [
        /请(?:先)?登录.{0,16}(?:查看|继续|访问|阅读)/,
        /登录后.{0,16}(?:查看|继续|访问|阅读)/,
        /打开.{0,20}(?:APP|客户端|今日头条|抖音|小红书|微信).{0,20}(?:查看|阅读|继续|更多)/i,
        /(?:请)?在.{0,20}(?:APP|客户端).{0,12}(?:查看|阅读).{0,8}(?:完整)?内容/i,
        /访问(?:受限|异常|过于频繁)/,
        /完成验证后.{0,12}(?:继续|访问)/,
        /内容(?:不存在|已删除|暂时无法查看|加载失败)/,
        /(?:正文提取失败|内容解析失败)(?:[：:，,。]|$)/
      ];
      const signalCount = shellPatterns.filter((pattern) => pattern.test(text)).length;
      const meaningfulLength = getMeaningfulMarkdownLength(text);
      return signalCount >= 2 || signalCount >= 1 && meaningfulLength < 160;
    }
    __name(isLikelyWebpageShell, "isLikelyWebpageShell");
    function getMarkdownBody(markdown) {
      return String(markdown || "").replace(/^\uFEFF?---\s*\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "").replace(/<!--\s*wechat-inbox-record-id\s*:[\s\S]*?-->/gi, "").trim();
    }
    __name(getMarkdownBody, "getMarkdownBody");
    function isKnownFailureReceiptMarkdown(markdown) {
      const body = getMarkdownBody(markdown);
      if (!body) return false;
      const startsWithSavedPlatformLink = /^(?:小红书|抖音|飞书)链接已保存[。.!！]?/i.test(body);
      if (startsWithSavedPlatformLink) return true;
      return /^原始链接[：:]\s*https?:\/\/\S+[\s\S]*?##\s*视频号口播文案[\s\S]*?未能提取视频号口播文案[。.!！]?/i.test(body);
    }
    __name(isKnownFailureReceiptMarkdown, "isKnownFailureReceiptMarkdown");
    function isExistingLocalNoteDeliverable2(record, markdown) {
      const source = record && typeof record === "object" ? record : {};
      const metadata = source.metadata && typeof source.metadata === "object" ? source.metadata : {};
      const recordType = String(source.type || "").trim().toLowerCase();
      const fileExt = String(metadata.fileExt || "").trim().toLowerCase().replace(/^\./, "");
      const url = String(metadata.url || source.content || "").trim();
      const body = getMarkdownBody(markdown);
      if (isKnownFailureReceiptMarkdown(body)) return false;
      const hasEmbeddedAttachment = /!\[\[[^\]]+\]\]/.test(body);
      const contentOnlyBody = body.replace(/^\s*(?:原始链接|来源链接|source\s*url)\s*[：:]\s*https?:\/\/\S+\s*$/gim, "").replace(/^\s*>?\s*⚠️.*$/gim, "").trim();
      const meaningfulLength = getMeaningfulMarkdownLength(contentOnlyBody);
      if (recordType === "text") return meaningfulLength > 0;
      if (recordType === "file") {
        if (fileExt && fileExt !== "pdf" && hasEmbeddedAttachment) return true;
        return meaningfulLength >= 8;
      }
      if (recordType === "voice" || metadata.webpageMediaType === "audio_video" || metadata.transcriptOnly === true) {
        return meaningfulLength >= 8;
      }
      if (["webpage", "link"].includes(recordType) || /^https?:\/\//i.test(url)) {
        if (isLikelyWebpageShell(url, body)) return false;
        return meaningfulLength >= 8;
      }
      return meaningfulLength > 0 || hasEmbeddedAttachment;
    }
    __name(isExistingLocalNoteDeliverable2, "isExistingLocalNoteDeliverable");
    function getSyncLifecycleOutcomeError2(record) {
      const source = record && typeof record === "object" ? record : {};
      const metadata = source.metadata && typeof source.metadata === "object" ? source.metadata : {};
      const conversionStatus = String(metadata.conversionStatus || "").trim().toLowerCase();
      const transcriptionStatus = String(metadata.transcriptionStatus || "").trim().toLowerCase();
      const transcription = String(metadata.transcription || "").trim();
      const url = String(metadata.url || source.content || "").trim().toLowerCase();
      const fileExt = String(metadata.fileExt || "").trim().toLowerCase().replace(/^\./, "");
      const markdown = [
        metadata.convertedMarkdown,
        metadata.markdown,
        metadata.snapshot,
        metadata.contentSnapshot
      ].map((value) => String(value || "").trim()).filter(Boolean).join("\n");
      const declaredError = `${metadata.conversionError || ""} ${metadata.transcriptionError || ""}`.trim();
      const meaningfulLength = getMeaningfulMarkdownLength(markdown);
      const hasUsableOutput = meaningfulLength >= 40 || transcription.length >= 20;
      const hasDeclaredFailureState = ["failed", "link_saved", "wechat_captcha"].includes(conversionStatus) || transcriptionStatus === "failed";
      if (/weixin\.qq\.com\/sph\//.test(url) && (["failed", "link_saved"].includes(conversionStatus) || transcriptionStatus === "failed") || /UNSUPPORTED (?:PLATFORM|RECORD TYPE|SITE)|暂不支持(?:此|该)?平台|不支持(?:此|该)?平台/i.test(declaredError) && (hasDeclaredFailureState || !hasUsableOutput)) {
        return createSyncLifecycleOutcomeError("UNSUPPORTED_PLATFORM", "暂不支持此平台");
      }
      if (conversionStatus === "wechat_captcha") {
        return createSyncLifecycleOutcomeError("EXTRACTION_FAILED", "公众号正文提取失败：微信安全验证拦截");
      }
      if (/mp\.weixin\.qq\.com\//.test(url) && /微信扫一扫可打开此内容/.test(markdown) && /使用完整服务|使用小程序/.test(markdown)) {
        return createSyncLifecycleOutcomeError("EXTRACTION_FAILED", "公众号正文提取失败：微信仅返回打开引导页");
      }
      if (isLikelyWebpageShell(url, markdown)) {
        return createSyncLifecycleOutcomeError("EXTRACTION_FAILED", "内容解析失败：仅获取到打开或登录引导页");
      }
      const recordType = String(source.type || "").trim().toLowerCase();
      const isWebpageRecord = ["webpage", "link"].includes(recordType) || /^https?:\/\//i.test(url);
      if (isWebpageRecord && conversionStatus === "success" && !transcription && meaningfulLength === 0) {
        return createSyncLifecycleOutcomeError("EXTRACTION_FAILED", "内容解析失败：没有获得可写入的正文");
      }
      if (fileExt === "pdf" && conversionStatus === "attachment_saved") {
        return createSyncLifecycleOutcomeError("EXTRACTION_FAILED", "PDF 内容提取失败");
      }
      if (transcriptionStatus === "failed" && !transcription) {
        return createSyncLifecycleOutcomeError(
          "TRANSCRIPTION_FAILED",
          declaredError || SYNC_LIFECYCLE_FAILURE_MESSAGES.TRANSCRIPTION_FAILED
        );
      }
      if (["failed", "link_saved"].includes(conversionStatus)) {
        return createSyncLifecycleOutcomeError("EXTRACTION_FAILED", "内容解析失败");
      }
      return null;
    }
    __name(getSyncLifecycleOutcomeError2, "getSyncLifecycleOutcomeError");
    function getHttpStatusFromError(error) {
      return Number(error && (error.status || error.statusCode || error.response && error.response.status)) || 0;
    }
    __name(getHttpStatusFromError, "getHttpStatusFromError");
    function isLegacySyncLifecycleError2(error) {
      return [404, 405].includes(getHttpStatusFromError(error));
    }
    __name(isLegacySyncLifecycleError2, "isLegacySyncLifecycleError");
    function isSyncRecordBusyError2(error) {
      const code = String(error && error.code || "").toUpperCase();
      return getHttpStatusFromError(error) === 409 || ["RECORD_BUSY", "ATTEMPT_CONFLICT"].includes(code);
    }
    __name(isSyncRecordBusyError2, "isSyncRecordBusyError");
    module2.exports = {
      MAX_PENDING_SYNC_LIFECYCLE_ATTEMPTS,
      SYNC_LIFECYCLE_FAILURE_MESSAGES,
      categorizeSyncFailure: categorizeSyncFailure2,
      getSyncLifecycleOutcomeError: getSyncLifecycleOutcomeError2,
      getSyncLifecycleBindingFingerprint: getSyncLifecycleBindingFingerprint2,
      getSyncNoteTitleFromPath: getSyncNoteTitleFromPath2,
      isExistingLocalNoteDeliverable: isExistingLocalNoteDeliverable2,
      isKnownFailureReceiptMarkdown,
      isLegacySyncLifecycleError: isLegacySyncLifecycleError2,
      isSyncRecordBusyError: isSyncRecordBusyError2,
      normalizePendingSyncLifecycleAttempts: normalizePendingSyncLifecycleAttempts2,
      sanitizeSyncNoteTitle: sanitizeSyncNoteTitle2
    };
  }
});

// src/note-output-plan-utils.js
var require_note_output_plan_utils = __commonJS({
  "src/note-output-plan-utils.js"(exports2, module2) {
    "use strict";
    function requireFunction(value, name) {
      if (typeof value !== "function") {
        throw new TypeError(`note output dependency is required: ${name}`);
      }
      return value;
    }
    __name(requireFunction, "requireFunction");
    function createNoteOutputPlanHelpers2(dependencies = {}) {
      const {
        buildAiMetadataErrorComment: buildAiMetadataErrorComment2,
        buildFileMarkdownBody: buildFileMarkdownBody2,
        buildRecordIdMarker: buildRecordIdMarker2,
        buildWebpageMarkdownBody: buildWebpageMarkdownBody2,
        cleanDisplayUrl: cleanDisplayUrl2,
        defaultNotePropertyFields,
        getRecordAuthor: getRecordAuthor2,
        getRecordDescription: getRecordDescription2,
        getRecordId: getRecordId2,
        getRecordKeywords: getRecordKeywords2,
        getRecordSourceLabel: getRecordSourceLabel2,
        getRecordUrl: getRecordUrl2,
        getWebpageSourcePrefix: getWebpageSourcePrefix2,
        isFeishuUrl: isFeishuUrl2,
        isSuccessfulTranscriptionRecord: isSuccessfulTranscriptionRecord2,
        normalizeNotePropertyFields: normalizeNotePropertyFields2,
        normalizeVaultPath: normalizeVaultPath2
      } = dependencies;
      if (typeof defaultNotePropertyFields !== "string") {
        throw new TypeError("defaultNotePropertyFields is required");
      }
      const helpers = {
        buildAiMetadataErrorComment: requireFunction(buildAiMetadataErrorComment2, "buildAiMetadataErrorComment"),
        buildFileMarkdownBody: requireFunction(buildFileMarkdownBody2, "buildFileMarkdownBody"),
        buildRecordIdMarker: requireFunction(buildRecordIdMarker2, "buildRecordIdMarker"),
        buildWebpageMarkdownBody: requireFunction(buildWebpageMarkdownBody2, "buildWebpageMarkdownBody"),
        cleanDisplayUrl: requireFunction(cleanDisplayUrl2, "cleanDisplayUrl"),
        getRecordAuthor: requireFunction(getRecordAuthor2, "getRecordAuthor"),
        getRecordDescription: requireFunction(getRecordDescription2, "getRecordDescription"),
        getRecordId: requireFunction(getRecordId2, "getRecordId"),
        getRecordKeywords: requireFunction(getRecordKeywords2, "getRecordKeywords"),
        getRecordSourceLabel: requireFunction(getRecordSourceLabel2, "getRecordSourceLabel"),
        getRecordUrl: requireFunction(getRecordUrl2, "getRecordUrl"),
        getWebpageSourcePrefix: requireFunction(getWebpageSourcePrefix2, "getWebpageSourcePrefix"),
        isFeishuUrl: requireFunction(isFeishuUrl2, "isFeishuUrl"),
        isSuccessfulTranscriptionRecord: requireFunction(isSuccessfulTranscriptionRecord2, "isSuccessfulTranscriptionRecord"),
        normalizeNotePropertyFields: requireFunction(normalizeNotePropertyFields2, "normalizeNotePropertyFields"),
        normalizeVaultPath: requireFunction(normalizeVaultPath2, "normalizeVaultPath")
      };
      function yamlValue(value, options = {}) {
        if (value === void 0 || value === null) return "";
        const normalize = /* @__PURE__ */ __name((input) => String(input ?? "").replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "").replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim(), "normalize");
        if (Array.isArray(value)) {
          value = value.map((item) => normalize(item)).filter(Boolean).join(", ");
        }
        const text = normalize(value);
        if (!text) return "";
        if (options.quote || /[\r\n]/.test(text) || /^(?:true|false|null|yes|no|on|off)$/i.test(text)) {
          return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
        }
        return text;
      }
      __name(yamlValue, "yamlValue");
      function buildFrontmatter(lines) {
        return ["---", ...lines, "---", ""].join("\n");
      }
      __name(buildFrontmatter, "buildFrontmatter");
      function parseNotePropertyFields(propertyFields) {
        return helpers.normalizeNotePropertyFields(propertyFields).split(",").filter(Boolean);
      }
      __name(parseNotePropertyFields, "parseNotePropertyFields");
      function cleanFeishuPropertyText(value) {
        return String(value || "").replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "").replace(/\u6dfb\u52a0\u5feb\u6377\u65b9\u5f0f\s*\u6700\u8fd1\u4fee\u6539\s*[:\uff1a]?\s*[^,\uff0c\u3002\uff01\uff1f!?]{0,30}/g, " ").replace(/\u6700\u8fd1\u4fee\u6539\s*[:\uff1a]?\s*[^,\uff0c\u3002\uff01\uff1f!?]{0,30}/g, " ").replace(/\bheader-v2\b/gi, " ").replace(/\b\u5206\u4eab\b/g, " ").replace(/-\s+/g, "-").replace(/\s+/g, " ").trim();
      }
      __name(cleanFeishuPropertyText, "cleanFeishuPropertyText");
      function cleanFeishuDescriptionForFrontmatter(value) {
        const beforeShell = String(value || "").split(/\u6dfb\u52a0\u5feb\u6377\u65b9\u5f0f|\u6700\u8fd1\u4fee\u6539|header-v2/i)[0] || value;
        const cleaned = cleanFeishuPropertyText(beforeShell);
        const firstSentence = cleaned.split(/[\u3002\uff01\uff1f!?]\s*/).map((item) => item.trim()).filter(Boolean)[0] || cleaned;
        return firstSentence.slice(0, 160).trim();
      }
      __name(cleanFeishuDescriptionForFrontmatter, "cleanFeishuDescriptionForFrontmatter");
      function cleanRecordFrontmatterField(record, key, value) {
        const metadata = record && record.metadata || {};
        const url = helpers.getRecordUrl(record || {}, metadata);
        if (!helpers.isFeishuUrl(url)) return value;
        if (key === "title" || key === "author" || key === "source") return cleanFeishuPropertyText(value);
        if (key === "description") return cleanFeishuDescriptionForFrontmatter(value);
        if (key === "keywords" && Array.isArray(value)) return value.map((item) => cleanFeishuPropertyText(item)).filter(Boolean);
        if (key === "keywords") return cleanFeishuPropertyText(value);
        return value;
      }
      __name(cleanRecordFrontmatterField, "cleanRecordFrontmatterField");
      function buildRecordFrontmatter2(record, title, syncedAt, audioFileName, propertyFields = defaultNotePropertyFields) {
        const type = String(record.type || "").toLowerCase();
        const metadata = record.metadata || {};
        const aiMetadataSource = String(metadata.aiMetadataSource || "").trim();
        const socialMetrics = metadata.socialMetrics && typeof metadata.socialMetrics === "object" ? metadata.socialMetrics : {};
        const fields = {
          id: helpers.getRecordId(record),
          type,
          title,
          author: helpers.getRecordAuthor(metadata),
          url: helpers.getRecordUrl(record, metadata),
          created_at: record.createdAt,
          synced_at: syncedAt,
          source: helpers.getRecordSourceLabel(record, metadata),
          description: aiMetadataSource ? helpers.getRecordDescription(metadata) : "",
          keywords: aiMetadataSource ? helpers.getRecordKeywords(metadata) : [],
          views: socialMetrics.views,
          likes: socialMetrics.likes,
          collects: socialMetrics.collects,
          comments: socialMetrics.comments,
          shares: socialMetrics.shares,
          coins: socialMetrics.coins,
          metrics_captured_at: socialMetrics.capturedAt,
          status: "synced"
        };
        if (type === "link") fields.fetch_status = metadata.fetchStatus || "pending";
        if (type === "webpage") fields.conversion_status = metadata.conversionStatus || "pending";
        if (type === "voice") {
          fields.audio_file = audioFileName;
          fields.audio_file_id = metadata.audioFileID || "";
          fields.transcription_status = metadata.transcriptionStatus || "pending";
        }
        if (type === "file") {
          fields.file_name = metadata.fileName || record.content || "";
          fields.file_id = metadata.fileID || "";
          fields.file_ext = metadata.fileExt || "";
          fields.conversion_status = metadata.conversionStatus || "pending";
        }
        const defaultFieldOrder = parseNotePropertyFields(defaultNotePropertyFields);
        const legacyFieldOrder = ["id", "type", "title", "author", "url", "created_at", "synced_at", "source", "description", "keywords", "views", "likes", "collects", "comments", "shares", "coins", "metrics_captured_at", "status", "fetch_status", "conversion_status", "audio_file", "audio_file_id", "transcription_status", "file_name", "file_id", "file_ext"];
        const selectedFields = parseNotePropertyFields(propertyFields);
        const fieldOrder = selectedFields.length ? selectedFields : defaultFieldOrder.length ? defaultFieldOrder : legacyFieldOrder;
        const shouldQuoteFrontmatterValue = helpers.isFeishuUrl(helpers.getRecordUrl(record, metadata));
        const lines = fieldOrder.filter((key) => Object.prototype.hasOwnProperty.call(fields, key)).map((key) => [key, cleanRecordFrontmatterField(record, key, fields[key])]).filter(([, value]) => yamlValue(value, { quote: shouldQuoteFrontmatterValue })).map(([key, value]) => `${key}: ${yamlValue(value, { quote: shouldQuoteFrontmatterValue })}`);
        return buildFrontmatter(lines);
      }
      __name(buildRecordFrontmatter2, "buildRecordFrontmatter");
      function buildMarkdownForRecord2({ record, title, syncedAt, propertyFields = defaultNotePropertyFields }) {
        const type = String(record.type || "").toLowerCase();
        const metadata = record.metadata || {};
        const audioFileName = metadata.audioFileName || `${title}.mp3`;
        let body = "";
        if (type === "text") {
          body = `${record.content || ""}
`;
        } else if (type === "link") {
          const pageTitle = metadata.title || title;
          const snapshot = metadata.snapshot || metadata.contentSnapshot || "";
          const fallback = metadata.fetchStatus === "failed" ? "正文抓取失败，已保存标题和原始链接。" : "正文快照处理中，已先保存标题和原始链接。";
          body = [pageTitle, "", "## 正文快照", "", snapshot || fallback, ""].join("\n");
        } else if (type === "webpage") {
          body = helpers.buildWebpageMarkdownBody(record, title);
        } else if (type === "voice") {
          const errorText = metadata.transcriptionError || metadata.aiError || "";
          const transcription = metadata.transcription || (metadata.transcriptionStatus === "failed" ? `语音转写失败。${errorText}` : "未开启语音转写。");
          body = ["## 转写全文", "", transcription, "", "## 录音文件", "", `![[${audioFileName}]]`, ""].join("\n");
        } else if (type === "file") {
          body = helpers.buildFileMarkdownBody(record);
        } else {
          throw new Error(`Unsupported record type: ${record.type}`);
        }
        const frontmatter = buildRecordFrontmatter2(record, title, syncedAt, audioFileName, propertyFields);
        const recordIdMarker = helpers.buildRecordIdMarker(helpers.getRecordId(record));
        const aiMetadataErrorMarker = metadata.aiMetadataError ? helpers.buildAiMetadataErrorComment(metadata.aiMetadataError) : "";
        const diagnosticMarkers = [recordIdMarker, aiMetadataErrorMarker].filter(Boolean).join("\n");
        const titleHeading = helpers.isSuccessfulTranscriptionRecord(record) ? `# ${title}

` : "";
        return `${frontmatter}
${diagnosticMarkers ? `${diagnosticMarkers}

` : ""}${titleHeading}${body}`;
      }
      __name(buildMarkdownForRecord2, "buildMarkdownForRecord");
      function buildNoteOutputPlan2({ record, title, fileTitle = title, syncedAt, noteDir, propertyFields = defaultNotePropertyFields }) {
        return {
          markdown: buildMarkdownForRecord2({ record, title, syncedAt, propertyFields }),
          filePath: helpers.normalizeVaultPath(`${noteDir}/${fileTitle}.md`)
        };
      }
      __name(buildNoteOutputPlan2, "buildNoteOutputPlan");
      return { buildRecordFrontmatter: buildRecordFrontmatter2, buildMarkdownForRecord: buildMarkdownForRecord2, buildNoteOutputPlan: buildNoteOutputPlan2 };
    }
    __name(createNoteOutputPlanHelpers2, "createNoteOutputPlanHelpers");
    module2.exports = { createNoteOutputPlanHelpers: createNoteOutputPlanHelpers2 };
  }
});

// src/record-body-markdown-utils.js
var require_record_body_markdown_utils = __commonJS({
  "src/record-body-markdown-utils.js"(exports2, module2) {
    "use strict";
    function requireFunction(value, name) {
      if (typeof value !== "function") {
        throw new TypeError(`record body markdown dependency is required: ${name}`);
      }
      return value;
    }
    __name(requireFunction, "requireFunction");
    function createRecordBodyMarkdownHelpers2(dependencies = {}) {
      const helpers = {
        cleanDisplayUrl: requireFunction(dependencies.cleanDisplayUrl, "cleanDisplayUrl"),
        cleanMarkdownForStorage: requireFunction(dependencies.cleanMarkdownForStorage, "cleanMarkdownForStorage"),
        extractKeywordsFromText: requireFunction(dependencies.extractKeywordsFromText, "extractKeywordsFromText"),
        formatCreatedTime: requireFunction(dependencies.formatCreatedTime, "formatCreatedTime"),
        getWebpageSourcePrefix: requireFunction(dependencies.getWebpageSourcePrefix, "getWebpageSourcePrefix"),
        isFeishuUrl: requireFunction(dependencies.isFeishuUrl, "isFeishuUrl"),
        isWechatChannelsUrl: requireFunction(dependencies.isWechatChannelsUrl, "isWechatChannelsUrl"),
        isXiaohongshuUrl: requireFunction(dependencies.isXiaohongshuUrl, "isXiaohongshuUrl"),
        normalizeExtractedUrl: requireFunction(dependencies.normalizeExtractedUrl, "normalizeExtractedUrl"),
        sanitizeXiaohongshuMarkdownImages: requireFunction(dependencies.sanitizeXiaohongshuMarkdownImages, "sanitizeXiaohongshuMarkdownImages"),
        stripMarkdownCodeBlocks: requireFunction(dependencies.stripMarkdownCodeBlocks, "stripMarkdownCodeBlocks")
      };
      function buildAudioTranscriptMarkdown2({
        url,
        transcription,
        transcriptionStatus = "pending",
        transcriptionSource = "",
        transcriptionError = ""
      }) {
        url = helpers.cleanDisplayUrl(url);
        const status = String(transcriptionStatus || "").toLowerCase();
        const isCloudPending = ["queued", "processing"].includes(status) && String(transcriptionSource || "").includes("cloud");
        const content = String(transcription || "").trim() || (status === "failed" ? `转写失败。${transcriptionError || "未能提取到视频/音频文案。"}` : isCloudPending ? "云端转写中，下次同步会自动更新。" : "转写处理中，或未配置可用的转写方案。");
        return [
          "## 口播/音频文案",
          "",
          content,
          ""
        ].filter((line) => line !== "").join("\n");
      }
      __name(buildAudioTranscriptMarkdown2, "buildAudioTranscriptMarkdown");
      function buildSourceMediaAttachmentMarkdown2(metadata = {}) {
        const attachmentPath = String(metadata.sourceMediaAttachmentPath || "").trim();
        if (attachmentPath) {
          return [
            "## 原始音视频",
            "",
            `![[${attachmentPath}]]`
          ].join("\n");
        }
        if (metadata.sourceMediaAttachmentError) {
          return "> 原始音视频未能保存到本地，已保留转写结果。";
        }
        return "";
      }
      __name(buildSourceMediaAttachmentMarkdown2, "buildSourceMediaAttachmentMarkdown");
      function buildTranscriptPropertyMetadata2({
        transcription = "",
        title = ""
      } = {}) {
        const text = helpers.cleanMarkdownForStorage(helpers.stripMarkdownCodeBlocks(String(transcription || ""))).replace(/\s+/g, " ").trim();
        if (!text) {
          return {
            description: "",
            keywords: [],
            aiMetadataSource: ""
          };
        }
        const sentences = text.split(/[。！？!?]\s*/).map((item) => item.trim()).filter((item) => item.length >= 8);
        const description = (sentences[0] || text).slice(0, 160).trim();
        const keywords = helpers.extractKeywordsFromText(text, title).slice(0, 8);
        return {
          description,
          keywords,
          aiMetadataSource: "transcription"
        };
      }
      __name(buildTranscriptPropertyMetadata2, "buildTranscriptPropertyMetadata");
      function buildTranscriptOnlyMetadata2(metadata, {
        url = "",
        platform = "",
        mediaUrl = "",
        mediaUrls = [],
        subtitleUrl = "",
        transcription = "",
        transcriptionStatus = "failed",
        transcriptionSource = "",
        transcriptionError = "",
        conversionStatus = "",
        markdown: supplementalMarkdown = "",
        trailingMarkdown = "",
        sourceTitle = "",
        mediaResolutionDiagnostic = null
      } = {}) {
        const {
          markdown,
          snapshot,
          contentSnapshot,
          imageUrls,
          images,
          trailingMarkdown: existingTrailingMarkdown,
          ...rest
        } = metadata || {};
        const sourceName = platform || helpers.getWebpageSourcePrefix(url) || "网页";
        const cleanedSupplementalMarkdown = String(supplementalMarkdown || "").trim();
        const cleanedTrailingMarkdown = String(trailingMarkdown || existingTrailingMarkdown || "").trim();
        const normalizedMediaUrls = Array.from(new Set((Array.isArray(mediaUrls) ? mediaUrls : []).map((item) => helpers.normalizeExtractedUrl(typeof item === "string" ? item : item && item.url)).filter((item) => /^https?:\/\//i.test(item))));
        if (mediaUrl && !normalizedMediaUrls.includes(mediaUrl)) normalizedMediaUrls.unshift(mediaUrl);
        return {
          ...rest,
          title: String(sourceTitle || rest.sourceTitle || rest.title || `${sourceName}口播文案`).trim(),
          ...String(sourceTitle || rest.sourceTitle || "").trim() ? { sourceTitle: String(sourceTitle || rest.sourceTitle).trim() } : {},
          url: url || rest.url || "",
          transcriptOnly: true,
          ...cleanedSupplementalMarkdown ? { markdown: cleanedSupplementalMarkdown } : {},
          ...cleanedTrailingMarkdown ? { trailingMarkdown: cleanedTrailingMarkdown } : {},
          mediaUrl,
          audioUrl: mediaUrl,
          mediaUrls: normalizedMediaUrls,
          subtitleUrl,
          transcription,
          transcriptionStatus,
          transcriptionSource,
          transcriptionError,
          conversionStatus: conversionStatus || transcriptionStatus,
          ...mediaResolutionDiagnostic && typeof mediaResolutionDiagnostic === "object" ? { mediaResolutionDiagnostic } : {}
        };
      }
      __name(buildTranscriptOnlyMetadata2, "buildTranscriptOnlyMetadata");
      function buildWebpageMarkdownBody2(record, title) {
        const metadata = record.metadata || {};
        const url = helpers.cleanDisplayUrl(metadata.url || record.content || "");
        const pageTitle = metadata.title || title;
        let snapshot = helpers.cleanMarkdownForStorage(
          metadata.markdown || metadata.snapshot || metadata.contentSnapshot || "",
          {
            dedupe: helpers.isFeishuUrl(url),
            feishuTitle: helpers.isFeishuUrl(url) ? pageTitle : "",
            preserveListIndent: helpers.isXiaohongshuUrl(url)
          }
        );
        if (snapshot && helpers.isXiaohongshuUrl(url)) {
          snapshot = helpers.sanitizeXiaohongshuMarkdownImages(snapshot);
        }
        const status = metadata.conversionStatus || "pending";
        const errorText = metadata.conversionError || "";
        const diagnosticLines = [];
        const transportDiagnostic = metadata.conversionDiagnostic && typeof metadata.conversionDiagnostic === "object" ? metadata.conversionDiagnostic : null;
        if (transportDiagnostic && Array.isArray(transportDiagnostic.attempts)) {
          const attempts = transportDiagnostic.attempts.map((attempt) => {
            const error = attempt && attempt.error && typeof attempt.error === "object" ? attempt.error : {};
            const detail = String(error.code || "").trim() || (Number(error.status) ? `HTTP ${Number(error.status)}` : String(error.message || "").trim());
            return `${String(attempt.transport || "unknown")}${detail ? `=${detail}` : ""}`;
          }).filter(Boolean).slice(0, 4);
          if (attempts.length) diagnosticLines.push(`网页通道：${attempts.join("；")}`);
        }
        const mediaDiagnostic = metadata.mediaResolutionDiagnostic && typeof metadata.mediaResolutionDiagnostic === "object" ? metadata.mediaResolutionDiagnostic : null;
        if (mediaDiagnostic && (Number(mediaDiagnostic.mediaCandidateCount) === 0 || Array.isArray(mediaDiagnostic.stages))) {
          const failedStages = (Array.isArray(mediaDiagnostic.stages) ? mediaDiagnostic.stages : []).filter((stage) => stage && stage.ok === false).map((stage) => String(stage.stage || "media")).slice(0, 4);
          diagnosticLines.push(`媒体解析：候选 ${Number(mediaDiagnostic.mediaCandidateCount) || 0} 个${failedStages.length ? `；失败阶段：${failedStages.join("、")}` : ""}`);
        }
        const diagnosticMarkdown = diagnosticLines.length ? `> 诊断：${diagnosticLines.join("；")}` : "";
        const automaticShareText = metadata.automaticWebpageExtraction ? String(metadata.shareText || "").trim() : "";
        const automaticShareTextMarkdown = automaticShareText ? [
          "## 原始剪切板内容",
          "",
          ...automaticShareText.split(/\r?\n/).map((line) => `> ${line}`),
          ""
        ].join("\n") : "";
        if (helpers.isWechatChannelsUrl(url) && (status === "failed" || status === "wechat_captcha" || status === "link_saved")) {
          return [
            "> ⚠️ 视频号内容解析功能暂未接通，当前已为你保存原始链接。",
            "> 功能上线后，可以重新发送链接进行提取。",
            "",
            automaticShareTextMarkdown
          ].join("\n");
        }
        if (metadata.transcriptOnly && snapshot && helpers.isWechatChannelsUrl(url) && metadata.conversionStatus === "link_saved") {
          return `${snapshot}
`;
        }
        if (metadata.transcriptOnly) {
          const sourceMediaMarkdown = buildSourceMediaAttachmentMarkdown2(metadata);
          const trailingMarkdown = helpers.cleanMarkdownForStorage(metadata.trailingMarkdown || "", {
            preserveListIndent: helpers.isXiaohongshuUrl(url)
          });
          const transcriptMarkdown = buildAudioTranscriptMarkdown2({
            url,
            transcription: metadata.transcription || "",
            transcriptionStatus: metadata.transcriptionStatus || metadata.conversionStatus || "pending",
            transcriptionSource: metadata.transcriptionSource || metadata.transcriptionProvider || "",
            transcriptionError: metadata.transcriptionError || metadata.conversionError || ""
          });
          return [sourceMediaMarkdown, snapshot, transcriptMarkdown, trailingMarkdown, automaticShareTextMarkdown].filter(Boolean).join("\n\n").trim() + "\n";
        }
        if (snapshot) {
          if (helpers.isFeishuUrl(url)) {
            return [snapshot, automaticShareTextMarkdown].filter(Boolean).join("\n\n").trim() + "\n";
          }
          return [
            "## Markdown 内容",
            "",
            snapshot,
            "",
            automaticShareTextMarkdown
          ].join("\n");
        }
        if (status === "failed" || status === "wechat_captcha" || status === "link_saved") {
          const reasonLine = status === "wechat_captcha" ? "原因：微信返回了安全验证页，插件无法绕过" : `原因：${errorText || "网页抓取失败"}`;
          return [
            "> ⚠️ 这篇文章的正文未能自动提取，原始链接已写入笔记属性。",
            `> ${reasonLine}`,
            diagnosticMarkdown,
            "",
            "---",
            "",
            "**如果这个问题持续出现，请复制以下信息发给张张（微信 heyhmjx），帮助产品改进：**",
            "",
            "```",
            `链接：${url}`,
            `错误：${errorText || "未知"}`,
            `时间：${helpers.formatCreatedTime(record.createdAt)}`,
            "```",
            "",
            automaticShareTextMarkdown
          ].join("\n");
        }
        return [
          "> 网页正文正在处理中，原始链接已写入笔记属性，下次同步时会自动更新。",
          "",
          automaticShareTextMarkdown
        ].join("\n");
      }
      __name(buildWebpageMarkdownBody2, "buildWebpageMarkdownBody");
      function buildFileMarkdownBody2(record) {
        const metadata = record.metadata || {};
        const fileName = metadata.fileName || record.content || "upload-file";
        const fileID = metadata.fileID || "";
        const filePath = metadata.filePath || "";
        const converted = helpers.cleanMarkdownForStorage(metadata.markdown || metadata.convertedMarkdown || "");
        const status = metadata.conversionStatus || "pending";
        const errorText = metadata.conversionError || "";
        const transcriptionStatus = String(metadata.transcriptionStatus || "").toLowerCase();
        const transcription = String(metadata.transcription || "").trim();
        if (transcriptionStatus || transcription) {
          const transcriptionError = metadata.transcriptionError || "";
          const content = transcription || (transcriptionStatus === "failed" ? `转写失败。${transcriptionError || "未能提取到音视频文案。"}` : "转写处理中，或未配置可用的转写方案。");
          return [
            `文件名：${fileName}`,
            filePath ? `本地附件：[[${filePath}]]` : "",
            fileID ? `云端文件：${fileID}` : "",
            metadata.transcriptionSource ? `转写来源：${metadata.transcriptionSource}` : "",
            "",
            "## 口播/音频文案",
            "",
            content,
            ""
          ].filter((line) => line !== "").join("\n");
        }
        const fallback = status === "failed" ? `文件转 Markdown 失败，已保存文件信息。${errorText ? `

失败原因：${errorText}` : ""}` : status === "attachment_saved" ? `文件附件已保存。${errorText ? `

说明：${errorText}` : "暂未提取到可用正文。"}` : "文件转 Markdown 处理中，已先保存文件信息。";
        return [
          `文件名：${fileName}`,
          filePath ? `本地附件：[[${filePath}]]` : "",
          fileID ? `云端文件：${fileID}` : "",
          "",
          "## Markdown 内容",
          "",
          converted || fallback,
          ""
        ].filter((line) => line !== "").join("\n");
      }
      __name(buildFileMarkdownBody2, "buildFileMarkdownBody");
      return {
        buildWebpageMarkdownBody: buildWebpageMarkdownBody2,
        buildAudioTranscriptMarkdown: buildAudioTranscriptMarkdown2,
        buildSourceMediaAttachmentMarkdown: buildSourceMediaAttachmentMarkdown2,
        buildTranscriptPropertyMetadata: buildTranscriptPropertyMetadata2,
        buildTranscriptOnlyMetadata: buildTranscriptOnlyMetadata2,
        buildFileMarkdownBody: buildFileMarkdownBody2
      };
    }
    __name(createRecordBodyMarkdownHelpers2, "createRecordBodyMarkdownHelpers");
    module2.exports = {
      createRecordBodyMarkdownHelpers: createRecordBodyMarkdownHelpers2
    };
  }
});

// src/media-file-utils.js
var require_media_file_utils = __commonJS({
  "src/media-file-utils.js"(exports2, module2) {
    function getImageFileExtension2(url = "") {
      const match = String(url || "").split("?")[0].match(/\.([a-z0-9]{2,5})$/i);
      const ext = match ? match[1].toLowerCase() : "jpg";
      return ["jpg", "jpeg", "png", "webp", "bmp"].includes(ext) ? ext : "jpg";
    }
    __name(getImageFileExtension2, "getImageFileExtension");
    function getAudioFormatFromUrl2(audioUrl) {
      const match = String(audioUrl || "").toLowerCase().match(/\.([a-z0-9]{2,5})(?:[?#]|$)/);
      if (!match && /finder\.video\.qq\.com|mpvideo/i.test(String(audioUrl || ""))) return "mp4";
      const ext = match ? match[1] : "mp3";
      if (["mp3", "m4a", "wav", "aac", "flac", "ogg", "mp4"].includes(ext)) return ext;
      if (ext === "m4s") return "mp4";
      return "mp3";
    }
    __name(getAudioFormatFromUrl2, "getAudioFormatFromUrl");
    function hasVideoTrackInMediaBuffer2(value) {
      const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value || []);
      if (!buffer.length) return false;
      return buffer.includes(Buffer.from("vide")) || buffer.includes(Buffer.from("vp09"));
    }
    __name(hasVideoTrackInMediaBuffer2, "hasVideoTrackInMediaBuffer");
    function bufferStartsWith(buffer, bytes) {
      if (!buffer || buffer.length < bytes.length) return false;
      return bytes.every((byte, index) => buffer[index] === byte);
    }
    __name(bufferStartsWith, "bufferStartsWith");
    function getInvalidDownloadedMediaReason2(buffer) {
      if (!buffer || buffer.length < 512) {
        return "下载到的媒体文件过小，可能不是有效音视频文件";
      }
      const headBuffer = buffer.subarray(0, Math.min(buffer.length, 256));
      const headText = headBuffer.toString("utf8").trim().toLowerCase();
      if (headText.startsWith("<!doctype") || headText.startsWith("<html") || headText.includes("<body")) {
        return "下载到的是网页内容，不是有效音视频文件";
      }
      if (headText.startsWith("{") || headText.startsWith("[")) {
        return "下载到的是接口返回数据，不是有效音视频文件";
      }
      if (bufferStartsWith(buffer, [255, 216, 255]) || bufferStartsWith(buffer, [137, 80, 78, 71]) || bufferStartsWith(buffer, [71, 73, 70, 56]) || bufferStartsWith(buffer, [82, 73, 70, 70]) && buffer.subarray(8, 12).toString("ascii") === "WEBP") {
        return "下载到的是封面图片，不是有效音视频文件";
      }
      return "";
    }
    __name(getInvalidDownloadedMediaReason2, "getInvalidDownloadedMediaReason");
    function sanitizeAttachmentName2(fileName, fallbackName) {
      const text = String(fileName || fallbackName || "upload-file").trim();
      return (text || "upload-file").replace(/[\\/:*?"<>|]/g, "-");
    }
    __name(sanitizeAttachmentName2, "sanitizeAttachmentName");
    function decodeDataUrl2(dataUrl) {
      const match = String(dataUrl || "").match(/^data:([^;,]+)?(;base64)?,(.*)$/);
      if (!match) return null;
      const mimeType = match[1] || "application/octet-stream";
      const body = match[3] || "";
      const buffer = match[2] ? Buffer.from(body, "base64") : Buffer.from(decodeURIComponent(body), "utf8");
      return { mimeType, buffer };
    }
    __name(decodeDataUrl2, "decodeDataUrl");
    function getImageExtFromMime2(mimeType) {
      const type = String(mimeType || "").toLowerCase();
      if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
      if (type.includes("webp")) return "webp";
      if (type.includes("gif")) return "gif";
      if (type.includes("svg")) return "svg";
      return "png";
    }
    __name(getImageExtFromMime2, "getImageExtFromMime");
    function getImageExtFromBuffer2(buffer, fallbackUrl = "") {
      const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
      if (data.length >= 8 && data[0] === 137 && data[1] === 80 && data[2] === 78 && data[3] === 71) return "png";
      if (data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255) return "jpg";
      if (data.length >= 6 && data.slice(0, 6).toString("ascii").startsWith("GIF")) return "gif";
      if (data.length >= 12 && data.slice(0, 4).toString("ascii") === "RIFF" && data.slice(8, 12).toString("ascii") === "WEBP") return "webp";
      if (getSvgTextFromBuffer(data)) return "svg";
      return getImageFileExtension2(fallbackUrl) || "png";
    }
    __name(getImageExtFromBuffer2, "getImageExtFromBuffer");
    function getSvgTextFromBuffer(buffer) {
      const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
      if (!data.length) return "";
      const text = data.slice(0, Math.min(data.length, 8192)).toString("utf8").replace(/^\uFEFF/, "").trimStart();
      return /^(?:<\?xml[^>]*>\s*)?<svg\b/i.test(text) ? text : "";
    }
    __name(getSvgTextFromBuffer, "getSvgTextFromBuffer");
    function getImageDimensionsFromBuffer2(buffer) {
      const data = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
      if (data.length >= 24 && data[0] === 137 && data[1] === 80 && data[2] === 78 && data[3] === 71) {
        return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
      }
      if (data.length >= 10 && data.slice(0, 6).toString("ascii").startsWith("GIF")) {
        return { width: data.readUInt16LE(6), height: data.readUInt16LE(8) };
      }
      const svgText = getSvgTextFromBuffer(data);
      if (svgText) {
        const svgTag = (svgText.match(/<svg\b[^>]*>/i) || [])[0] || "";
        const readDimension = /* @__PURE__ */ __name((name) => {
          const match = svgTag.match(new RegExp(`\\b${name}=["']\\s*([0-9]+(?:\\.[0-9]+)?)`, "i"));
          return match ? Number(match[1]) : 0;
        }, "readDimension");
        let width = readDimension("width");
        let height = readDimension("height");
        if (!(width > 0 && height > 0)) {
          const viewBox = svgTag.match(/\bviewBox=["']\s*[-+0-9.e]+[\s,]+[-+0-9.e]+[\s,]+([-+0-9.e]+)[\s,]+([-+0-9.e]+)/i);
          if (viewBox) {
            width = width || Number(viewBox[1]);
            height = height || Number(viewBox[2]);
          }
        }
        return width > 0 && height > 0 ? { width, height } : null;
      }
      return null;
    }
    __name(getImageDimensionsFromBuffer2, "getImageDimensionsFromBuffer");
    function getAttachmentExt2(fileName, fallbackExt) {
      const fromName = String(fileName || "").split(".").pop();
      const ext = String(fallbackExt || fromName || "").toLowerCase().replace(/^\./, "");
      return ext === String(fileName || "").toLowerCase() ? "" : ext;
    }
    __name(getAttachmentExt2, "getAttachmentExt");
    function isMarkdownConvertibleExt2(ext) {
      return ["md", "markdown", "txt"].includes(String(ext || "").toLowerCase());
    }
    __name(isMarkdownConvertibleExt2, "isMarkdownConvertibleExt");
    function isAudioVideoAttachmentExt2(ext) {
      return ["mp3", "m4a", "wav", "aac", "amr", "silk", "ogg", "flac", "mp4", "mov", "m4v"].includes(String(ext || "").toLowerCase());
    }
    __name(isAudioVideoAttachmentExt2, "isAudioVideoAttachmentExt");
    function decodeUtf8ArrayBuffer2(buffer) {
      return toNodeBuffer2(buffer).toString("utf8");
    }
    __name(decodeUtf8ArrayBuffer2, "decodeUtf8ArrayBuffer");
    function toNodeBuffer2(data) {
      if (Buffer.isBuffer(data)) return data;
      if (ArrayBuffer.isView(data)) {
        return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
      }
      return Buffer.from(data || []);
    }
    __name(toNodeBuffer2, "toNodeBuffer");
    module2.exports = {
      bufferStartsWith,
      decodeDataUrl: decodeDataUrl2,
      decodeUtf8ArrayBuffer: decodeUtf8ArrayBuffer2,
      getAttachmentExt: getAttachmentExt2,
      getAudioFormatFromUrl: getAudioFormatFromUrl2,
      getImageDimensionsFromBuffer: getImageDimensionsFromBuffer2,
      getImageExtFromBuffer: getImageExtFromBuffer2,
      getImageExtFromMime: getImageExtFromMime2,
      getImageFileExtension: getImageFileExtension2,
      getInvalidDownloadedMediaReason: getInvalidDownloadedMediaReason2,
      hasVideoTrackInMediaBuffer: hasVideoTrackInMediaBuffer2,
      isAudioVideoAttachmentExt: isAudioVideoAttachmentExt2,
      isMarkdownConvertibleExt: isMarkdownConvertibleExt2,
      sanitizeAttachmentName: sanitizeAttachmentName2,
      toNodeBuffer: toNodeBuffer2
    };
  }
});

// src/document-text-extraction-utils.js
var require_document_text_extraction_utils = __commonJS({
  "src/document-text-extraction-utils.js"(exports2, module2) {
    "use strict";
    var zlib = require("zlib");
    function createDocumentTextExtractionHelpers2({
      toNodeBuffer: toNodeBuffer2,
      cleanMarkdownForStorage: cleanMarkdownForStorage2
    } = {}) {
      if (typeof toNodeBuffer2 !== "function") {
        throw new TypeError("toNodeBuffer must be a function");
      }
      if (typeof cleanMarkdownForStorage2 !== "function") {
        throw new TypeError("cleanMarkdownForStorage must be a function");
      }
      function decodeUtf16Be(buffer) {
        const chunks = [];
        for (let index = 0; index + 1 < buffer.length; index += 2) {
          chunks.push(String.fromCharCode(buffer.readUInt16BE(index)));
        }
        return chunks.join("");
      }
      __name(decodeUtf16Be, "decodeUtf16Be");
      function decodeXmlEntities(text) {
        return String(text || "").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&apos;/gi, "'").replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16))).replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
      }
      __name(decodeXmlEntities, "decodeXmlEntities");
      function inflateZipEntry(buffer, method) {
        if (method === 0) return buffer;
        if (method === 8) return zlib.inflateRawSync(buffer);
        throw new Error(`暂不支持的 docx 压缩方式：${method}`);
      }
      __name(inflateZipEntry, "inflateZipEntry");
      function readZipEntries(bufferLike) {
        const buffer = toNodeBuffer2(bufferLike);
        let eocdOffset = -1;
        const minOffset = Math.max(0, buffer.length - 65558);
        for (let index = buffer.length - 22; index >= minOffset; index -= 1) {
          if (buffer.readUInt32LE(index) === 101010256) {
            eocdOffset = index;
            break;
          }
        }
        if (eocdOffset < 0) {
          throw new Error("未找到 docx 压缩包目录");
        }
        const entryCount = buffer.readUInt16LE(eocdOffset + 10);
        let offset = buffer.readUInt32LE(eocdOffset + 16);
        const entries = /* @__PURE__ */ new Map();
        for (let index = 0; index < entryCount; index += 1) {
          if (buffer.readUInt32LE(offset) !== 33639248) {
            throw new Error("docx 压缩包目录格式异常");
          }
          const method = buffer.readUInt16LE(offset + 10);
          const compressedSize = buffer.readUInt32LE(offset + 20);
          const fileNameLength = buffer.readUInt16LE(offset + 28);
          const extraLength = buffer.readUInt16LE(offset + 30);
          const commentLength = buffer.readUInt16LE(offset + 32);
          const localHeaderOffset = buffer.readUInt32LE(offset + 42);
          const fileName = buffer.slice(offset + 46, offset + 46 + fileNameLength).toString("utf8");
          const localNameLength = buffer.readUInt16LE(localHeaderOffset + 26);
          const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
          const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
          const compressed = buffer.slice(dataOffset, dataOffset + compressedSize);
          entries.set(fileName, inflateZipEntry(compressed, method));
          offset += 46 + fileNameLength + extraLength + commentLength;
        }
        return entries;
      }
      __name(readZipEntries, "readZipEntries");
      function extractDocxMarkdown2(bufferLike) {
        const entries = readZipEntries(bufferLike);
        const documentXml = entries.get("word/document.xml");
        if (!documentXml) {
          throw new Error("docx 中没有找到 word/document.xml");
        }
        const xml = documentXml.toString("utf8");
        const paragraphs = xml.match(/<w:p[\s\S]*?<\/w:p>/g) || [];
        const lines = paragraphs.map((paragraph) => {
          const isHeading = /<w:pStyle[^>]+w:val=["']Heading([1-6])["']/i.exec(paragraph);
          const text = decodeXmlEntities(paragraph.replace(/<w:tab\s*\/>/g, "	").replace(/<w:br\s*\/>/g, "\n").replace(/<w:t[^>]*>/g, "").replace(/<\/w:t>/g, "").replace(/<[^>]+>/g, "")).replace(/[ \t]+\n/g, "\n").trim();
          if (!text) return "";
          if (isHeading) {
            return `${"#".repeat(Math.min(Number(isHeading[1]), 6))} ${text}`;
          }
          return text;
        }).filter(Boolean);
        if (!lines.length) {
          throw new Error("docx 正文为空，未提取到文本");
        }
        return lines.join("\n\n");
      }
      __name(extractDocxMarkdown2, "extractDocxMarkdown");
      function decodePdfBytes(buffer) {
        if (buffer.length >= 2 && buffer[0] === 254 && buffer[1] === 255) {
          return decodeUtf16Be(buffer.slice(2));
        }
        let zeroEven = 0;
        for (let index = 0; index < Math.min(buffer.length, 80); index += 2) {
          if (buffer[index] === 0) zeroEven += 1;
        }
        if (zeroEven > 4) {
          return decodeUtf16Be(buffer);
        }
        return buffer.toString("utf8");
      }
      __name(decodePdfBytes, "decodePdfBytes");
      function decodePdfLiteralString(value) {
        const bytes = [];
        for (let index = 0; index < value.length; index += 1) {
          const char = value[index];
          if (char !== "\\") {
            bytes.push(char.charCodeAt(0) & 255);
            continue;
          }
          const next = value[index + 1];
          if (!next) break;
          index += 1;
          if (next === "n") bytes.push(10);
          else if (next === "r") bytes.push(13);
          else if (next === "t") bytes.push(9);
          else if (next === "b") bytes.push(8);
          else if (next === "f") bytes.push(12);
          else if (/[0-7]/.test(next)) {
            let octal = next;
            for (let count = 0; count < 2 && /[0-7]/.test(value[index + 1]); count += 1) {
              index += 1;
              octal += value[index];
            }
            bytes.push(parseInt(octal, 8));
          } else {
            bytes.push(next.charCodeAt(0) & 255);
          }
        }
        return decodePdfBytes(Buffer.from(bytes));
      }
      __name(decodePdfLiteralString, "decodePdfLiteralString");
      function decodePdfHexString(value, cmap) {
        const hex = String(value || "").replace(/[^0-9a-f]/gi, "");
        if (!hex) return "";
        if (cmap && cmap.size) {
          const mapped = applyPdfCMap(hex, cmap);
          if (mapped) return mapped;
        }
        const normalized = hex.length % 2 ? `${hex}0` : hex;
        return decodePdfBytes(Buffer.from(normalized, "hex"));
      }
      __name(decodePdfHexString, "decodePdfHexString");
      function unicodeFromPdfHex(hex) {
        const buffer = Buffer.from(String(hex || "").replace(/[^0-9a-f]/gi, ""), "hex");
        if (!buffer.length) return "";
        if (buffer.length >= 2) return decodeUtf16Be(buffer);
        return buffer.toString("utf8");
      }
      __name(unicodeFromPdfHex, "unicodeFromPdfHex");
      function parsePdfCMap(content, cmap) {
        const source = String(content || "");
        let section;
        const bfcharPattern = /beginbfchar([\s\S]*?)endbfchar/g;
        while (section = bfcharPattern.exec(source)) {
          const pairPattern = /<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>/g;
          let pair;
          while (pair = pairPattern.exec(section[1])) {
            cmap.set(pair[1].toUpperCase(), unicodeFromPdfHex(pair[2]));
          }
        }
        const bfrangePattern = /beginbfrange([\s\S]*?)endbfrange/g;
        while (section = bfrangePattern.exec(source)) {
          const rangePattern = /<([0-9a-fA-F]+)>\s+<([0-9a-fA-F]+)>\s+(<([0-9a-fA-F]+)>|\[([\s\S]*?)\])/g;
          let range;
          while (range = rangePattern.exec(section[1])) {
            const start = parseInt(range[1], 16);
            const end = parseInt(range[2], 16);
            const width = range[1].length;
            if (range[4]) {
              let target = parseInt(range[4], 16);
              for (let code = start; code <= end; code += 1) {
                cmap.set(code.toString(16).toUpperCase().padStart(width, "0"), unicodeFromPdfHex(target.toString(16).padStart(range[4].length, "0")));
                target += 1;
              }
            } else if (range[5]) {
              const values = [...range[5].matchAll(/<([0-9a-fA-F]+)>/g)].map((item) => item[1]);
              values.forEach((value, index) => {
                cmap.set((start + index).toString(16).toUpperCase().padStart(width, "0"), unicodeFromPdfHex(value));
              });
            }
          }
        }
      }
      __name(parsePdfCMap, "parsePdfCMap");
      function buildPdfCMap(streams) {
        const cmap = /* @__PURE__ */ new Map();
        streams.forEach((stream) => {
          if (String(stream || "").includes("beginbfchar") || String(stream || "").includes("beginbfrange")) {
            parsePdfCMap(stream, cmap);
          }
        });
        return cmap;
      }
      __name(buildPdfCMap, "buildPdfCMap");
      function applyPdfCMap(hex, cmap) {
        const source = String(hex || "").toUpperCase();
        const keyLengths = [...new Set([...cmap.keys()].map((key) => key.length))].sort((a, b) => b - a);
        const out = [];
        let index = 0;
        while (index < source.length) {
          let matched = false;
          for (const length of keyLengths) {
            const part = source.slice(index, index + length);
            if (cmap.has(part)) {
              out.push(cmap.get(part));
              index += length;
              matched = true;
              break;
            }
          }
          if (!matched) {
            out.push(decodePdfBytes(Buffer.from(source.slice(index, index + 2), "hex")));
            index += 2;
          }
        }
        return out.join("").replace(/\0/g, "").trim();
      }
      __name(applyPdfCMap, "applyPdfCMap");
      function extractPdfTextFromContent(content, cmap) {
        const chunks = [];
        const literalPattern = /\((?:\\.|[^\\()])*\)\s*Tj/g;
        const hexPattern = /<([0-9a-fA-F\s]+)>\s*Tj/g;
        const arrayPattern = /\[(.*?)\]\s*TJ/gs;
        let match;
        while (match = literalPattern.exec(content)) {
          chunks.push(decodePdfLiteralString(match[0].replace(/\s*Tj$/, "").slice(1, -1)));
        }
        while (match = hexPattern.exec(content)) {
          chunks.push(decodePdfHexString(match[1], cmap));
        }
        while (match = arrayPattern.exec(content)) {
          const arrayBody = match[1];
          const parts = arrayBody.match(/\((?:\\.|[^\\()])*\)|<([0-9a-fA-F\s]+)>/g) || [];
          parts.forEach((part) => {
            if (part.startsWith("(")) chunks.push(decodePdfLiteralString(part.slice(1, -1)));
            else chunks.push(decodePdfHexString(part.slice(1, -1), cmap));
          });
        }
        return chunks.map((text) => text.replace(/\0/g, "").trim()).filter((text) => text && /[\p{L}\p{N}\u4e00-\u9fff]/u.test(text)).join("\n");
      }
      __name(extractPdfTextFromContent, "extractPdfTextFromContent");
      function isPdfMicroLine(line) {
        const text = String(line || "").trim();
        if (!text) return false;
        if (/^[-*+]\s+/.test(text)) return false;
        const compact = text.replace(/\s+/g, "");
        return Array.from(compact).length <= 2;
      }
      __name(isPdfMicroLine, "isPdfMicroLine");
      function shouldJoinPdfLines(previous, next) {
        const left = String(previous || "").trim();
        const right = String(next || "").trim();
        if (!left || !right) return false;
        if (/^#{1,6}\s+/.test(left) || /^#{1,6}\s+/.test(right)) return false;
        if (/^[-*+]\s+/.test(left) || /^[-*+]\s+/.test(right)) return false;
        if (/^\d{1,3}[.)、]\s*/.test(right)) return false;
        if (/[。！？!?；;：:]$/.test(left)) return false;
        if (/^[,，.。!?！？;；:：)]/.test(right)) return true;
        return /[\p{L}\p{N}\u4e00-\u9fff]$/u.test(left) && /^[\p{L}\p{N}\u4e00-\u9fff]/u.test(right);
      }
      __name(shouldJoinPdfLines, "shouldJoinPdfLines");
      function getPdfLineJoiner(previous, next) {
        const left = String(previous || "").trim();
        const right = String(next || "").trim();
        if (!left || !right) return "";
        if (/^[,，.。!?！？;；:：)]/.test(right)) return "";
        if (/[\u4e00-\u9fff]$/u.test(left) && /^[\u4e00-\u9fff]/u.test(right)) return "";
        if (/\b[A-Z]{1,8}$/u.test(left) && /^[A-Z]\b/u.test(right)) return "";
        return " ";
      }
      __name(getPdfLineJoiner, "getPdfLineJoiner");
      function mergePdfWrappedLines(lines) {
        const merged = [];
        (lines || []).forEach((line) => {
          const current = String(line || "").trim();
          if (!current) {
            if (merged.length && merged[merged.length - 1] !== "") merged.push("");
            return;
          }
          const previous = merged[merged.length - 1];
          if (previous && shouldJoinPdfLines(previous, current)) {
            merged[merged.length - 1] = `${previous}${getPdfLineJoiner(previous, current)}${current}`;
            return;
          }
          merged.push(current);
        });
        return merged;
      }
      __name(mergePdfWrappedLines, "mergePdfWrappedLines");
      function isLowQualityPdfExtraction(text) {
        const source = String(text || "");
        const compact = source.replace(/\s+/g, "");
        if (!compact) return true;
        const controlCount = (source.match(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g) || []).length;
        if (controlCount > 3) return true;
        if (/[锟�]/.test(source)) return true;
        const cjkCount = (compact.match(/[\u4e00-\u9fff]/g) || []).length;
        if (cjkCount >= 2) return false;
        const latinWordCount = (source.match(/[A-Za-z]{2,}/g) || []).length;
        const readableCount = cjkCount + latinWordCount * 2;
        return readableCount < 4;
      }
      __name(isLowQualityPdfExtraction, "isLowQualityPdfExtraction");
      function isSuspectPdfGlyphEncoding(text) {
        const source = String(text || "");
        const latinWords = source.match(/[A-Za-z]{12,}/g) || [];
        const longLatinWords = latinWords.filter((word) => word.length >= 18);
        const knownGlyphNoise = source.match(/\b(?:Rhe|Nlaybook|Buildine|Natite|Cncwfe|Copteptu|CHCRVER|Staee|chaneine|Aeentic|aeent|Nroeram|RESOWRCES)\b/gi) || [];
        const compact = source.replace(/\s+/g, "");
        const compactCjk = source.replace(/[^\u4e00-\u9fff]/g, "");
        const oddCjkTokens = source.match(/(?:学么|人未|改取|周朋|练么|可维)/g) || [];
        const cjkRatio = compact ? compactCjk.length / Array.from(compact).length : 0;
        const hasReadableCjkText = compactCjk.length >= 80 && cjkRatio >= 0.25;
        const cjkCharacters = Array.from(compactCjk);
        const uniqueCjkRatio = cjkCharacters.length ? new Set(cjkCharacters).size / cjkCharacters.length : 1;
        const sentencePunctuationCount = (source.match(/[。！？!?；;]/g) || []).length;
        const sentencePunctuationRatio = cjkCharacters.length ? sentencePunctuationCount / cjkCharacters.length : 0;
        const longestLineLength = String(source).split(/\r?\n/).reduce((max, line) => Math.max(max, Array.from(line.replace(/\s+/g, "")).length), 0);
        const trigramCounts = /* @__PURE__ */ new Map();
        let maxTrigramCount = 0;
        for (let index = 0; index <= cjkCharacters.length - 3; index += 1) {
          const trigram = cjkCharacters.slice(index, index + 3).join("");
          const count = (trigramCounts.get(trigram) || 0) + 1;
          trigramCounts.set(trigram, count);
          if (count > maxTrigramCount) maxTrigramCount = count;
        }
        const hasCorruptedCjkRun = cjkCharacters.length >= 200 && longestLineLength >= 180 && sentencePunctuationRatio < 4e-3 && (uniqueCjkRatio < 0.28 || maxTrigramCount >= 6);
        if (knownGlyphNoise.length >= 4) return true;
        if (hasCorruptedCjkRun) return true;
        if (!hasReadableCjkText && longLatinWords.length >= 6 && latinWords.length >= 12) return true;
        return compactCjk.length >= 1e3 && oddCjkTokens.length >= 8 && longLatinWords.length >= 3;
      }
      __name(isSuspectPdfGlyphEncoding, "isSuspectPdfGlyphEncoding");
      function cleanPdfExtractedText2(text) {
        const lines = String(text || "").replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "").replace(/\r\n/g, "\n").split("\n");
        const out = [];
        let microRun = [];
        let pendingBlankAfterMicroRun = 0;
        const flushMicroRun = /* @__PURE__ */ __name(() => {
          if (!microRun.length) {
            return;
          }
          const compact = microRun.join("").replace(/\s+/g, "");
          const compactLength = Array.from(compact).length;
          if (/^[A-Za-z]{2,8}$/.test(compact)) {
            out.push(compact);
          } else if (microRun.length < 4 && compactLength < 4) {
            out.push(...microRun);
          } else if (compactLength >= 4 && /[\p{L}\p{N}\u4e00-\u9fff]/u.test(compact)) {
            out.push(compact);
          }
          microRun = [];
          pendingBlankAfterMicroRun = 0;
        }, "flushMicroRun");
        lines.forEach((line) => {
          const trimmed = String(line || "").trim();
          if (!trimmed) {
            if (microRun.length && pendingBlankAfterMicroRun < 2) {
              pendingBlankAfterMicroRun += 1;
              return;
            }
            flushMicroRun();
            if (out.length && out[out.length - 1] !== "") out.push("");
            return;
          }
          if (/^\d{1,4}$/.test(trimmed)) {
            flushMicroRun();
            return;
          }
          if (isPdfMicroLine(trimmed)) {
            microRun.push(trimmed);
            pendingBlankAfterMicroRun = 0;
            return;
          }
          flushMicroRun();
          out.push(trimmed);
        });
        flushMicroRun();
        return cleanMarkdownForStorage2(mergePdfWrappedLines(out).join("\n"));
      }
      __name(cleanPdfExtractedText2, "cleanPdfExtractedText");
      function decodePdfStream(raw, dictionary) {
        if (/\/Subtype\s*\/Image\b/.test(dictionary)) {
          return "";
        }
        if (/\/FlateDecode\b/.test(dictionary)) {
          try {
            return zlib.inflateSync(raw).toString("latin1");
          } catch (error) {
            try {
              return zlib.inflateRawSync(raw).toString("latin1");
            } catch (fallbackError) {
              return "";
            }
          }
        }
        return raw.toString("latin1");
      }
      __name(decodePdfStream, "decodePdfStream");
      function extractPdfStreamLength(dictionary) {
        const match = String(dictionary || "").match(/\/Length\s+(\d+)/);
        return match ? Number(match[1]) : null;
      }
      __name(extractPdfStreamLength, "extractPdfStreamLength");
      function getPdfStreamData({ buffer, source, dictionary, streamKeywordEnd }) {
        let dataStart = streamKeywordEnd;
        if (source[dataStart] === "\r" && source[dataStart + 1] === "\n") {
          dataStart += 2;
        } else if (source[dataStart] === "\n" || source[dataStart] === "\r") {
          dataStart += 1;
        }
        const directLength = extractPdfStreamLength(dictionary);
        if (Number.isFinite(directLength) && directLength >= 0 && dataStart + directLength <= buffer.length) {
          const endstreamOffset = source.indexOf("endstream", dataStart + directLength);
          return {
            raw: buffer.slice(dataStart, dataStart + directLength),
            nextOffset: endstreamOffset > -1 ? endstreamOffset + 9 : dataStart + directLength
          };
        }
        const streamEnd = source.indexOf("endstream", dataStart);
        if (streamEnd < 0) {
          return null;
        }
        let dataEnd = streamEnd;
        if (source[dataEnd - 2] === "\r" && source[dataEnd - 1] === "\n") {
          dataEnd -= 2;
        } else if (source[dataEnd - 1] === "\n" || source[dataEnd - 1] === "\r") {
          dataEnd -= 1;
        }
        return {
          raw: buffer.slice(dataStart, dataEnd),
          nextOffset: streamEnd + 9
        };
      }
      __name(getPdfStreamData, "getPdfStreamData");
      function extractPdfMarkdown2(bufferLike) {
        const buffer = toNodeBuffer2(bufferLike);
        const source = buffer.toString("latin1");
        const streams = [];
        const streamPattern = /(<<[\s\S]{0,5000}?>>)\s*stream/g;
        let match;
        while (match = streamPattern.exec(source)) {
          const streamData = getPdfStreamData({
            buffer,
            source,
            dictionary: match[1],
            streamKeywordEnd: streamPattern.lastIndex
          });
          if (!streamData) break;
          streams.push(decodePdfStream(streamData.raw, match[1]));
          streamPattern.lastIndex = streamData.nextOffset;
        }
        const cmap = buildPdfCMap(streams);
        const rawText = streams.map((stream) => extractPdfTextFromContent(stream, cmap)).filter(Boolean).join("\n\n").replace(/\n{3,}/g, "\n\n");
        if (isLowQualityPdfExtraction(rawText)) {
          throw new Error("PDF 文本提取质量过低，已保留原始 PDF 附件。");
        }
        const text = cleanPdfExtractedText2(rawText);
        if (isSuspectPdfGlyphEncoding(text)) {
          throw new Error("PDF 文本层编码异常，已保留原始 PDF 附件。");
        }
        if (!text) {
          throw new Error("PDF 未提取到文本，已保留原始 PDF 附件。");
        }
        return text;
      }
      __name(extractPdfMarkdown2, "extractPdfMarkdown");
      return {
        cleanPdfExtractedText: cleanPdfExtractedText2,
        extractDocxMarkdown: extractDocxMarkdown2,
        extractPdfMarkdown: extractPdfMarkdown2
      };
    }
    __name(createDocumentTextExtractionHelpers2, "createDocumentTextExtractionHelpers");
    module2.exports = {
      createDocumentTextExtractionHelpers: createDocumentTextExtractionHelpers2
    };
  }
});

// src/ai-metadata-utils.js
var require_ai_metadata_utils = __commonJS({
  "src/ai-metadata-utils.js"(exports2, module2) {
    "use strict";
    function isRetryableAiMetadataError(error) {
      const status = Number(error && (error.status || error.statusCode || error.response && error.response.status));
      if (status === 429) return true;
      const message = String(error && (error.message || error) || "").toLowerCase();
      return /(?:status\s*code\s*)?429\b|rate[\s-]?limit|too many requests|请求过于频繁|限流/.test(message);
    }
    __name(isRetryableAiMetadataError, "isRetryableAiMetadataError");
    async function retryAiMetadataGeneration2(generate, options = {}) {
      if (typeof generate !== "function") throw new TypeError("AI metadata generator is required");
      const maxAttempts = Math.max(1, Math.min(Number(options.maxAttempts) || 3, 3));
      const wait = typeof options.wait === "function" ? options.wait : async () => {
      };
      let lastError = null;
      for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
          return await generate();
        } catch (error) {
          lastError = error;
          if (!isRetryableAiMetadataError(error) || attempt >= maxAttempts) throw error;
          await wait(800 * 2 ** (attempt - 1));
        }
      }
      throw lastError || new Error("AI metadata generation failed");
    }
    __name(retryAiMetadataGeneration2, "retryAiMetadataGeneration");
    function requireFunction(value, name) {
      if (typeof value !== "function") {
        throw new TypeError(`AI metadata dependency is required: ${name}`);
      }
      return value;
    }
    __name(requireFunction, "requireFunction");
    function createAiMetadataHelpers2(dependencies = {}) {
      const helpers = {
        tryParseJson: requireFunction(dependencies.tryParseJson, "tryParseJson"),
        cleanMarkdownForStorage: requireFunction(dependencies.cleanMarkdownForStorage, "cleanMarkdownForStorage"),
        stripMarkdownCodeBlocks: requireFunction(dependencies.stripMarkdownCodeBlocks, "stripMarkdownCodeBlocks")
      };
      function normalizeGeneratedKeywords2(value) {
        const source = Array.isArray(value) ? value.join(",") : String(value || "");
        const seen = /* @__PURE__ */ new Set();
        return source.replace(/[\r\n]+/g, ",").split(/[#,\uFF0C\u3001\uFF1B;\s]+/).map((item) => String(item || "").trim()).filter((item) => item && item.length <= 24).filter((item) => {
          const key = item.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        });
      }
      __name(normalizeGeneratedKeywords2, "normalizeGeneratedKeywords");
      function parseGeneratedMetadataResponse2(text) {
        const source = String(text || "").trim();
        if (!source) return { description: "", keywords: [] };
        const fencedJsonMatch = source.match(/```(?:json)?\s*([\s\S]*?)```/i);
        const jsonSource = fencedJsonMatch ? fencedJsonMatch[1].trim() : source;
        const jsonPayload = helpers.tryParseJson(jsonSource);
        if (jsonPayload && typeof jsonPayload === "object") {
          const title = String(jsonPayload.title || jsonPayload.semanticTitle || jsonPayload.headline || "").trim();
          return {
            ...title ? { title } : {},
            description: String(jsonPayload.description || jsonPayload.summary || jsonPayload.excerpt || "").trim(),
            keywords: normalizeGeneratedKeywords2(jsonPayload.keywords || jsonPayload.tags || jsonPayload.hashtags || [])
          };
        }
        const titleMatch = source.match(/title\s*[:：]\s*([^\n]+)/i) || source.match(/标题\s*[:：]\s*([^\n]+)/i);
        const descriptionMatch = source.match(/description\s*[:：]\s*([^\n]+)/i) || source.match(/简介\s*[:：]\s*([^\n]+)/i) || source.match(/总结\s*[:：]\s*([^\n]+)/i);
        const keywordsMatch = source.match(/keywords?\s*[:：]\s*([^\n]+)/i) || source.match(/标签\s*[:：]\s*([^\n]+)/i) || source.match(/关键词\s*[:：]\s*([^\n]+)/i);
        return {
          ...titleMatch ? { title: String(titleMatch[1] || "").trim() } : {},
          description: String(descriptionMatch ? descriptionMatch[1] : "").trim(),
          keywords: normalizeGeneratedKeywords2(keywordsMatch ? keywordsMatch[1] : "")
        };
      }
      __name(parseGeneratedMetadataResponse2, "parseGeneratedMetadataResponse");
      function normalizeGeneratedMetadataResult2(result) {
        const title = String(result && (result.title || result.semanticTitle || result.headline) || "").trim().slice(0, 80);
        return {
          ...title ? { title } : {},
          description: String(result && result.description || "").trim().slice(0, 300),
          keywords: normalizeGeneratedKeywords2(result && result.keywords)
        };
      }
      __name(normalizeGeneratedMetadataResult2, "normalizeGeneratedMetadataResult");
      function extractAiMetadataInputText2(record) {
        const metadata = record && record.metadata || {};
        const isTranscriptRecord = metadata.transcriptOnly || metadata.webpageMediaType === "audio_video" || metadata.transcriptionStatus === "success" && String(metadata.transcription || "").trim();
        const parts = isTranscriptRecord ? [
          metadata.title,
          metadata.transcription
        ].filter(Boolean) : [
          metadata.title,
          metadata.markdown,
          metadata.snapshot,
          metadata.contentSnapshot,
          metadata.description,
          metadata.summary,
          metadata.excerpt
        ].filter(Boolean);
        return helpers.cleanMarkdownForStorage(
          helpers.stripMarkdownCodeBlocks(parts.join("\n\n")).replace(/!\[[^\]]*]\([^)]+\)/g, " ").replace(/\[([^\]]+)]\([^)]+\)/g, "$1").replace(/https?:\/\/[^\s<>()\]]+/gi, " ").replace(/^#{1,6}\s*/gm, "").replace(/^\s*>\s*/gm, "").replace(/\n{3,}/g, "\n\n")
        ).slice(0, 6e3);
      }
      __name(extractAiMetadataInputText2, "extractAiMetadataInputText");
      return {
        normalizeGeneratedKeywords: normalizeGeneratedKeywords2,
        parseGeneratedMetadataResponse: parseGeneratedMetadataResponse2,
        normalizeGeneratedMetadataResult: normalizeGeneratedMetadataResult2,
        extractAiMetadataInputText: extractAiMetadataInputText2
      };
    }
    __name(createAiMetadataHelpers2, "createAiMetadataHelpers");
    module2.exports = {
      createAiMetadataHelpers: createAiMetadataHelpers2,
      isRetryableAiMetadataError,
      retryAiMetadataGeneration: retryAiMetadataGeneration2
    };
  }
});

// src/social-engagement-utils.js
var require_social_engagement_utils = __commonJS({
  "src/social-engagement-utils.js"(exports2, module2) {
    "use strict";
    var METRIC_KEYS = ["views", "likes", "collects", "comments", "shares", "coins"];
    function normalizeMetricCount(value) {
      if (value === void 0 || value === null || value === "") return null;
      if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? Math.round(value) : null;
      const text = String(value).trim().replace(/,/g, "").toLowerCase();
      const match = text.match(/^(\d+(?:\.\d+)?)\s*(万|w|k)?$/i);
      if (!match) return null;
      const amount = Number(match[1]);
      if (!Number.isFinite(amount) || amount < 0) return null;
      const unit = match[2];
      const multiplier = unit === "万" || unit === "w" ? 1e4 : unit === "k" ? 1e3 : 1;
      return Math.round(amount * multiplier);
    }
    __name(normalizeMetricCount, "normalizeMetricCount");
    function getMetricContainerCandidates(source) {
      if (!source || typeof source !== "object" || Array.isArray(source)) return [];
      const nestedKeys = ["statistics", "stats", "interactInfo", "interact_info", "engagement", "data", "stat", "episode", "item", "aweme_detail"];
      const result = [];
      const seen = /* @__PURE__ */ new Set();
      const visit = /* @__PURE__ */ __name((value, depth = 0) => {
        if (!value || typeof value !== "object" || seen.has(value) || depth > 4 || result.length >= 80) return;
        seen.add(value);
        result.push(value);
        nestedKeys.forEach((key) => visit(value[key], depth + 1));
      }, "visit");
      visit(source);
      return result;
    }
    __name(getMetricContainerCandidates, "getMetricContainerCandidates");
    function readMetric(containers, aliases) {
      for (const container of containers) {
        for (const key of aliases) {
          if (!Object.prototype.hasOwnProperty.call(container, key)) continue;
          const normalized = normalizeMetricCount(container[key]);
          if (normalized !== null) return normalized;
        }
      }
      return null;
    }
    __name(readMetric, "readMetric");
    function buildSocialMetrics2(source = {}) {
      const containers = getMetricContainerCandidates(source);
      const metrics = {
        views: readMetric(containers, ["viewCount", "view_count", "playCount", "play_count", "play", "view"]),
        likes: readMetric(containers, ["likedCount", "liked_count", "likeCount", "like_count", "diggCount", "digg_count", "likes", "like"]),
        collects: readMetric(containers, ["collectedCount", "collected_count", "collectCount", "collect_count", "favoriteCount", "favorite_count", "collects", "favorite"]),
        comments: readMetric(containers, ["commentCount", "comment_count", "comments", "reply"]),
        shares: readMetric(containers, ["shareCount", "share_count", "sharedCount", "shared_count", "shares", "share"]),
        coins: readMetric(containers, ["coinCount", "coin_count", "coins", "coin"])
      };
      return Object.fromEntries(Object.entries(metrics).filter(([, value]) => value !== null));
    }
    __name(buildSocialMetrics2, "buildSocialMetrics");
    function buildSocialMetricsFromText(value = "") {
      const source = String(value || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/\s+/g, " ");
      const definitions = {
        views: ["(?:视频)?播放(?:量|数|次数)?"],
        likes: ["(?:点赞|获赞)(?:量|数|次数)?"],
        collects: ["收藏(?:量|数|人数|次数)?"],
        comments: ["(?:评论|回复)(?:量|数|次数)?"],
        shares: ["(?:转发|分享)(?:量|数|人数|次数)?"],
        coins: ["(?:投硬币|硬币)(?:枚数|数|量|次数)?"]
      };
      const metrics = {};
      Object.entries(definitions).forEach(([key, labels]) => {
        for (const label of labels) {
          const match = source.match(new RegExp(`${label}\\s*[:：]?\\s*(\\d+(?:\\.\\d+)?\\s*(?:万|w|k)?)`, "i"));
          if (!match) continue;
          const normalized = normalizeMetricCount(match[1]);
          if (normalized !== null) metrics[key] = normalized;
          break;
        }
      });
      return metrics;
    }
    __name(buildSocialMetricsFromText, "buildSocialMetricsFromText");
    function hasSocialMetrics2(metrics = {}) {
      return METRIC_KEYS.some((key) => Number.isFinite(metrics && metrics[key]));
    }
    __name(hasSocialMetrics2, "hasSocialMetrics");
    function withCapturedSocialMetrics2(metrics = {}, capturedAt = "") {
      if (!hasSocialMetrics2(metrics)) return {};
      const normalized = Object.fromEntries(METRIC_KEYS.filter((key) => Number.isFinite(metrics[key])).map((key) => [key, Math.round(metrics[key])]));
      const timestamp = String(capturedAt || "").trim();
      return timestamp ? { ...normalized, capturedAt: timestamp } : normalized;
    }
    __name(withCapturedSocialMetrics2, "withCapturedSocialMetrics");
    function createSocialMetricsHtmlExtractor2(dependencies = {}) {
      const {
        collectJsonBlocks = /* @__PURE__ */ __name(() => [], "collectJsonBlocks"),
        tryParseJson: tryParseJson2 = /* @__PURE__ */ __name(() => null, "tryParseJson")
      } = dependencies;
      const labels = "(?:视频)?播放(?:量|数|次数)?|点赞(?:量|数|次数)?|收藏(?:量|人数|次数)?|(?:评论|回复)(?:量|数|次数)?|(?:转发|分享)(?:量|人数|次数)?|(?:投币|硬币)(?:枚数|数|量|次数)?";
      const count = "\\d+(?:\\.\\d+)?\\s*(?:万|w|k)?";
      const extractLabeledMetrics = /* @__PURE__ */ __name((html = "") => {
        const pairPattern = new RegExp(
          "<(?:span|div|li|em|strong|button)\\b[^>]*>\\s*(" + labels + ")\\s*<\\/(?:span|div|li|em|strong|button)>\\s*<(?:span|div|li|em|strong|button)\\b[^>]*>\\s*(" + count + ")\\s*<\\/(?:span|div|li|em|strong|button)>",
          "gi"
        );
        const pairs = [];
        let match;
        const source = String(html || "");
        while (match = pairPattern.exec(source)) pairs.push(match[1] + " " + match[2]);
        return buildSocialMetricsFromText(pairs.join(" "));
      }, "extractLabeledMetrics");
      return (html = "") => {
        const blocks = collectJsonBlocks(html, {
          maxBlocks: 20,
          maxBlockCharacters: 1024 * 1024,
          maxTotalCharacters: 2 * 1024 * 1024,
          requiredTexts: ['"stat"', '"statistics"', '"playCount"', '"viewCount"']
        });
        for (const block of blocks) {
          const metrics = buildSocialMetrics2(tryParseJson2(block));
          if (hasSocialMetrics2(metrics)) return metrics;
        }
        return extractLabeledMetrics(html);
      };
    }
    __name(createSocialMetricsHtmlExtractor2, "createSocialMetricsHtmlExtractor");
    module2.exports = {
      buildSocialMetrics: buildSocialMetrics2,
      buildSocialMetricsFromText,
      createSocialMetricsHtmlExtractor: createSocialMetricsHtmlExtractor2,
      hasSocialMetrics: hasSocialMetrics2,
      normalizeMetricCount,
      withCapturedSocialMetrics: withCapturedSocialMetrics2
    };
  }
});

// src/social-media-context-utils.js
var require_social_media_context_utils = __commonJS({
  "src/social-media-context-utils.js"(exports2, module2) {
    "use strict";
    function normalizeSocialMediaImageUrl(value) {
      const normalized = String(value || "").replace(/&amp;/gi, "&").replace(/\\u002F/g, "/").replace(/\\\//g, "/").trim();
      if (!normalized || /^data:|^blob:/i.test(normalized)) return "";
      if (normalized.startsWith("//")) return `https:${normalized}`;
      return /^https?:\/\//i.test(normalized) ? normalized : "";
    }
    __name(normalizeSocialMediaImageUrl, "normalizeSocialMediaImageUrl");
    function normalizeSocialMediaTags(value) {
      const source = Array.isArray(value) ? value : String(value || "").split(/[,，、\s]+/);
      return Array.from(new Set(source.map((tag) => String(tag || "").trim()).filter(Boolean).map((tag) => tag.startsWith("#") ? tag : `#${tag}`)));
    }
    __name(normalizeSocialMediaTags, "normalizeSocialMediaTags");
    function buildSocialMediaSupplementalMarkdown2({
      title = "",
      description = "",
      tags = [],
      imageUrls = []
    } = {}) {
      const cleanedTitle = String(title || "").trim();
      const cleanedDescription = String(description || "").trim();
      const normalizedTags = normalizeSocialMediaTags(tags);
      const normalizedImages = Array.from(new Set((Array.isArray(imageUrls) ? imageUrls : []).map(normalizeSocialMediaImageUrl).filter(Boolean)));
      const lines = [];
      if (cleanedTitle) lines.push("## 标题", "", cleanedTitle, "");
      if (cleanedDescription) lines.push("## 原文正文", "", cleanedDescription, "");
      if (normalizedTags.length) lines.push("## 标签", "", normalizedTags.join(" "), "");
      if (normalizedImages.length) lines.push("## 封面图", "", `![封面](${normalizedImages[0]})`, "");
      return lines.join("\n").trim();
    }
    __name(buildSocialMediaSupplementalMarkdown2, "buildSocialMediaSupplementalMarkdown");
    function createSocialMediaContextHtmlBuilder2(dependencies = {}) {
      const {
        extractPageMetadata,
        extractTagsFromText: extractTagsFromText2,
        extractMetaContent: extractMetaContent2,
        collectImageUrls,
        normalizeUrl,
        isBilibiliUrl: isBilibiliUrl2
      } = dependencies;
      return (html, url = "") => {
        const metadata = typeof extractPageMetadata === "function" ? extractPageMetadata(html, url) || {} : {};
        const tags = typeof extractTagsFromText2 === "function" ? extractTagsFromText2(metadata.description, html) : [];
        const cover = typeof extractMetaContent2 === "function" && typeof normalizeUrl === "function" ? normalizeUrl(extractMetaContent2(html, ["og:image", "twitter:image"])) : "";
        const isPlaceholder = /* @__PURE__ */ __name((imageUrl) => typeof isBilibiliUrl2 === "function" && isBilibiliUrl2(url) && /\/bfs\/static\/jinkela\/|\/long\/images\/512\.(?:png|jpe?g|webp)(?:[?#]|$)/i.test(String(imageUrl || "")), "isPlaceholder");
        return buildSocialMediaSupplementalMarkdown2({
          title: metadata.title,
          description: metadata.description,
          tags: Array.isArray(tags) && tags.length ? tags : metadata.keywords,
          imageUrls: [cover, ...typeof collectImageUrls === "function" ? collectImageUrls(html) : []].filter(Boolean).filter((imageUrl) => !isPlaceholder(imageUrl))
        });
      };
    }
    __name(createSocialMediaContextHtmlBuilder2, "createSocialMediaContextHtmlBuilder");
    module2.exports = {
      buildSocialMediaSupplementalMarkdown: buildSocialMediaSupplementalMarkdown2,
      createSocialMediaContextHtmlBuilder: createSocialMediaContextHtmlBuilder2,
      normalizeSocialMediaImageUrl
    };
  }
});

// src/social-platform-content-utils.js
var require_social_platform_content_utils = __commonJS({
  "src/social-platform-content-utils.js"(exports2, module2) {
    "use strict";
    function collectDouyinImageUrlList(value, urls) {
      if (!value) return;
      if (typeof value === "string") {
        urls.push(value);
        return;
      }
      if (Array.isArray(value)) {
        value.forEach((item) => collectDouyinImageUrlList(item, urls));
        return;
      }
      if (typeof value === "object") {
        collectDouyinImageUrlList(value.url_list, urls);
        collectDouyinImageUrlList(value.urlList, urls);
        collectDouyinImageUrlList(value.url, urls);
        collectDouyinImageUrlList(value.uri, urls);
      }
    }
    __name(collectDouyinImageUrlList, "collectDouyinImageUrlList");
    function createDouyinStructuredContentBuilder2(dependencies = {}) {
      const {
        cleanDescription = /* @__PURE__ */ __name((value) => String(value || "").trim(), "cleanDescription"),
        extractTags = /* @__PURE__ */ __name(() => [], "extractTags"),
        buildMetrics = /* @__PURE__ */ __name(() => ({}), "buildMetrics"),
        hasMetrics = /* @__PURE__ */ __name(() => false, "hasMetrics"),
        isGenericTitle = /* @__PURE__ */ __name(() => false, "isGenericTitle"),
        deriveTitle = /* @__PURE__ */ __name(() => "", "deriveTitle"),
        normalizeUrl = /* @__PURE__ */ __name((value) => String(value || "").trim(), "normalizeUrl")
      } = dependencies;
      return (detail = {}, fallback = {}) => {
        const source = detail && typeof detail === "object" ? detail : {};
        const fallbackSource = fallback && typeof fallback === "object" ? fallback : {};
        const description = cleanDescription(
          source.desc || source.description || fallbackSource.description || ""
        );
        const title = [
          source.title,
          source.preview_title,
          source.previewTitle,
          fallbackSource.title
        ].map((candidate) => cleanDescription(candidate || "")).find((candidate) => candidate && candidate !== description && candidate.length <= 80 && !candidate.includes("\n") && !isGenericTitle(candidate)) || deriveTitle(description);
        const structuredTags = [];
        const rememberTag = /* @__PURE__ */ __name((value) => {
          const tag = String(value || "").replace(/^#+/, "").trim();
          if (tag && !structuredTags.includes(tag)) structuredTags.push(tag);
        }, "rememberTag");
        (Array.isArray(source.text_extra) ? source.text_extra : []).forEach((item) => {
          rememberTag(item && (item.hashtag_name || item.hashtagName));
        });
        (Array.isArray(source.cha_list) ? source.cha_list : []).forEach((item) => {
          rememberTag(item && (item.cha_name || item.chaName));
        });
        const extractedTags = extractTags(description);
        (Array.isArray(extractedTags) ? extractedTags : []).forEach(rememberTag);
        if (!structuredTags.length) {
          (Array.isArray(fallbackSource.tags) ? fallbackSource.tags : []).forEach(rememberTag);
        }
        const video = source.video && typeof source.video === "object" ? source.video : {};
        const coverUrls = [];
        [
          video.cover,
          video.origin_cover,
          video.originCover,
          video.dynamic_cover,
          video.dynamicCover,
          video.animated_cover,
          video.animatedCover
        ].forEach((value) => collectDouyinImageUrlList(value, coverUrls));
        const coverUrl = coverUrls.map((value) => normalizeUrl(value)).find(Boolean) || normalizeUrl(fallbackSource.coverUrl);
        const socialMetrics = buildMetrics(source);
        return {
          title,
          description,
          tags: structuredTags,
          coverUrl,
          socialMetrics: hasMetrics(socialMetrics) ? socialMetrics : fallbackSource.socialMetrics || {}
        };
      };
    }
    __name(createDouyinStructuredContentBuilder2, "createDouyinStructuredContentBuilder");
    module2.exports = {
      createDouyinStructuredContentBuilder: createDouyinStructuredContentBuilder2
    };
  }
});

// src/social-media-diagnostic-utils.js
var require_social_media_diagnostic_utils = __commonJS({
  "src/social-media-diagnostic-utils.js"(exports2, module2) {
    "use strict";
    function createDouyinMediaResolutionDiagnosticBuilder2(dependencies = {}) {
      const {
        getSafeUrlDiagnostic: getSafeUrlDiagnostic2 = /* @__PURE__ */ __name(() => ({ protocol: "", host: "" }), "getSafeUrlDiagnostic"),
        getTransportErrorDiagnostic: getTransportErrorDiagnostic2 = /* @__PURE__ */ __name(() => ({}), "getTransportErrorDiagnostic")
      } = dependencies;
      return ({
        sourceUrl = "",
        resolvedUrl = "",
        awemeId = "",
        stages = [],
        mediaCandidateCount = 0,
        preciseMediaFound = false,
        saveOriginalMediaEnabled = false
      } = {}) => ({
        source: getSafeUrlDiagnostic2(sourceUrl),
        resolved: getSafeUrlDiagnostic2(resolvedUrl),
        awemeId: String(awemeId || "").slice(0, 64),
        mediaCandidateCount: Number(mediaCandidateCount) || 0,
        preciseMediaFound: preciseMediaFound === true,
        saveOriginalMediaEnabled: saveOriginalMediaEnabled === true,
        stages: (Array.isArray(stages) ? stages : []).slice(-12).map((stage) => ({
          stage: String(stage && stage.stage || "").slice(0, 64),
          ok: stage && stage.ok !== false,
          mediaCount: Number(stage && stage.mediaCount) || 0,
          detailFound: stage && stage.detailFound === true,
          error: stage && stage.error ? getTransportErrorDiagnostic2(stage.error) : void 0
        }))
      });
    }
    __name(createDouyinMediaResolutionDiagnosticBuilder2, "createDouyinMediaResolutionDiagnosticBuilder");
    module2.exports = {
      createDouyinMediaResolutionDiagnosticBuilder: createDouyinMediaResolutionDiagnosticBuilder2
    };
  }
});

// src/xiaohongshu-markdown-utils.js
var require_xiaohongshu_markdown_utils = __commonJS({
  "src/xiaohongshu-markdown-utils.js"(exports2, module2) {
    "use strict";
    var DEFAULT_TITLE = "小红书笔记";
    var DEFAULT_DESCRIPTION = "页面未直接暴露正文，原始链接已写入笔记属性。";
    function createXiaohongshuMarkdownBuilder2(dependencies = {}) {
      const { buildCommentsMarkdown = /* @__PURE__ */ __name(() => "", "buildCommentsMarkdown") } = dependencies;
      return ({
        title = DEFAULT_TITLE,
        description = "",
        tags = [],
        imageUrls = [],
        videoUrl = "",
        comments = []
      } = {}) => {
        const images = Array.isArray(imageUrls) ? imageUrls : [];
        const normalizedTags = Array.isArray(tags) ? tags : [];
        const lines = [
          "## 标题",
          "",
          title,
          "",
          "## 正文",
          "",
          description || DEFAULT_DESCRIPTION,
          ""
        ];
        if (normalizedTags.length) {
          lines.push("## 标签", "", normalizedTags.join(" "), "");
        }
        if (images.length) {
          lines.push("## 图片", "", "### 封面", "", "![封面](" + images[0] + ")", "");
          if (images.length > 1) {
            lines.push("### 内页图", "");
            images.slice(1).forEach((image, index) => {
              lines.push("![内页图 " + (index + 1) + "](" + image + ")", "");
            });
          }
        }
        if (videoUrl) {
          lines.push("## 视频源", "", "[视频文件](" + videoUrl + ")", "");
        }
        const commentsMarkdown = buildCommentsMarkdown(comments);
        if (commentsMarkdown) {
          lines.push(commentsMarkdown, "");
        }
        return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
      };
    }
    __name(createXiaohongshuMarkdownBuilder2, "createXiaohongshuMarkdownBuilder");
    function createXiaohongshuCommentMarkdownHelpers2(dependencies = {}) {
      const { buildCommentsMarkdown = /* @__PURE__ */ __name(() => "", "buildCommentsMarkdown") } = dependencies;
      const commentHeadingPattern = /^##\s+\u8bc4\u8bba\u533a\s*$/u;
      const nextHeadingPattern = /^##\s+\S/u;
      const diagnosticPattern = /\n*<!-- xhs-comment-diag:[\s\S]*?-->\s*$/u;
      const diagnosticLiteralPattern = /^<!-- xhs-comment-diag: [\s\S]* -->$/u;
      const buildCommentDiagnostic = /* @__PURE__ */ __name((details = {}) => {
        const source = String(details.source || "unknown").replace(/[^a-z0-9_-]/gi, "").slice(0, 40) || "unknown";
        const toCount = /* @__PURE__ */ __name((value) => Math.max(0, Math.floor(Number(value) || 0)), "toCount");
        const toLabel = /* @__PURE__ */ __name((value, fallback = "unknown") => String(value || fallback).replace(/[^a-z0-9_-]/gi, "").slice(0, 60) || fallback, "toLabel");
        const scrollMode = toLabel(details.scrollMode);
        const pageApiStopReason = toLabel(details.pageApiStopReason);
        const stopReason = String(details.stopReason || "unknown").replace(/[^a-z0-9_-]/gi, "").slice(0, 60) || "unknown";
        return "<!-- xhs-comment-diag: source=" + source + "; root=" + toCount(details.rootCount) + "; replies=" + toCount(details.replyCount) + "; pages=" + toCount(details.pageCount) + "; root_pages=" + toCount(details.rootPageCount) + "; reply_pages=" + toCount(details.replyPageCount) + "; root_requests=" + toCount(details.rootRequestCount) + "; reply_requests=" + toCount(details.replyRequestCount) + "; merged_root=" + toCount(details.mergedRootCount) + "; merged_replies=" + toCount(details.mergedReplyCount) + "; restored_root=" + toCount(details.restoredRootCount) + "; restored_replies=" + toCount(details.restoredReplyCount) + "; final_root=" + toCount(details.finalRootCount) + "; final_replies=" + toCount(details.finalReplyCount) + "; lost_root=" + toCount(details.lostRootCount) + "; lost_replies=" + toCount(details.lostReplyCount) + "; fallback=" + toCount(details.fallbackAddedCount) + "; deduped=" + toCount(details.dedupedFallbackCount) + "; dropped=" + toCount(details.droppedFallbackCount) + "; unmatched=" + toCount(details.unmatchedReplyCount) + "; invalid=" + toCount(details.invalidPayloadCount) + "; partial=" + (details.partial ? 1 : 0) + "; scroll=" + scrollMode + "; api_stop=" + pageApiStopReason + "; stop=" + stopReason + " -->";
      }, "buildCommentDiagnostic");
      const stripComments = /* @__PURE__ */ __name((markdown = "") => {
        const source = String(markdown || "").replace(diagnosticPattern, "").trim();
        if (!source) return "";
        const kept = [];
        let skippingComments = false;
        source.split(/\r?\n/).forEach((line) => {
          if (commentHeadingPattern.test(line.trim())) {
            skippingComments = true;
            return;
          }
          if (skippingComments && nextHeadingPattern.test(line.trim())) {
            skippingComments = false;
          }
          if (!skippingComments) kept.push(line);
        });
        return kept.join("\n").replace(/\n{3,}/g, "\n\n").trim();
      }, "stripComments");
      return {
        buildCommentDiagnostic,
        appendCommentDiagnostic(markdown, details = {}) {
          const source = String(markdown || "").trim().replace(diagnosticPattern, "").trim();
          if (!source) return source;
          const diagnostic = typeof details === "string" && diagnosticLiteralPattern.test(details) ? details : buildCommentDiagnostic(details);
          return source + "\n\n" + diagnostic;
        },
        stripComments,
        replaceComments(markdown, comments = []) {
          const source = stripComments(markdown);
          const commentMarkdown = buildCommentsMarkdown(comments);
          return [source, commentMarkdown].filter(Boolean).join("\n\n").trim();
        }
      };
    }
    __name(createXiaohongshuCommentMarkdownHelpers2, "createXiaohongshuCommentMarkdownHelpers");
    module2.exports = {
      DEFAULT_DESCRIPTION,
      DEFAULT_TITLE,
      createXiaohongshuCommentMarkdownHelpers: createXiaohongshuCommentMarkdownHelpers2,
      createXiaohongshuMarkdownBuilder: createXiaohongshuMarkdownBuilder2
    };
  }
});

// src/social-comments-markdown-utils.js
var require_social_comments_markdown_utils = __commonJS({
  "src/social-comments-markdown-utils.js"(exports2, module2) {
    "use strict";
    function createSocialCommentsMarkdownBuilder2(dependencies = {}) {
      const {
        normalizeComment = /* @__PURE__ */ __name((comment) => comment, "normalizeComment"),
        formatTime = /* @__PURE__ */ __name((value) => String(value || "").trim(), "formatTime"),
        formatLikes = /* @__PURE__ */ __name((value) => String(value || "").trim(), "formatLikes")
      } = dependencies;
      return (comments = []) => {
        const items = (comments || []).map((comment) => normalizeComment(comment)).filter(Boolean);
        if (!items.length) return "";
        const lines = ["## 评论区", ""];
        const appendComment = /* @__PURE__ */ __name((comment, indent = "", reply = false) => {
          const meta = [formatTime(comment.time), formatLikes(comment.likes)].filter(Boolean).join(" · ");
          const prefix = comment.author ? "**" + comment.author + "**：" : "";
          lines.push(
            indent + "- " + (reply ? "↳ " : "") + prefix + comment.content + (meta ? "（" + meta + "）" : "")
          );
          (Array.isArray(comment.replies) ? comment.replies : []).forEach((child) => {
            appendComment(child, indent + "  ", true);
          });
        }, "appendComment");
        items.forEach((comment) => appendComment(comment));
        return lines.join("\n").trim();
      };
    }
    __name(createSocialCommentsMarkdownBuilder2, "createSocialCommentsMarkdownBuilder");
    function createSocialCommentSectionHelpers2(dependencies = {}) {
      const { buildCommentsMarkdown = /* @__PURE__ */ __name(() => "", "buildCommentsMarkdown") } = dependencies;
      const sectionHeading = "## 评论区";
      const sectionLinePattern = /^##\s+\u8bc4\u8bba\u533a\s*$/u;
      const sectionStartPattern = /(^|\n)##\s+\u8bc4\u8bba\u533a(?:\s|\n|$)/u;
      const sectionSplitPattern = /(^|\n)##\s+\u8bc4\u8bba\u533a\s*(?:\n|$)/u;
      const commentLinePattern = /^(\s*)-\s+(?:\u21b3\s+)?/u;
      const hasCommentsSection = /* @__PURE__ */ __name((markdown = "") => sectionStartPattern.test(String(markdown || "")), "hasCommentsSection");
      return {
        hasCommentsSection,
        getStats(markdown = "") {
          let rootCount = 0;
          let replyCount = 0;
          let inComments = false;
          String(markdown || "").split(/\r?\n/).forEach((line) => {
            if (sectionLinePattern.test(line.trim())) {
              inComments = true;
              return;
            }
            if (inComments && /^##\s+/.test(line.trim())) {
              inComments = false;
              return;
            }
            if (!inComments) return;
            const match = line.match(commentLinePattern);
            if (!match) return;
            if (match[1].length > 0) replyCount += 1;
            else rootCount += 1;
          });
          return { rootCount, replyCount };
        },
        appendComments(markdown, comments = []) {
          const source = String(markdown || "").trim();
          if (!source || hasCommentsSection(source)) return source;
          const commentMarkdown = buildCommentsMarkdown(comments);
          return commentMarkdown ? source + "\n\n" + commentMarkdown : source;
        },
        splitComments(markdown = "") {
          const source = String(markdown || "").trim();
          if (!source) return { markdown: "", trailingMarkdown: "" };
          const match = sectionSplitPattern.exec(source);
          if (!match) return { markdown: source, trailingMarkdown: "" };
          const sectionStart = match.index + (match[1] ? match[1].length : 0);
          return {
            markdown: source.slice(0, sectionStart).trim(),
            trailingMarkdown: source.slice(sectionStart).trim()
          };
        },
        sectionHeading
      };
    }
    __name(createSocialCommentSectionHelpers2, "createSocialCommentSectionHelpers");
    module2.exports = {
      createSocialCommentSectionHelpers: createSocialCommentSectionHelpers2,
      createSocialCommentsMarkdownBuilder: createSocialCommentsMarkdownBuilder2
    };
  }
});

// src/transcription-note-title-utils.js
var require_transcription_note_title_utils = __commonJS({
  "src/transcription-note-title-utils.js"(exports2, module2) {
    "use strict";
    var MAX_SEMANTIC_TITLE_LENGTH = 36;
    var GENERIC_TRANSCRIPTION_TITLE = /^(?:抖音|视频号|B站|哔哩哔哩|小宇宙|网页|音频|视频|录音|文件)?[-\s]*(?:口播文案|音频文案|视频文案|转写文案|转写内容)$/i;
    var SHORT_GREETING = /^(?:大家好|你好|您好|哈喽|hello|嗨|嗯+|啊+|呃+)$/i;
    function getMetadata(record) {
      return record && record.metadata && typeof record.metadata === "object" ? record.metadata : {};
    }
    __name(getMetadata, "getMetadata");
    function isSuccessfulTranscriptionRecord2(record) {
      const metadata = getMetadata(record);
      return String(metadata.transcriptionStatus || "").toLowerCase() === "success" && Boolean(String(metadata.transcription || "").trim());
    }
    __name(isSuccessfulTranscriptionRecord2, "isSuccessfulTranscriptionRecord");
    function inferPlatformFromUrl(value) {
      const url = String(value || "").toLowerCase();
      if (/xiaohongshu\.com|xhslink\.cn|xhslink\.com/.test(url)) return "小红书";
      if (/douyin\.com|iesdouyin\.com/.test(url)) return "抖音";
      if (/channels\.weixin\.qq\.com|finder\.video\.qq\.com/.test(url)) return "视频号";
      if (/bilibili\.com|b23\.tv/.test(url)) return "B站";
      if (/xiaoyuzhoufm\.com|xiaoeknow\.com/.test(url)) return "小宇宙";
      return "";
    }
    __name(inferPlatformFromUrl, "inferPlatformFromUrl");
    function cleanTitlePart(value, maxLength = MAX_SEMANTIC_TITLE_LENGTH) {
      const normalized = String(value || "").replace(/```[\s\S]*?```/g, " ").replace(/^#{1,6}\s*/gm, "").replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "").replace(/[\\/:*?"<>|]+/g, "-").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").replace(/^[\s\-—–_，。！？!?：:；;、“”‘’'"【】\[\]（）()]+/, "").replace(/[\s\-—–_，。！？!?：:；;、“”‘’'"【】\[\]（）()]+$/, "").trim();
      return Array.from(normalized).slice(0, maxLength).join("").trim();
    }
    __name(cleanTitlePart, "cleanTitlePart");
    function stripSourcePrefix(value, source) {
      const title = cleanTitlePart(value);
      const normalizedSource = cleanTitlePart(source, 16);
      if (!title || !normalizedSource) return title;
      const prefixes = [
        `${normalizedSource}-`,
        `${normalizedSource}：`,
        `${normalizedSource}:`,
        `${normalizedSource} `
      ];
      for (const prefix of prefixes) {
        if (title.toLowerCase().startsWith(prefix.toLowerCase())) {
          return cleanTitlePart(title.slice(prefix.length));
        }
      }
      return title;
    }
    __name(stripSourcePrefix, "stripSourcePrefix");
    function getTranscriptionSourcePrefix2(record) {
      const metadata = getMetadata(record);
      const explicitPlatform = cleanTitlePart(metadata.platform || metadata.platformName, 16);
      if (explicitPlatform) return explicitPlatform;
      const inferredPlatform = inferPlatformFromUrl(metadata.url || metadata.originalUrl || record && record.content);
      if (inferredPlatform) return inferredPlatform;
      const type = String(record && record.type || "").toLowerCase();
      if (type === "voice") return "录音";
      if (type === "file") {
        const category = cleanTitlePart(metadata.contentCategory, 8);
        if (/视频/.test(category)) return "视频";
        if (/音频|录音/.test(category)) return "音频";
        const ext = String(metadata.fileExt || metadata.fileName || "").toLowerCase();
        if (/\.(?:mp4|mov|m4v|mkv|webm)$|^(?:mp4|mov|m4v|mkv|webm)$/.test(ext)) return "视频";
        if (/\.(?:mp3|wav|m4a|aac|flac|ogg|opus)$|^(?:mp3|wav|m4a|aac|flac|ogg|opus)$/.test(ext)) return "音频";
      }
      return "音视频";
    }
    __name(getTranscriptionSourcePrefix2, "getTranscriptionSourcePrefix");
    function getMeaningfulTranscriptSentence(transcription) {
      const sentences = String(transcription || "").replace(/\s+/g, " ").split(/[。！？!?；;\n]+/).map((item) => cleanTitlePart(item)).filter(Boolean);
      return sentences.find((item) => item.length >= 8 && !SHORT_GREETING.test(item)) || sentences.find((item) => item.length >= 5 && !SHORT_GREETING.test(item)) || "";
    }
    __name(getMeaningfulTranscriptSentence, "getMeaningfulTranscriptSentence");
    function buildTitleFromGeneratedDescription(description) {
      const source = String(description || "").replace(/\s+/g, " ").trim();
      if (!source) return "";
      const topicMatch = source.match(/(?:详细)?(?:介绍|讲解|分享|说明|总结|讨论|分析)(?:了|的是)?\s*([^，。！？；;]+)/);
      if (topicMatch && topicMatch[1]) {
        return cleanTitlePart(topicMatch[1]);
      }
      const withoutReportPrefix = source.replace(/^(?:这是一(?:份|段|篇)|本文|本视频|这段视频|该视频|这段音频|本期(?:视频|节目)?)[^，。！？；;]{0,24}[，,:：]\s*/, "").replace(/^(?:主要|重点)(?:介绍|讲解|分享|说明|讨论|分析)(?:了|的是)?\s*/, "");
      const firstTopicClause = withoutReportPrefix.split(/[，。！？；;]/)[0] || "";
      return cleanTitlePart(firstTopicClause);
    }
    __name(buildTitleFromGeneratedDescription, "buildTitleFromGeneratedDescription");
    function getFileNameStem(fileName) {
      return String(fileName || "").replace(/\.[A-Za-z0-9]{1,8}$/, "");
    }
    __name(getFileNameStem, "getFileNameStem");
    function buildTitleFromKeywords(keywords) {
      const values = (Array.isArray(keywords) ? keywords : String(keywords || "").split(/[,，、\s]+/)).map((item) => cleanTitlePart(item, 18)).filter(Boolean).filter((item, index, list) => list.indexOf(item) === index).slice(0, 2);
      return values.join("-");
    }
    __name(buildTitleFromKeywords, "buildTitleFromKeywords");
    function extractSourceTitleFromMarkdown(markdown = "") {
      const match = String(markdown || "").match(/(?:^|\n)##\s*标题\s*\n+([^\n]+)/i);
      return cleanTitlePart(match && match[1] || "");
    }
    __name(extractSourceTitleFromMarkdown, "extractSourceTitleFromMarkdown");
    function getCanonicalSourceTitleCandidate(record) {
      const metadata = getMetadata(record);
      const source = getTranscriptionSourcePrefix2(record);
      const sourceTitle = cleanTitlePart(metadata.sourceTitle || metadata.platformTitle || "");
      if (!["抖音", "小红书", "B站", "小宇宙", "视频号"].includes(source)) {
        return { title: "", titleSource: "" };
      }
      if (sourceTitle && sourceTitle.toLowerCase() !== source.toLowerCase() && !GENERIC_TRANSCRIPTION_TITLE.test(sourceTitle)) {
        return { title: sourceTitle, titleSource: "source-title" };
      }
      const markdownTitle = extractSourceTitleFromMarkdown(metadata.markdown);
      if (markdownTitle && markdownTitle.toLowerCase() !== source.toLowerCase() && !GENERIC_TRANSCRIPTION_TITLE.test(markdownTitle)) {
        return { title: markdownTitle, titleSource: "source-markdown-title" };
      }
      return { title: "", titleSource: "" };
    }
    __name(getCanonicalSourceTitleCandidate, "getCanonicalSourceTitleCandidate");
    function buildSemanticTitleCandidate(record, fallbackTitle = "") {
      const metadata = getMetadata(record);
      const source = getTranscriptionSourcePrefix2(record);
      const sourceTitleCandidate = getCanonicalSourceTitleCandidate(record);
      if (sourceTitleCandidate.title) return sourceTitleCandidate;
      const keywordTitle = buildTitleFromKeywords(metadata.keywords);
      const shouldPreferKeywordTitle = source === "录音" || source === "音频";
      if (shouldPreferKeywordTitle && keywordTitle && !GENERIC_TRANSCRIPTION_TITLE.test(keywordTitle)) {
        return { title: keywordTitle, titleSource: "keywords" };
      }
      const semanticTitle = cleanTitlePart(metadata.semanticTitle || metadata.aiTitle);
      if (semanticTitle && !GENERIC_TRANSCRIPTION_TITLE.test(semanticTitle)) {
        return { title: semanticTitle, titleSource: "ai-title" };
      }
      if (keywordTitle && !GENERIC_TRANSCRIPTION_TITLE.test(keywordTitle)) {
        return { title: keywordTitle, titleSource: "keywords" };
      }
      const transcriptSentence = getMeaningfulTranscriptSentence(metadata.transcription);
      if (transcriptSentence) return { title: transcriptSentence, titleSource: "transcription" };
      const fileName = cleanTitlePart(getFileNameStem(metadata.fileName || ""));
      if (fileName && !GENERIC_TRANSCRIPTION_TITLE.test(fileName)) {
        return { title: fileName, titleSource: "file-name" };
      }
      const originalTitle = cleanTitlePart(metadata.title || record && record.title || "");
      if (originalTitle && !GENERIC_TRANSCRIPTION_TITLE.test(originalTitle)) {
        return { title: originalTitle, titleSource: "original-title" };
      }
      const fallback = cleanTitlePart(fallbackTitle);
      if (fallback && !GENERIC_TRANSCRIPTION_TITLE.test(fallback)) {
        return { title: fallback, titleSource: "fallback" };
      }
      return { title: "转写内容", titleSource: "fallback" };
    }
    __name(buildSemanticTitleCandidate, "buildSemanticTitleCandidate");
    function buildSemanticTranscriptionTitle2(record, fallbackTitle = "") {
      const source = getTranscriptionSourcePrefix2(record);
      const candidate = buildSemanticTitleCandidate(record, fallbackTitle);
      return stripSourcePrefix(candidate.title, source) || "转写内容";
    }
    __name(buildSemanticTranscriptionTitle2, "buildSemanticTranscriptionTitle");
    function buildTranscriptionNoteIdentity2(record, options = {}) {
      if (!isSuccessfulTranscriptionRecord2(record)) return null;
      const source = getTranscriptionSourcePrefix2(record);
      const fallbackWithoutBinding = stripSourcePrefix(options.fallbackTitle || "", options.bindingLabel || "");
      const semanticFallbackTitle = stripSourcePrefix(fallbackWithoutBinding, source);
      const candidate = buildSemanticTitleCandidate(record, semanticFallbackTitle);
      const displayTitle = stripSourcePrefix(candidate.title, source) || "转写内容";
      const bindingLabel = cleanTitlePart(options.bindingLabel || "", 24);
      const fileTitle = [bindingLabel, source, displayTitle].filter(Boolean).join("-");
      return {
        displayTitle,
        fileTitle,
        source,
        titleSource: candidate.titleSource
      };
    }
    __name(buildTranscriptionNoteIdentity2, "buildTranscriptionNoteIdentity");
    function applyTranscriptionNoteIdentity2(record, options = {}) {
      const identity = buildTranscriptionNoteIdentity2(record, options);
      if (!identity) {
        return {
          record,
          displayTitle: options.fallbackTitle || "",
          fileTitle: options.fallbackTitle || "",
          source: "",
          titleSource: ""
        };
      }
      const metadata = getMetadata(record);
      const originalTitle = String(metadata.originalTitle || metadata.title || "").trim();
      return {
        ...identity,
        record: {
          ...record,
          metadata: {
            ...metadata,
            ...originalTitle && originalTitle !== identity.displayTitle ? { originalTitle } : {},
            title: identity.displayTitle,
            semanticTitleSource: identity.titleSource
          }
        }
      };
    }
    __name(applyTranscriptionNoteIdentity2, "applyTranscriptionNoteIdentity");
    module2.exports = {
      MAX_SEMANTIC_TITLE_LENGTH,
      applyTranscriptionNoteIdentity: applyTranscriptionNoteIdentity2,
      buildSemanticTranscriptionTitle: buildSemanticTranscriptionTitle2,
      buildTitleFromKeywords,
      buildTitleFromGeneratedDescription,
      buildTranscriptionNoteIdentity: buildTranscriptionNoteIdentity2,
      getTranscriptionSourcePrefix: getTranscriptionSourcePrefix2,
      isSuccessfulTranscriptionRecord: isSuccessfulTranscriptionRecord2
    };
  }
});

// src/main.js
var crypto = require("crypto");
var childProcess = require("child_process");
var fs = require("fs");
var http = require("http");
var https = require("https");
var os = require("os");
var path = require("path");
var {
  Modal,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  requestUrl
} = require("obsidian");
var {
  formatCreatedTime,
  getChinaTimeParts,
  getDateFolderName,
  getTitleTimePart,
  pad2
} = require_date_utils();
var {
  assertUsableTranscription,
  createTranscriptionQualityError,
  getTranscriptionQualityIssue,
  getTranscriptionQualityUnits,
  normalizeTranscriptionQualityUnit
} = require_transcription_quality_utils();
var {
  extractOpenAICompatibleText,
  formatHttpError,
  parseAliyunTranscriptionResult,
  parseDoubaoAsrResult,
  parseDoubaoAsrTaskState,
  parseTencentCreateTaskResponse,
  parseTencentTaskStatusResponse,
  tryParseJson
} = require_cloud_transcription_response_utils();
var {
  generateWechatChannelsDecryptorBytes,
  decryptWechatChannelsMediaBuffer
} = require_wechat_channels_decrypt_utils();
var {
  stripMarkdownCodeBlocks,
  normalizeTitleForCompare,
  normalizeFeishuMarkdownLine,
  shouldDropFeishuLine,
  formatFeishuHeadingLine,
  isFeishuCodeLanguageLine,
  postProcessFeishuMarkdown,
  isFeishuMarkdownLikelyTruncated
} = require_feishu_markdown_utils();
var {
  buildConversionWarningsNotice,
  buildLocalAsrProgressKey,
  buildSkippedSyncNotice,
  buildSyncNotice,
  buildSyncProgressMessage,
  buildSyncResultNotice,
  formatProgressElapsed,
  isProgressHeartbeatStale,
  normalizeProgressPercent,
  parseLocalAsrProgressLog
} = require_progress_notice_utils();
var {
  buildAiMetadataConversionWarning,
  buildAiMetadataErrorComment,
  classifyAiMetadataError
} = require_ai_metadata_error_utils();
var {
  redactKnownCredentials,
  redactSensitiveObject
} = require_diagnostic_redaction_utils();
var {
  normalizeConfiguredVaultPath,
  normalizeVaultPath,
  shouldPersistNormalizedInboxDir
} = require_vault_path_utils();
var {
  normalizeBindCodeInput,
  normalizeNotePropertyFields: normalizeNotePropertyFieldsWithKeys,
  normalizeNoteSaveMode: normalizeNoteSaveModeWithDefaults
} = require_input_normalization_utils();
var {
  enrichExtractedWebpageMetadata,
  extractKeywordsFromText,
  getRecordAuthor,
  getRecordDescription,
  getRecordKeywords,
  stripMarkdownForDescription
} = require_record_metadata_utils();
var {
  isAudioVideoTranscriptionIncompleteRecord,
  isCloudTranscriptionWaitingRecord
} = require_record_state_utils();
var {
  buildRecordIdMarker,
  getFrontmatterBlock,
  getFrontmatterScalar,
  getRecordIdFromFrontmatter,
  getRecordIdFromHiddenMarker,
  getRecordIdFromMarkdown,
  hasRecordIdInFrontmatter,
  hasRecordUrlInFrontmatter,
  normalizeRecordUrlForCompare,
  normalizeYamlScalar
} = require_record_identity_utils();
var {
  categorizeSyncFailure,
  getSyncLifecycleBindingFingerprint,
  getSyncLifecycleOutcomeError,
  getSyncNoteTitleFromPath,
  isExistingLocalNoteDeliverable,
  isLegacySyncLifecycleError,
  isSyncRecordBusyError,
  normalizePendingSyncLifecycleAttempts,
  sanitizeSyncNoteTitle
} = require_sync_lifecycle_utils();
var { createNoteOutputPlanHelpers } = require_note_output_plan_utils();
var { createRecordBodyMarkdownHelpers } = require_record_body_markdown_utils();
var {
  decodeDataUrl,
  decodeUtf8ArrayBuffer,
  getAttachmentExt,
  getAudioFormatFromUrl,
  getImageDimensionsFromBuffer,
  getImageExtFromBuffer,
  getImageExtFromMime,
  getImageFileExtension,
  getInvalidDownloadedMediaReason,
  hasVideoTrackInMediaBuffer,
  isAudioVideoAttachmentExt,
  isMarkdownConvertibleExt,
  sanitizeAttachmentName,
  toNodeBuffer
} = require_media_file_utils();
var { createDocumentTextExtractionHelpers } = require_document_text_extraction_utils();
var {
  createAiMetadataHelpers,
  retryAiMetadataGeneration
} = require_ai_metadata_utils();
var {
  buildSocialMetrics,
  createSocialMetricsHtmlExtractor,
  hasSocialMetrics,
  withCapturedSocialMetrics
} = require_social_engagement_utils();
var {
  buildSocialMediaSupplementalMarkdown,
  createSocialMediaContextHtmlBuilder
} = require_social_media_context_utils();
var { createDouyinStructuredContentBuilder } = require_social_platform_content_utils();
var { createDouyinMediaResolutionDiagnosticBuilder } = require_social_media_diagnostic_utils();
var {
  createXiaohongshuCommentMarkdownHelpers,
  createXiaohongshuMarkdownBuilder
} = require_xiaohongshu_markdown_utils();
var {
  createSocialCommentSectionHelpers,
  createSocialCommentsMarkdownBuilder
} = require_social_comments_markdown_utils();
var {
  applyTranscriptionNoteIdentity,
  buildSemanticTranscriptionTitle,
  buildTranscriptionNoteIdentity,
  getTranscriptionSourcePrefix,
  isSuccessfulTranscriptionRecord
} = require_transcription_note_title_utils();
var {
  cleanPdfExtractedText,
  extractDocxMarkdown,
  extractPdfMarkdown
} = createDocumentTextExtractionHelpers({
  toNodeBuffer,
  cleanMarkdownForStorage
});
var WECHAT_SESSION_PARTITION = "persist:wechat-inbox-wechat";
var XIAOHONGSHU_SESSION_PARTITION = "persist:wechat-inbox-sync-xiaohongshu";
var PLUGIN_RUNTIME_VERSION = "1.3.87";
var PLUGIN_RUNTIME_BUILD_MARKER = "clipboard-link-path-v1";
var LEGACY_OFFICIAL_SYNC_API_BASES = [
  "https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.ap-shanghai.app.tcloudbase.com/sync"
];
var OFFICIAL_SYNC_API_BASE = "https://he02-d8gebzv050ed6c4ef-1428610652.ap-shanghai.app.tcloudbase.com/sync";
var FEISHU_OAUTH_SYNC_API_BASE = "https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.ap-shanghai.app.tcloudbase.com/sync";
var FEISHU_TUTORIAL_URL = "https://my.feishu.cn/wiki/Lm5kw8QXdiQE96kaDUYcnIsVnAd?from=from_copylink";
var FEISHU_OFFICIAL_API_TUTORIAL_URL = "https://my.feishu.cn/wiki/LZBlwhqBCi880Bk00yOcB2dKn1g?from=from_copylink";
var MAX_PLUGIN_BINDINGS = 3;
var XIAOHONGSHU_TOTAL_COMMENT_LIMIT = 300;
var XIAOHONGSHU_ROOT_COMMENT_LIMIT = XIAOHONGSHU_TOTAL_COMMENT_LIMIT;
var XIAOHONGSHU_REPLY_COMMENT_LIMIT = 100;
var XIAOHONGSHU_ROOT_COMMENT_PAGE_LIMIT = Math.min(
  120,
  Math.max(30, Math.ceil(XIAOHONGSHU_TOTAL_COMMENT_LIMIT / 10))
);
var XIAOHONGSHU_COMMENT_TIMEOUT_MS = 9e4;
var XIAOHONGSHU_COMMENT_REQUEST_TIMEOUT_MS = 1e4;
var XIAOHONGSHU_BROWSER_SCRIPT_TIMEOUT_MS = 1e4;
var XIAOHONGSHU_CONTENT_DEADLINE_MS = 4e4;
var DOUYIN_MOBILE_SHARE_USER_AGENT = "Mozilla/5.0 (Linux; Android 13; 22041211AC) AppleWebKit/537.36 Chrome/119.0.0.0 Mobile Safari/537.36";
var LOCAL_TRANSCRIPTION_PLAN = "local_transcription_beta";
var LOCAL_TRANSCRIPTION_FALLBACK_PLANS = ["local_transcription_trial"];
var LOCAL_COMPONENT_CDN_BASE_URL = "https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcloudbaseapp.com";
var LOCAL_ASR_INSTALLER_URL = "https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcloudbaseapp.com/local-asr/common/install-local-asr.ps1";
var LOCAL_ASR_MACOS_INSTALLER_URL = "https://he02-d8gebzv050ed6c4ef-d350b93bf-1357443479.tcloudbaseapp.com/local-asr/common/install-local-asr-macos.sh";
var LOCAL_OCR_WINDOWS_INSTALLER_SHA256 = "65ff6ec5aa844c780a4ebf4f83c9ea2f206de1b33e145dd2f1b9e1129f4e2337";
var LOCAL_OCR_MACOS_INSTALLER_SHA256 = "de54e86dec02cca3bdd5e0e84e89ae4dd50918cff3300968aa84e7bb1f846074";
var LOCAL_OCR_INSTALLER_URL = `${LOCAL_COMPONENT_CDN_BASE_URL}/local-components/by-sha256/${LOCAL_OCR_WINDOWS_INSTALLER_SHA256}/install-local-ocr.ps1`;
var LOCAL_OCR_MACOS_INSTALLER_URL = `${LOCAL_COMPONENT_CDN_BASE_URL}/local-components/by-sha256/${LOCAL_OCR_MACOS_INSTALLER_SHA256}/install-local-ocr-macos.sh`;
var LOCAL_ASR_INSTALL_TIMEOUT_MS = 20 * 60 * 1e3;
var PRO_SETUP_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1e3;
var PRO_SETUP_PROMPT_COOLDOWN_MS = 24 * 60 * 60 * 1e3;
var NOTE_SAVE_MODES = {
  date: "按日期创建子目录",
  root: "直接保存到根目录"
};
var normalizeNoteSaveMode = /* @__PURE__ */ __name((value) => normalizeNoteSaveModeWithDefaults(
  value,
  NOTE_SAVE_MODES,
  DEFAULT_SETTINGS.noteSaveMode
), "normalizeNoteSaveMode");
var normalizeNotePropertyFields = /* @__PURE__ */ __name((value) => normalizeNotePropertyFieldsWithKeys(
  value,
  NOTE_PROPERTY_FIELD_KEYS
), "normalizeNotePropertyFields");
var DEFAULT_NOTE_PROPERTY_FIELDS = "title,author,url,synced_at,source,description,keywords,views,likes,collects,comments,shares,coins,metrics_captured_at";
var NOTE_PROPERTY_FIELD_KEYS = [
  "id",
  "type",
  "title",
  "author",
  "url",
  "created_at",
  "synced_at",
  "source",
  "description",
  "keywords",
  "views",
  "likes",
  "collects",
  "comments",
  "shares",
  "coins",
  "metrics_captured_at",
  "status",
  "fetch_status",
  "conversion_status",
  "audio_file",
  "audio_file_id",
  "transcription_status",
  "file_name",
  "file_id",
  "file_ext"
];
var DEFAULT_SETTINGS = {
  apiBase: OFFICIAL_SYNC_API_BASE,
  settingsVersion: 2,
  token: "",
  pendingBindCode: "",
  pendingRedeemCode: "",
  localTranscriptionEntitlementStatus: null,
  proEntitlementLastError: "",
  proEntitlementLastErrorAt: "",
  proSetupLastCheckedAt: "",
  proSetupInstallPromptSnoozedUntil: "",
  bindings: [],
  clientId: "",
  inboxDir: "临时收集",
  noteSaveMode: "date",
  notePropertyFields: DEFAULT_NOTE_PROPERTY_FIELDS,
  autoSyncOnLoad: true,
  aiProvider: "off",
  aiMetadataEnabled: true,
  xiaohongshuCommentsEnabled: true,
  xiaohongshuImageOcrEnabled: false,
  xiaohongshuImageOcrConsentVersion: 0,
  saveOriginalMediaEnabled: false,
  wechatChannelsExperimentUrl: "",
  feishuOAuthStatus: null,
  feishuAppId: "",
  feishuAppSecret: "",
  deepseekApiKey: "",
  deepseekModel: "deepseek-chat",
  deepseekBaseUrl: "https://api.deepseek.com/v1/chat/completions",
  cloudPreTranscriptionEnabled: false,
  cloudPreTranscriptionThresholdMinutes: 10,
  localAsrPlatform: "auto",
  localAsrInstallMode: "default",
  localTranscriptionCommand: "",
  aliyunApiKey: "",
  aliyunModel: "qwen3.5-omni-plus",
  aliyunBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
  doubaoAsrApiKey: "",
  doubaoPollAttempts: 60,
  doubaoPollIntervalMs: 5e3,
  pendingDoubaoTasks: {},
  tencentSecretId: "",
  tencentSecretKey: "",
  tencentRegion: "ap-shanghai",
  tencentEngineModelType: "16k_zh",
  tencentPollAttempts: 60,
  tencentPollIntervalMs: 5e3,
  locallyQuarantinedRecordIds: [],
  pendingSyncLifecycleAttempts: []
};
var XIAOHONGSHU_OCR_MAX_IMAGES = 18;
var XIAOHONGSHU_OCR_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
var XIAOHONGSHU_CONTENT_MAX_IMAGES = 100;
var XIAOHONGSHU_FALLBACK_MAX_SOURCE_CHARACTERS = 4 * 1024 * 1024;
var XIAOHONGSHU_FALLBACK_MAX_JSON_BLOCK_CHARACTERS = 2 * 1024 * 1024;
var XIAOHONGSHU_COMMENT_IDENTITY_MAX_BODY_CHARACTERS = 1024 * 1024;
var XIAOHONGSHU_COMMENT_RESPONSE_MAX_BODY_CHARACTERS = 4 * 1024 * 1024;
var XIAOHONGSHU_COMMENT_IDENTITY_MAX_NODES = 2e3;
var XIAOHONGSHU_COMMENT_TRUNCATED_BODY_MARKER = "__WECHAT_INBOX_XHS_COMMENT_BODY_TRUNCATED__";
var BROWSER_MEDIA_CAPTURE_MAX_REQUESTS = 512;
var BROWSER_MEDIA_CAPTURE_MAX_URLS = 256;
var BROWSER_MEDIA_CAPTURE_MAX_NODES = 2048;
var BROWSER_MEDIA_CAPTURE_MAX_STRING_CHARACTERS = 256 * 1024;
var AI_PROVIDER_NAMES = {
  off: "关闭转写",
  local: "本地转写",
  aliyun: "阿里云百炼 Qwen-Omni",
  doubao: "豆包语音识别",
  tencent: "腾讯云 ASR 录音文件识别"
};
function normalizeCloudPreTranscriptionThresholdMinutes(value) {
  const number = Number(value);
  return [10, 30, 60].includes(number) ? number : DEFAULT_SETTINGS.cloudPreTranscriptionThresholdMinutes;
}
__name(normalizeCloudPreTranscriptionThresholdMinutes, "normalizeCloudPreTranscriptionThresholdMinutes");
var LOCAL_ASR_PLATFORM_NAMES = {
  auto: "自动识别",
  win32: "Windows",
  darwin: "macOS"
};
var TYPE_DISPLAY_NAMES = {
  text: "文字",
  link: "链接",
  webpage: "网页",
  voice: "语音",
  file: "文件"
};
var TENCENT_ASR_HOST = "asr.tencentcloudapi.com";
var TENCENT_ASR_VERSION = "2019-06-14";
var TENCENT_ASR_SERVICE = "asr";
var FEISHU_OPEN_API_PAGE_SIZE = 500;
var FEISHU_OPEN_API_MAX_PAGES = 50;
var DOUBAO_ASR_SUBMIT_URL = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/submit";
var DOUBAO_ASR_QUERY_URL = "https://openspeech.bytedance.com/api/v3/auc/bigmodel/query";
var DOUBAO_ASR_RESOURCE_ID = "volc.seedasr.auc";
var ALIYUN_TRANSCRIPTION_PROMPT = "请逐字转写这段音频，只输出转写文本，不要摘要，不要解释，不要使用 Markdown。";
var LOCAL_ASR_HOME = ".wechat-inbox-local-asr";
var LOCAL_ASR_SAFE_HOME = "wechat-inbox-local-asr";
var LOCAL_OCR_HOME = ".wechat-inbox-local-ocr";
var LOCAL_OCR_INSTALL_TIMEOUT_MS = 10 * 60 * 1e3;
var LOCAL_OCR_RUN_TIMEOUT_MS = 90 * 1e3;
var LOCAL_OCR_BATCH_RUN_TIMEOUT_MS = 6 * 60 * 1e3;
var LOCAL_OCR_BATCH_RUNNER_VERSION = "xiaohongshu-batch-v1";
function getLocalAsrPlatform(platform = os.platform()) {
  if (platform === "win32") return "win32";
  if (platform === "darwin") return "darwin";
  return platform || "";
}
__name(getLocalAsrPlatform, "getLocalAsrPlatform");
function normalizeLocalAsrPlatform(value) {
  return Object.prototype.hasOwnProperty.call(LOCAL_ASR_PLATFORM_NAMES, String(value || "").trim()) ? String(value || "").trim() : "auto";
}
__name(normalizeLocalAsrPlatform, "normalizeLocalAsrPlatform");
function shouldPersistAutoLocalAsrPlatform(savedSettings) {
  return normalizeLocalAsrPlatform(savedSettings && savedSettings.localAsrPlatform) !== "auto";
}
__name(shouldPersistAutoLocalAsrPlatform, "shouldPersistAutoLocalAsrPlatform");
function resolveLocalAsrPlatform(value, runtimePlatform = os.platform()) {
  const normalized = normalizeLocalAsrPlatform(value);
  return normalized === "auto" ? getLocalAsrPlatform(runtimePlatform) : normalized;
}
__name(resolveLocalAsrPlatform, "resolveLocalAsrPlatform");
function getLocalAsrPlatformMismatchMessage(selectedPlatform, runtimePlatform = os.platform()) {
  const normalized = normalizeLocalAsrPlatform(selectedPlatform);
  if (normalized === "auto") return "";
  const selected = getLocalAsrPlatform(normalized);
  const runtime = getLocalAsrPlatform(runtimePlatform);
  if (!["win32", "darwin"].includes(selected) || !["win32", "darwin"].includes(runtime)) return "";
  if (selected === runtime) return "";
  const selectedName = LOCAL_ASR_PLATFORM_NAMES[selected] || selected;
  const runtimeName = LOCAL_ASR_PLATFORM_NAMES[runtime] || runtime;
  return `Local ASR platform mismatch: this computer is ${runtimeName}, but the selected installer is ${selectedName}. Please choose Auto or ${runtimeName}, then install again.`;
}
__name(getLocalAsrPlatformMismatchMessage, "getLocalAsrPlatformMismatchMessage");
function getDefaultLocalTranscriptionCommand(platform = os.platform(), installRoot = "") {
  if (getLocalAsrPlatform(platform) === "darwin") {
    return `/bin/bash "$HOME/${LOCAL_ASR_HOME}/transcribe.sh" --input {input} --output {output}`;
  }
  if (installRoot) {
    return `powershell -NoProfile -ExecutionPolicy Bypass -File "${joinLocalAsrPath(platform, installRoot, "transcribe.ps1")}" -InputPath {input} -OutputPath {output}`;
  }
  return `powershell -NoProfile -ExecutionPolicy Bypass -File "%USERPROFILE%\\${LOCAL_ASR_HOME}\\transcribe.ps1" -InputPath {input} -OutputPath {output}`;
}
__name(getDefaultLocalTranscriptionCommand, "getDefaultLocalTranscriptionCommand");
function normalizeLocalAsrInstallMode(value) {
  return String(value || "").trim() === "safe" ? "safe" : "default";
}
__name(normalizeLocalAsrInstallMode, "normalizeLocalAsrInstallMode");
function isAsciiPath(value) {
  return /^[\x00-\x7F]+$/.test(String(value || ""));
}
__name(isAsciiPath, "isAsciiPath");
function getSafeLocalAsrInstallRoot(platform = os.platform(), env = process.env) {
  if (getLocalAsrPlatform(platform) === "win32") {
    const systemDrive = String(env && env.SystemDrive || "C:").trim() || "C:";
    const candidates = [
      String(env && env.PUBLIC || "").trim(),
      String(env && env.ProgramData || "").trim(),
      path.win32.join(systemDrive, LOCAL_ASR_SAFE_HOME),
      path.win32.join("C:", LOCAL_ASR_SAFE_HOME)
    ].filter(Boolean);
    const safeBase = candidates.find((candidate) => isAsciiPath(candidate)) || path.win32.join("C:", LOCAL_ASR_SAFE_HOME);
    return safeBase.endsWith(LOCAL_ASR_SAFE_HOME) ? safeBase : path.win32.join(safeBase, LOCAL_ASR_SAFE_HOME);
  }
  return path.join(os.homedir(), LOCAL_ASR_HOME);
}
__name(getSafeLocalAsrInstallRoot, "getSafeLocalAsrInstallRoot");
function hasLocalAsrNativeCrash(runLogText) {
  const text = String(runLogText || "");
  return text.includes("0xC0000409") || text.includes("-1073740791") || /whisper\.cpp[^\n]*崩溃/.test(text);
}
__name(hasLocalAsrNativeCrash, "hasLocalAsrNativeCrash");
function getLocalAsrRepairAction({
  platform = os.platform(),
  installRoot = "",
  status = {},
  runLogText = ""
} = {}) {
  if (getLocalAsrPlatform(platform) === "win32" && (!isAsciiPath(installRoot) || hasLocalAsrNativeCrash(runLogText))) {
    return "safe";
  }
  if (!status || !status.ready || status.scriptOutdated) {
    return "default";
  }
  return "none";
}
__name(getLocalAsrRepairAction, "getLocalAsrRepairAction");
function getLocalAsrInstallRoot(homeDir = os.homedir(), mode = "default", platform = os.platform(), env = process.env) {
  if (normalizeLocalAsrInstallMode(mode) === "safe") {
    return getSafeLocalAsrInstallRoot(platform, env);
  }
  return joinLocalAsrPath(platform, homeDir, LOCAL_ASR_HOME);
}
__name(getLocalAsrInstallRoot, "getLocalAsrInstallRoot");
function getLocalOcrInstallRoot(homeDir = os.homedir(), platform = os.platform()) {
  return joinLocalAsrPath(platform, homeDir, LOCAL_OCR_HOME);
}
__name(getLocalOcrInstallRoot, "getLocalOcrInstallRoot");
function getLocalOcrPythonPath(platform = os.platform(), installRoot = getLocalOcrInstallRoot(os.homedir(), platform)) {
  return getLocalAsrPlatform(platform) === "darwin" ? joinLocalAsrPath(platform, installRoot, "venv", "bin", "python") : joinLocalAsrPath(platform, installRoot, "venv", "Scripts", "python.exe");
}
__name(getLocalOcrPythonPath, "getLocalOcrPythonPath");
function getLocalOcrScriptPath(platform = os.platform(), installRoot = getLocalOcrInstallRoot(os.homedir(), platform)) {
  return joinLocalAsrPath(platform, installRoot, "ocr_image.py");
}
__name(getLocalOcrScriptPath, "getLocalOcrScriptPath");
function getLocalOcrInstallStatus(installRoot = getLocalOcrInstallRoot(), exists = fs.existsSync, platform = os.platform()) {
  const pythonPath = getLocalOcrPythonPath(platform, installRoot);
  const scriptPath = getLocalOcrScriptPath(platform, installRoot);
  const hasPython = Boolean(pythonPath && exists(pythonPath));
  const hasScript = Boolean(scriptPath && exists(scriptPath));
  const missingReasons = [];
  if (!hasPython) missingReasons.push("Python OCR 运行环境未找到，请安装/更新本地转写组件");
  if (!hasScript) missingReasons.push("OCR 脚本未找到，请安装/更新本地转写组件");
  return {
    installRoot,
    pythonPath,
    scriptPath,
    hasPython,
    hasScript,
    missingReasons,
    ready: hasPython && hasScript
  };
}
__name(getLocalOcrInstallStatus, "getLocalOcrInstallStatus");
function completePendingLocalOcrSwitch(installRoot, dependencies = {}) {
  const exists = dependencies.exists || fs.existsSync;
  const readFile = dependencies.readFile || ((filePath) => fs.readFileSync(filePath, "utf8"));
  const rename = dependencies.rename || ((from, to) => fs.renameSync(from, to));
  const remove = dependencies.remove || ((target) => fs.rmSync(target, { recursive: true, force: true }));
  const validatePython = dependencies.validatePython || ((pythonPath) => {
    if (!exists(pythonPath)) return false;
    try {
      childProcess.execFileSync(pythonPath, ["-c", "import rapidocr_onnxruntime, PIL"], {
        timeout: 3e4,
        windowsHide: true,
        stdio: "ignore"
      });
      return true;
    } catch (_) {
      return false;
    }
  });
  const root = path.resolve(String(installRoot || ""));
  const markerPath = path.join(root, "pending-venv-switch.json");
  const legacyStagingPath = path.join(root, "venv-staging");
  const targetPath = path.join(root, "venv");
  const backupPath = path.join(root, "venv-backup");
  if (!exists(markerPath)) return { status: "none" };
  let marker;
  try {
    marker = JSON.parse(String(readFile(markerPath) || "").replace(/^\uFEFF/, ""));
  } catch (_) {
    remove(markerPath);
    return { status: "invalid" };
  }
  if (!marker || !["single-dir-transaction-v1", "unique-staging-transaction-v2"].includes(marker.capability)) {
    remove(markerPath);
    return { status: "invalid" };
  }
  let stagingPath = legacyStagingPath;
  if (marker.capability === "unique-staging-transaction-v2") {
    const markerStagingPath = path.resolve(String(marker.staging || ""));
    const markerTargetPath = path.resolve(String(marker.target || ""));
    const markerBackupPath = path.resolve(String(marker.backup || ""));
    const stagingName = path.basename(markerStagingPath);
    const hasSafeStagingName = /^venv-staging-[a-f0-9]{32}$/i.test(stagingName);
    const isDirectInstallChild = path.dirname(markerStagingPath) === root;
    const hasExpectedTransactionTargets = markerTargetPath === targetPath && markerBackupPath === backupPath;
    if (!hasSafeStagingName || !isDirectInstallChild || !hasExpectedTransactionTargets) {
      remove(markerPath);
      return { status: "invalid" };
    }
    stagingPath = markerStagingPath;
  }
  const stagingPython = path.join(stagingPath, "Scripts", "python.exe");
  if (!exists(stagingPath) || !validatePython(stagingPython)) {
    remove(markerPath);
    if (exists(stagingPath)) remove(stagingPath);
    return { status: "invalid" };
  }
  let movedTarget = false;
  try {
    if (exists(backupPath)) remove(backupPath);
    if (exists(targetPath)) {
      rename(targetPath, backupPath);
      movedTarget = true;
    }
    rename(stagingPath, targetPath);
    const activePython = path.join(targetPath, "Scripts", "python.exe");
    if (!validatePython(activePython)) {
      throw new Error("promoted OCR environment failed validation");
    }
    if (exists(backupPath)) remove(backupPath);
    remove(markerPath);
    return { status: "activated", pythonPath: activePython };
  } catch (error) {
    try {
      if (movedTarget && exists(targetPath) && exists(backupPath)) {
        remove(targetPath);
      }
      if (movedTarget && !exists(targetPath) && exists(backupPath)) {
        rename(backupPath, targetPath);
      }
    } catch (_) {
    }
    return { status: "pending", error: error && (error.message || String(error)) };
  }
}
__name(completePendingLocalOcrSwitch, "completePendingLocalOcrSwitch");
function joinLocalAsrPath(platform, ...segments) {
  if (getLocalAsrPlatform(platform) === "darwin") {
    const [first, ...rest] = segments;
    return [
      String(first || "").replace(/\/+$/g, ""),
      ...rest.map((segment) => String(segment || "").replace(/^\/+|\/+$/g, ""))
    ].filter(Boolean).join("/");
  }
  if (getLocalAsrPlatform(platform) === "win32") {
    return path.win32.join(...segments);
  }
  return path.join(...segments);
}
__name(joinLocalAsrPath, "joinLocalAsrPath");
function findFileRecursive(rootDir, predicate) {
  try {
    if (!fs.existsSync(rootDir)) return "";
    const entries = fs.readdirSync(rootDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(rootDir, entry.name);
      if (entry.isFile() && predicate(fullPath, entry.name)) return fullPath;
      if (entry.isDirectory()) {
        const found = findFileRecursive(fullPath, predicate);
        if (found) return found;
      }
    }
  } catch (error) {
    return "";
  }
  return "";
}
__name(findFileRecursive, "findFileRecursive");
function findFileRecursiveByNames(rootDir, names) {
  try {
    if (!fs.existsSync(rootDir)) return "";
    const matches = [];
    const visit = /* @__PURE__ */ __name((dir) => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isFile() && names.includes(entry.name)) {
          matches.push(fullPath);
        } else if (entry.isDirectory()) {
          visit(fullPath);
        }
      }
    }, "visit");
    visit(rootDir);
    matches.sort((left, right) => {
      const leftRank = names.indexOf(path.basename(left));
      const rightRank = names.indexOf(path.basename(right));
      if (leftRank !== rightRank) return leftRank - rightRank;
      return left.localeCompare(right);
    });
    return matches[0] || "";
  } catch (error) {
    return "";
  }
}
__name(findFileRecursiveByNames, "findFileRecursiveByNames");
function findFirstExistingPath(candidates, exists) {
  return candidates.find((candidate) => candidate && exists(candidate)) || "";
}
__name(findFirstExistingPath, "findFirstExistingPath");
var CURRENT_WINDOWS_ASR_SCRIPT_SHA256 = "23c195a46d2e7b875757ead4a76080891e9343eb7563171f726b1b33a66e2709";
var LEGACY_WINDOWS_ASR_SCRIPT_SHA256 = "509a1b5aee1326da11e5f674e98cac3939b853c45180cced0f421d59c67fafcb";
function getLocalAsrScriptIdentityHash(source) {
  const normalizedSource = String(source || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").trimEnd();
  return crypto.createHash("sha256").update(normalizedSource, "utf8").digest("hex");
}
__name(getLocalAsrScriptIdentityHash, "getLocalAsrScriptIdentityHash");
function getLocalAsrScriptVersionStatus(scriptPath, fileSystem = fs) {
  try {
    if (!scriptPath || !fileSystem.existsSync(scriptPath)) {
      return {
        scriptVersion: "missing",
        scriptOutdated: true
      };
    }
    const source = String(fileSystem.readFileSync(scriptPath, "utf8") || "");
    const sourceIdentityHash = getLocalAsrScriptIdentityHash(source);
    if (source.includes("GeneratedTxt")) {
      return {
        scriptVersion: "legacy-generated-txt",
        scriptOutdated: true
      };
    }
    if (source.includes("transcribe-last.log") && source.includes("recoveryTriggered=") && source.includes("Split-AudioToChunks") && source.includes("Test-TranscriptHasRepeatHallucination") && source.includes("Invoke-RecoverRepeatedChunkText") && source.includes("$ChunkRetrySeconds") && source.includes("$ChunkSeconds = 120") && source.includes('$TranscriptQualityGuardVersion = "repeat-guard-v2"') && source.includes('$NativeProcessRunnerVersion = "diagnostics-process-v1"') && source.includes("TRANSCRIPT_HALLUCINATION") && source.includes("Invoke-NativeProcess") && source.includes("System.Diagnostics.ProcessStartInfo") && source.includes("ReadToEndAsync") && !source.includes("Start-Process") && source.includes("ConvertTo-SimplifiedChinese") && source.includes("SimplifiedChinese") && source.includes("System.Text.UTF8Encoding") && source.includes("ReadAllText") && source.includes("WriteAllText") && source.includes("Get-ShortPath") && source.includes("Test-WhisperNativeCrashExitCode") && source.includes("Convert-ExitCodeToHex") && source.includes("$hex = Convert-ExitCodeToHex -ExitCode $ExitCode") && source.includes('Invoke-TranscribeAttempt -Mode "normal"') && source.includes('Invoke-TranscribeAttempt -Mode "safe"') && source.includes("safeModelPath") && source.includes("progressPercent") && source.includes("progressHeartbeatAt") && source.includes("progressPid") && source.includes('-ProgressStage "segmenting"') && !source.includes("$SimplifiedPrompt") && !source.includes('"--prompt"')) {
      if (sourceIdentityHash !== CURRENT_WINDOWS_ASR_SCRIPT_SHA256) {
        return {
          scriptVersion: "current-signature-mismatch",
          scriptOutdated: true
        };
      }
      return {
        scriptVersion: "adaptive-chunked-diagnostics-process-repeat-guard-v2-heartbeat-run-log",
        scriptOutdated: false
      };
    }
    if (source.includes("transcribe-last.log") && source.includes("recoveryTriggered=") && source.includes("Split-AudioToChunks") && source.includes("Test-TranscriptHasRepeatHallucination") && source.includes("Invoke-RecoverRepeatedChunkText") && source.includes("$ChunkRetrySeconds") && source.includes("$ChunkSeconds = 120") && source.includes('$TranscriptQualityGuardVersion = "repeat-guard-v2"') && source.includes("TRANSCRIPT_HALLUCINATION") && source.includes("Invoke-NativeProcess") && source.includes("Start-Process") && source.includes("RedirectStandardOutput") && source.includes("ConvertTo-SimplifiedChinese") && source.includes("SimplifiedChinese") && source.includes("System.Text.UTF8Encoding") && source.includes("ReadAllText") && source.includes("WriteAllText") && source.includes("Get-ShortPath") && source.includes("Test-WhisperNativeCrashExitCode") && source.includes("Convert-ExitCodeToHex") && source.includes("$hex = Convert-ExitCodeToHex -ExitCode $ExitCode") && source.includes('Invoke-TranscribeAttempt -Mode "normal"') && source.includes('Invoke-TranscribeAttempt -Mode "safe"') && source.includes("safeModelPath") && source.includes("progressPercent") && !source.includes("$SimplifiedPrompt") && !source.includes('"--prompt"') && !source.includes("DataReceivedEventHandler") && !source.includes("BeginOutputReadLine")) {
      const hasHeartbeatProtocol = source.includes("progressHeartbeatAt") && source.includes("progressPid") && source.includes('-ProgressStage "segmenting"');
      if (hasHeartbeatProtocol && sourceIdentityHash !== LEGACY_WINDOWS_ASR_SCRIPT_SHA256) {
        return {
          scriptVersion: "legacy-signature-mismatch",
          scriptOutdated: true
        };
      }
      return {
        scriptVersion: hasHeartbeatProtocol ? "adaptive-chunked-start-process-repeat-guard-v2-heartbeat-run-log" : "adaptive-chunked-start-process-repeat-guard-v2-progress-run-log",
        scriptOutdated: !hasHeartbeatProtocol,
        ...hasHeartbeatProtocol ? {
          upgradeRecommended: true,
          compatibilityMode: "legacy-start-process"
        } : {}
      };
    }
    if (source.includes("transcribe-last.log") && source.includes("recoveryTriggered=") && source.includes("Split-AudioToChunks") && source.includes("Test-TranscriptHasRepeatHallucination") && source.includes("Invoke-RecoverRepeatedChunkText") && source.includes("$ChunkRetrySeconds") && source.includes("$ChunkSeconds = 120") && source.includes("Invoke-NativeProcess") && source.includes("Start-Process") && source.includes("RedirectStandardOutput") && source.includes("ConvertTo-SimplifiedChinese") && source.includes("SimplifiedChinese") && source.includes("$SimplifiedPrompt") && source.includes("System.Text.UTF8Encoding") && source.includes("ReadAllText") && source.includes("WriteAllText") && source.includes("Get-ShortPath") && source.includes("Test-WhisperNativeCrashExitCode") && source.includes("Convert-ExitCodeToHex") && source.includes("$hex = Convert-ExitCodeToHex -ExitCode $ExitCode") && source.includes('Invoke-TranscribeAttempt -Mode "normal"') && source.includes('Invoke-TranscribeAttempt -Mode "safe"') && source.includes("safeModelPath") && source.includes("progressPercent") && !source.includes("DataReceivedEventHandler") && !source.includes("BeginOutputReadLine")) {
      return {
        scriptVersion: "adaptive-chunked-start-process-repeat-guard-progress-run-log",
        scriptOutdated: true
      };
    }
    if (source.includes("transcribe-last.log") && (source.includes("ChunkSeconds") || source.includes("CHUNK_SECONDS")) && source.includes("Invoke-NativeProcess") && source.includes("Start-Process") && source.includes("RedirectStandardOutput") && source.includes("ConvertTo-SimplifiedChinese") && source.includes("SimplifiedChinese") && source.includes("$SimplifiedPrompt") && source.includes("System.Text.UTF8Encoding") && source.includes("ReadAllText") && source.includes("WriteAllText") && source.includes("Get-ShortPath") && source.includes("Test-WhisperNativeCrashExitCode") && source.includes("Convert-ExitCodeToHex") && source.includes("$hex = Convert-ExitCodeToHex -ExitCode $ExitCode") && source.includes('Invoke-TranscribeAttempt -Mode "normal"') && source.includes('Invoke-TranscribeAttempt -Mode "safe"') && source.includes("safeModelPath") && source.includes("progressPercent") && !source.includes("DataReceivedEventHandler") && !source.includes("BeginOutputReadLine")) {
      return {
        scriptVersion: "chunked-start-process-utf8-simplified-fallback-safe-model-progress-run-log",
        scriptOutdated: true
      };
    }
    if (source.includes("transcribe-last.log") && source.includes("CHUNK_SECONDS") && source.includes("set -euo pipefail") && source.includes('TRANSCRIPT_QUALITY_GUARD_VERSION="repeat-guard-v2"') && source.includes("CHUNK_SECONDS=120") && source.includes("choose_chunk_seconds") && source.includes("find_metal_resources_dir") && source.includes("GGML_METAL_PATH_RESOURCES") && source.includes("metalAcceleration=failed") && source.includes("progressPercent") && !source.includes("SIMPLIFIED_PROMPT") && !source.includes('--prompt "$SIMPLIFIED_PROMPT"')) {
      const hasHeartbeatProtocol = source.includes("progressHeartbeatAt") && source.includes("progressPid") && source.includes("run_with_heartbeat segmenting");
      return {
        scriptVersion: hasHeartbeatProtocol ? "adaptive-chunked-bash-repeat-guard-v2-heartbeat-run-log" : "adaptive-chunked-bash-repeat-guard-v2-progress-metal-diagnostics-run-log",
        scriptOutdated: !hasHeartbeatProtocol
      };
    }
    if (source.includes("transcribe-last.log") && (source.includes("ChunkSeconds") || source.includes("CHUNK_SECONDS")) && source.includes("Invoke-NativeProcess") && source.includes("Start-Process") && source.includes("RedirectStandardOutput") && source.includes("ConvertTo-SimplifiedChinese") && source.includes("SimplifiedChinese") && source.includes("$SimplifiedPrompt") && source.includes("System.Text.UTF8Encoding") && source.includes("ReadAllText") && source.includes("WriteAllText") && source.includes("Get-ShortPath") && source.includes("Test-WhisperNativeCrashExitCode") && source.includes('Invoke-TranscribeAttempt -Mode "normal"') && source.includes('Invoke-TranscribeAttempt -Mode "safe"')) {
      return {
        scriptVersion: "chunked-start-process-utf8-simplified-fallback-run-log",
        scriptOutdated: true
      };
    }
    if (source.includes("transcribe-last.log") && (source.includes("ChunkSeconds") || source.includes("CHUNK_SECONDS")) && source.includes("Invoke-NativeProcess") && source.includes("Start-Process") && source.includes("RedirectStandardOutput") && source.includes("ConvertTo-SimplifiedChinese") && source.includes("SimplifiedChinese") && source.includes("$SimplifiedPrompt") && source.includes("System.Text.UTF8Encoding") && source.includes("ReadAllText") && source.includes("WriteAllText") && source.includes("Get-ShortPath") && source.includes("$SafeTempRoot")) {
      return {
        scriptVersion: "chunked-start-process-utf8-simplified-shortpath-run-log",
        scriptOutdated: true
      };
    }
    if (source.includes("transcribe-last.log") && (source.includes("ChunkSeconds") || source.includes("CHUNK_SECONDS")) && source.includes("Invoke-NativeProcess") && source.includes("Start-Process") && source.includes("RedirectStandardOutput") && source.includes("ConvertTo-SimplifiedChinese") && source.includes("SimplifiedChinese") && source.includes("$SimplifiedPrompt") && source.includes("System.Text.UTF8Encoding") && source.includes("ReadAllText") && source.includes("WriteAllText")) {
      return {
        scriptVersion: "chunked-start-process-utf8-simplified-run-log",
        scriptOutdated: true
      };
    }
    if (source.includes("transcribe-last.log") && (source.includes("ChunkSeconds") || source.includes("CHUNK_SECONDS")) && source.includes("Invoke-NativeProcess") && source.includes("Start-Process") && source.includes("RedirectStandardOutput") && source.includes("System.Text.UTF8Encoding") && source.includes("ReadAllText") && source.includes("WriteAllText")) {
      return {
        scriptVersion: "chunked-start-process-utf8-run-log",
        scriptOutdated: true
      };
    }
    if (source.includes("transcribe-last.log") && (source.includes("ChunkSeconds") || source.includes("CHUNK_SECONDS")) && source.includes("Invoke-NativeProcess") && source.includes("System.Text.UTF8Encoding") && source.includes("ReadAllText") && source.includes("WriteAllText")) {
      return {
        scriptVersion: "chunked-safe-native-utf8-run-log",
        scriptOutdated: true
      };
    }
    if (source.includes("transcribe-last.log") && (source.includes("ChunkSeconds") || source.includes("CHUNK_SECONDS")) && source.includes("Invoke-NativeProcess")) {
      return {
        scriptVersion: "chunked-safe-native-run-log",
        scriptOutdated: true
      };
    }
    if (source.includes("transcribe-last.log") && source.includes("CHUNK_SECONDS") && source.includes("set -euo pipefail") && source.includes("SIMPLIFIED_PROMPT") && source.includes('--prompt "$SIMPLIFIED_PROMPT"') && source.includes("CHUNK_SECONDS=120") && source.includes("choose_chunk_seconds") && source.includes("find_metal_resources_dir") && source.includes("GGML_METAL_PATH_RESOURCES") && source.includes("metalAcceleration=failed") && source.includes("progressPercent")) {
      return {
        scriptVersion: "adaptive-chunked-bash-simplified-progress-metal-diagnostics-run-log",
        scriptOutdated: true
      };
    }
    if (source.includes("transcribe-last.log") && source.includes("CHUNK_SECONDS") && source.includes("set -euo pipefail") && source.includes("SIMPLIFIED_PROMPT") && source.includes('--prompt "$SIMPLIFIED_PROMPT"') && source.includes("progressPercent")) {
      return {
        scriptVersion: "chunked-bash-simplified-progress-run-log",
        scriptOutdated: true
      };
    }
    if (source.includes("transcribe-last.log") && source.includes("CHUNK_SECONDS") && source.includes("set -euo pipefail")) {
      return {
        scriptVersion: "chunked-bash-run-log",
        scriptOutdated: true
      };
    }
    if (source.includes("transcribe-last.log") && (source.includes("ChunkSeconds") || source.includes("CHUNK_SECONDS"))) {
      return {
        scriptVersion: "chunked-run-log",
        scriptOutdated: true
      };
    }
    return {
      scriptVersion: "unknown",
      scriptOutdated: true
    };
  } catch (error) {
    return {
      scriptVersion: "unknown",
      scriptOutdated: true
    };
  }
}
__name(getLocalAsrScriptVersionStatus, "getLocalAsrScriptVersionStatus");
function getLocalAsrInstallStatus(installRoot = getLocalAsrInstallRoot(), exists = fs.existsSync, platform = os.platform()) {
  const isMac = getLocalAsrPlatform(platform) === "darwin";
  const transcribeScript = joinLocalAsrPath(platform, installRoot, isMac ? "transcribe.sh" : "transcribe.ps1");
  const modelPath = joinLocalAsrPath(platform, installRoot, "models", "ggml-small.bin");
  const hasTranscribeScript = exists(transcribeScript);
  const scriptVersionStatus = exists === fs.existsSync ? getLocalAsrScriptVersionStatus(transcribeScript) : { scriptVersion: "unknown", scriptOutdated: false };
  const hasModel = exists(modelPath);
  const whisperNames = isMac ? ["whisper-cli", "main"] : ["whisper-cli.exe", "main.exe"];
  const ffmpegName = isMac ? "ffmpeg" : "ffmpeg.exe";
  const whisperCandidates = [
    joinLocalAsrPath(platform, installRoot, "bin", whisperNames[0]),
    joinLocalAsrPath(platform, installRoot, "bin", whisperNames[1]),
    joinLocalAsrPath(platform, installRoot, "whisper", whisperNames[0]),
    joinLocalAsrPath(platform, installRoot, "whisper", whisperNames[1])
  ];
  const ffmpegCandidates = [
    joinLocalAsrPath(platform, installRoot, "bin", ffmpegName),
    joinLocalAsrPath(platform, installRoot, "ffmpeg", ffmpegName)
  ];
  const whisperPath = findFirstExistingPath(whisperCandidates, exists) || (exists === fs.existsSync ? findFileRecursiveByNames(path.join(installRoot, "whisper"), whisperNames) : "") || (exists === fs.existsSync ? findFileRecursiveByNames(path.join(installRoot, "bin"), whisperNames) : "");
  const ffmpegPath = findFirstExistingPath(ffmpegCandidates, exists) || (exists === fs.existsSync ? findFileRecursive(path.join(installRoot, "ffmpeg"), (filePath, name) => name === ffmpegName) : "") || (exists === fs.existsSync ? findFileRecursive(path.join(installRoot, "bin"), (filePath, name) => name === ffmpegName) : "");
  const hasWhisper = Boolean(whisperPath);
  const hasFfmpeg = Boolean(ffmpegPath);
  const missingReasons = [];
  if (!hasTranscribeScript) missingReasons.push("转写脚本未找到，请重新安装/更新本地转写组件");
  if (scriptVersionStatus.scriptOutdated) missingReasons.push("转写脚本过旧，请重新安装/更新本地转写组件");
  if (!hasWhisper) missingReasons.push("whisper 未找到，请重新安装/更新本地转写组件");
  if (!hasFfmpeg) missingReasons.push("ffmpeg 未找到，请重新安装/更新本地转写组件");
  if (!hasModel) missingReasons.push("模型文件未找到，请重新安装/更新本地转写组件");
  return {
    installRoot,
    transcribeScript,
    whisperPath,
    ffmpegPath,
    modelPath,
    hasTranscribeScript,
    scriptVersion: scriptVersionStatus.scriptVersion,
    scriptOutdated: scriptVersionStatus.scriptOutdated,
    ...scriptVersionStatus.upgradeRecommended === void 0 ? {} : {
      upgradeRecommended: Boolean(scriptVersionStatus.upgradeRecommended),
      compatibilityMode: scriptVersionStatus.compatibilityMode || "current"
    },
    hasWhisper,
    hasFfmpeg,
    hasModel,
    missingReasons,
    ready: hasTranscribeScript && !scriptVersionStatus.scriptOutdated && hasWhisper && hasFfmpeg && hasModel
  };
}
__name(getLocalAsrInstallStatus, "getLocalAsrInstallStatus");
function getLocalAsrInstallLogPath(installRoot = getLocalAsrInstallRoot()) {
  return path.join(installRoot, "install.log");
}
__name(getLocalAsrInstallLogPath, "getLocalAsrInstallLogPath");
function readLocalAsrInstallLog(installRoot = getLocalAsrInstallRoot()) {
  const logPath = getLocalAsrInstallLogPath(installRoot);
  try {
    if (!fs.existsSync(logPath)) return "";
    return fs.readFileSync(logPath, "utf8").slice(-5e3);
  } catch (error) {
    return `读取安装日志失败：${error.message || error}`;
  }
}
__name(readLocalAsrInstallLog, "readLocalAsrInstallLog");
function getLocalAsrRunLogPath(installRoot = getLocalAsrInstallRoot()) {
  return path.join(installRoot, "transcribe-last.log");
}
__name(getLocalAsrRunLogPath, "getLocalAsrRunLogPath");
function explainLocalAsrExitCode(value) {
  const text = String(value || "");
  if (text.includes("-1073741515") || text.toUpperCase().includes("0XC0000135")) {
    return "缺少 Windows VC++ 运行库或 whisper 依赖 DLL，请重新点击“安装/更新本地转写组件”修复。";
  }
  if (text.includes("-1073741795") || text.toUpperCase().includes("0XC000001D")) {
    return "whisper.cpp 使用了当前 CPU 不支持的指令（0xC000001D）。请重新点击“安装/更新本地转写组件”；新版会自动尝试兼容版本。若兼容版本仍无法运行，请复制同步/安装失败诊断联系支持。";
  }
  if (text.includes("-1073740791") || text.toUpperCase().includes("0XC0000409")) {
    return "whisper.cpp 原生程序崩溃（0xC0000409）。常见原因是 Windows 本机运行环境、CPU 指令集兼容性、中文路径或当前音视频片段触发了 whisper.cpp 崩溃。请先重新点击“安装/更新本地转写组件”，新版会用安全路径和真实推理校验修复；如果仍失败，需要复制同步/安装失败诊断里的 transcribe-last.log 继续定位。";
  }
  return "";
}
__name(explainLocalAsrExitCode, "explainLocalAsrExitCode");
function getSyncDiagnosticLogPath(installRoot = getLocalAsrInstallRoot()) {
  return path.join(installRoot, "sync-last.log");
}
__name(getSyncDiagnosticLogPath, "getSyncDiagnosticLogPath");
function buildLocalAsrRunLogText({
  time = (/* @__PURE__ */ new Date()).toISOString(),
  status = "",
  command = "",
  inputPath = "",
  outputPath = "",
  stdout = "",
  stderr = "",
  error = ""
} = {}) {
  const explanation = explainLocalAsrExitCode(error) || explainLocalAsrExitCode(stderr) || explainLocalAsrExitCode(stdout);
  return [
    `time=${time}`,
    `status=${status}`,
    `inputPath=${inputPath}`,
    `outputPath=${outputPath}`,
    `command=${command}`,
    "--- stdout ---",
    String(stdout || ""),
    "--- stderr ---",
    String(stderr || ""),
    "--- error ---",
    String(error || ""),
    explanation ? `--- 可能原因 ---
${explanation}` : "",
    ""
  ].filter((line) => line !== "").join("\n");
}
__name(buildLocalAsrRunLogText, "buildLocalAsrRunLogText");
function writeLocalAsrRunLog({
  installRoot = getLocalAsrInstallRoot(),
  status = "",
  command = "",
  inputPath = "",
  outputPath = "",
  stdout = "",
  stderr = "",
  error = ""
} = {}) {
  try {
    fs.mkdirSync(installRoot, { recursive: true });
    const logPath = getLocalAsrRunLogPath(installRoot);
    fs.writeFileSync(logPath, buildLocalAsrRunLogText({
      status,
      command,
      inputPath,
      outputPath,
      stdout,
      stderr,
      error
    }), "utf8");
    return logPath;
  } catch (writeError) {
    return "";
  }
}
__name(writeLocalAsrRunLog, "writeLocalAsrRunLog");
function appendLocalAsrRunLog({
  installRoot = getLocalAsrInstallRoot(),
  status = "",
  command = "",
  inputPath = "",
  outputPath = "",
  stdout = "",
  stderr = "",
  error = ""
} = {}) {
  try {
    fs.mkdirSync(installRoot, { recursive: true });
    const logPath = getLocalAsrRunLogPath(installRoot);
    const wrapperText = buildLocalAsrRunLogText({
      status,
      command,
      inputPath,
      outputPath,
      stdout,
      stderr,
      error
    });
    if (!String(command || "").trim()) {
      fs.writeFileSync(logPath, wrapperText, "utf8");
      return logPath;
    }
    const prefix = fs.existsSync(logPath) ? "\n\n--- plugin wrapper ---\n" : "";
    fs.appendFileSync(logPath, `${prefix}${wrapperText}`, "utf8");
    return logPath;
  } catch (writeError) {
    return "";
  }
}
__name(appendLocalAsrRunLog, "appendLocalAsrRunLog");
function buildSyncDiagnosticLogText({
  time = (/* @__PURE__ */ new Date()).toISOString(),
  status = "",
  message = "",
  bindingLabel = "",
  stage = "",
  current = 0,
  total = 0,
  title = "",
  recordId = "",
  error = "",
  diagnostic = null
} = {}) {
  const lines = [
    `time=${time}`,
    `status=${status}`,
    `message=${message}`,
    `bindingLabel=${bindingLabel}`,
    `stage=${stage}`,
    `current=${current}`,
    `total=${total}`,
    `title=${title}`,
    `recordId=${recordId}`,
    "--- error ---",
    String(error || "")
  ];
  if (diagnostic && typeof diagnostic === "object") {
    lines.push(
      "--- diagnostic ---",
      JSON.stringify(redactSensitiveObject(diagnostic), null, 2)
    );
  }
  return lines.join("\n");
}
__name(buildSyncDiagnosticLogText, "buildSyncDiagnosticLogText");
function writeSyncDiagnosticLog(payload = {}, installRoot = getLocalAsrInstallRoot()) {
  try {
    fs.mkdirSync(installRoot, { recursive: true });
    const logPath = getSyncDiagnosticLogPath(installRoot);
    fs.writeFileSync(logPath, buildSyncDiagnosticLogText(payload), "utf8");
    return logPath;
  } catch (error) {
    return "";
  }
}
__name(writeSyncDiagnosticLog, "writeSyncDiagnosticLog");
function readSyncDiagnosticLog(installRoot = getLocalAsrInstallRoot()) {
  const logPath = getSyncDiagnosticLogPath(installRoot);
  try {
    if (!fs.existsSync(logPath)) return "";
    return fs.readFileSync(logPath, "utf8").slice(-5e3);
  } catch (error) {
    return `读取同步日志失败：${error.message || error}`;
  }
}
__name(readSyncDiagnosticLog, "readSyncDiagnosticLog");
function readLocalAsrRunLog(installRoot = getLocalAsrInstallRoot()) {
  const logPath = getLocalAsrRunLogPath(installRoot);
  try {
    if (!fs.existsSync(logPath)) return "";
    return fs.readFileSync(logPath, "utf8").slice(-8e3);
  } catch (error) {
    return `读取转写日志失败：${error.message || error}`;
  }
}
__name(readLocalAsrRunLog, "readLocalAsrRunLog");
function writeLocalAsrInstallLog({
  installRoot = getLocalAsrInstallRoot(),
  platform = os.platform(),
  command = "",
  installerPath = "",
  stdout = "",
  stderr = "",
  error = "",
  status = ""
} = {}) {
  try {
    fs.mkdirSync(installRoot, { recursive: true });
    const logPath = getLocalAsrInstallLogPath(installRoot);
    const lines = [
      `time=${(/* @__PURE__ */ new Date()).toISOString()}`,
      `status=${status}`,
      `platform=${platform}`,
      `installerPath=${installerPath}`,
      `command=${command}`,
      "--- stdout ---",
      String(stdout || ""),
      "--- stderr ---",
      String(stderr || ""),
      "--- error ---",
      String(error || ""),
      ""
    ];
    fs.writeFileSync(logPath, lines.join("\n"), "utf8");
    return logPath;
  } catch (writeError) {
    return "";
  }
}
__name(writeLocalAsrInstallLog, "writeLocalAsrInstallLog");
function quoteCommandPath(filePath) {
  return `"${String(filePath || "").replace(/"/g, '\\"')}"`;
}
__name(quoteCommandPath, "quoteCommandPath");
function buildLocalAsrInstallCommand(installerPath, platform = os.platform(), installRoot = "") {
  if (getLocalAsrPlatform(platform) === "darwin" || String(installerPath || "").endsWith(".sh")) {
    return `/bin/bash ${quoteCommandPath(installerPath)}`;
  }
  const rootArg = installRoot ? ` -InstallRoot ${quoteCommandPath(installRoot)}` : "";
  return `powershell -NoProfile -ExecutionPolicy Bypass -File ${quoteCommandPath(installerPath)}${rootArg}`;
}
__name(buildLocalAsrInstallCommand, "buildLocalAsrInstallCommand");
function buildLocalOcrInstallCommand(installerPath, platform = os.platform(), installRoot = "") {
  if (getLocalAsrPlatform(platform) === "darwin" || String(installerPath || "").endsWith(".sh")) {
    return `/bin/bash ${quoteCommandPath(installerPath)}`;
  }
  const rootArg = installRoot ? ` -InstallRoot ${quoteCommandPath(installRoot)}` : "";
  return `powershell -NoProfile -ExecutionPolicy Bypass -File ${quoteCommandPath(installerPath)}${rootArg}`;
}
__name(buildLocalOcrInstallCommand, "buildLocalOcrInstallCommand");
function formatEntitlementExpiresAt(expiresAt) {
  if (!expiresAt) return "";
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return String(expiresAt);
  const pad = /* @__PURE__ */ __name((value) => String(value).padStart(2, "0"), "pad");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
__name(formatEntitlementExpiresAt, "formatEntitlementExpiresAt");
function getProEntitlementStatusFingerprint(status) {
  const source = status && typeof status === "object" ? status : {};
  return JSON.stringify({
    hasAccess: source.hasAccess === true,
    status: String(source.status || ""),
    expiresAt: String(source.expiresAt || ""),
    code: normalizeBindCodeInput(source.code || source.redeemCode || ""),
    bindingToken: normalizeBindCodeInput(source.bindingToken || "")
  });
}
__name(getProEntitlementStatusFingerprint, "getProEntitlementStatusFingerprint");
function buildLocalTranscriptionEntitlementText(status) {
  if (!status || typeof status !== "object") {
    return "权限状态：未刷新。请先绑定小程序并开通 Pro，再回到插件点击「刷新权限」。";
  }
  if (status.hasAccess) {
    return `权限状态：已开通${status.code ? `，兑换码：${status.code}` : ""}${status.expiresAt ? `，有效期至 ${formatEntitlementExpiresAt(status.expiresAt)}` : ""}${status.bindingLabel ? `，绑定：${status.bindingLabel}` : ""}`;
  }
  if (status.status === "missing_redeem_code") {
    return "权限状态：未识别到 Pro。请确认已绑定小程序并在小程序里开通 Pro。";
  }
  if (status.status === "invalid_redeem_code") {
    return `权限状态：兑换码无效${status.code ? `（${status.code}）` : ""}。`;
  }
  if (status.status === "expired") {
    return `权限状态：已过期${status.expiresAt ? `，到期时间 ${formatEntitlementExpiresAt(status.expiresAt)}` : ""}。请在小程序里续费 Pro 后刷新权限。`;
  }
  if (status.status === "unbound") {
    return "权限状态：未绑定小程序。请先完成小程序绑定。";
  }
  return "权限状态：未开通。请在小程序开通 Pro 后，再回到插件刷新权限。";
}
__name(buildLocalTranscriptionEntitlementText, "buildLocalTranscriptionEntitlementText");
function isCachedProStatusActive(status, now = Date.now()) {
  if (!status || typeof status !== "object") return false;
  if (!status.hasAccess || status.status === "expired") return false;
  if (!status.expiresAt) return false;
  const expiresAt = new Date(status.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt > now;
}
__name(isCachedProStatusActive, "isCachedProStatusActive");
function isCachedProStatusActiveForCode(status, code, now = Date.now()) {
  const normalizedCode = normalizeBindCodeInput(code);
  return Boolean(
    normalizedCode && isCachedProStatusActive(status, now) && normalizeBindCodeInput(status && status.code) === normalizedCode
  );
}
__name(isCachedProStatusActiveForCode, "isCachedProStatusActiveForCode");
function buildMissingRedeemCodeStatus() {
  return {
    hasAccess: false,
    plan: LOCAL_TRANSCRIPTION_PLAN,
    status: "missing_redeem_code",
    expiresAt: "",
    code: ""
  };
}
__name(buildMissingRedeemCodeStatus, "buildMissingRedeemCodeStatus");
function formatRedeemAccessError(error, mode = "redeem") {
  const message = error && error.message ? error.message : String(error || "");
  if (/status\s*404|NO_AVAILABLE_REDEEM_CODE|没有找到|No available redeem code/i.test(message)) {
    return mode === "auto" ? "没有识别到可用兑换码，请手动输入兑换码。" : "无可用兑换码，请先输入或自动识别兑换码。";
  }
  if (/status\s*400|INVALID_REDEEM_CODE|Invalid redeem code|兑换码无效|Missing redeem code/i.test(message)) {
    return "兑换码无效、已过期，或不属于当前绑定微信。";
  }
  if (/Invalid bind code|绑定码未绑定|403/i.test(message)) {
    return "绑定码未绑定或已失效，请先重新绑定小程序。";
  }
  if (/Request failed, status/i.test(message)) {
    return "兑换码验证失败，请稍后重试。";
  }
  return message || "兑换码验证失败，请稍后重试。";
}
__name(formatRedeemAccessError, "formatRedeemAccessError");
function downloadTextViaNode(url) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(String(url || ""));
    } catch (error) {
      reject(error);
      return;
    }
    const client = parsed.protocol === "http:" ? http : https;
    const request = client.request(parsed, {
      method: "GET",
      headers: {
        "User-Agent": "wechat-inbox-sync",
        Accept: "text/plain,*/*"
      }
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          try {
            downloadTextViaNode(new URL(response.headers.location, url).toString()).then(resolve, reject);
          } catch (error) {
            reject(error);
          }
          return;
        }
        const text = Buffer.concat(chunks).toString("utf8");
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new Error(`HTTP ${response.statusCode}: ${text.slice(0, 120)}`));
          return;
        }
        resolve(text);
      });
    });
    request.setTimeout(3e4, () => {
      request.destroy(new Error("download timeout"));
    });
    request.on("error", reject);
    request.end();
  });
}
__name(downloadTextViaNode, "downloadTextViaNode");
function getTransportErrorDiagnostic(error) {
  const source = error && typeof error === "object" ? error : {};
  const status = Number(source.status || source.statusCode || source.response && source.response.status || 0);
  const message = String(source.message || source || "unknown error").replace(/[\r\n]+/g, " ").trim().slice(0, 240);
  return {
    name: String(source.name || "").slice(0, 80),
    code: String(source.code || "").slice(0, 80),
    status: Number.isFinite(status) ? status : 0,
    message
  };
}
__name(getTransportErrorDiagnostic, "getTransportErrorDiagnostic");
function buildWebpageTransportDiagnostic({
  sourceUrl = "",
  requestError = null,
  nodeError = null,
  browserError = null,
  selectedTransport = ""
} = {}) {
  const attempts = [];
  if (requestError) attempts.push({ transport: "obsidian-requestUrl", error: getTransportErrorDiagnostic(requestError) });
  if (nodeError) attempts.push({ transport: "node-http", error: getTransportErrorDiagnostic(nodeError) });
  if (browserError) attempts.push({ transport: "hidden-browser", error: getTransportErrorDiagnostic(browserError) });
  return {
    source: getSafeUrlDiagnostic(sourceUrl),
    selectedTransport: String(selectedTransport || "").trim(),
    attempts
  };
}
__name(buildWebpageTransportDiagnostic, "buildWebpageTransportDiagnostic");
var buildDouyinMediaResolutionDiagnostic = createDouyinMediaResolutionDiagnosticBuilder({
  getSafeUrlDiagnostic,
  getTransportErrorDiagnostic
});
function normalizeInstallerScriptText(scriptText, isMac = false) {
  const source = String(scriptText || "");
  if (!isMac) return source;
  return source.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
}
__name(normalizeInstallerScriptText, "normalizeInstallerScriptText");
function hasMinimumInstallerVersion(source, pattern, minimumVersion) {
  const versionMatch = String(source || "").match(pattern);
  if (!versionMatch) return false;
  const versionParts = versionMatch.slice(1).map((value) => Number(value));
  if (versionParts.length !== minimumVersion.length || versionParts.some((value) => !Number.isFinite(value))) {
    return false;
  }
  for (let index = 0; index < minimumVersion.length; index += 1) {
    if (versionParts[index] > minimumVersion[index]) return true;
    if (versionParts[index] < minimumVersion[index]) return false;
  }
  return true;
}
__name(hasMinimumInstallerVersion, "hasMinimumInstallerVersion");
function isLocalAsrInstallerCurrent(scriptText, isMac = false) {
  const source = String(scriptText || "");
  if (!source.includes(".wechat-inbox-local-asr")) return false;
  if (isMac) {
    const portablePythonIndex = source.indexOf("if install_portable_python; then");
    const uvManagedPythonIndex = source.indexOf('"$UV_BIN" python install 3.12');
    return hasMinimumInstallerVersion(
      source,
      /INSTALLER_SCRIPT_VERSION=["'](\d+)\.(\d+)\.(\d+)["']/,
      [1, 3, 8]
    ) && !source.includes("SIMPLIFIED_PROMPT") && !source.includes("--prompt") && source.includes('TRANSCRIPT_QUALITY_GUARD_VERSION="repeat-guard-v2"') && source.includes("CHUNK_SECONDS=120") && source.includes("choose_chunk_seconds") && source.includes("find_metal_resources_dir") && source.includes("GGML_METAL_PATH_RESOURCES") && source.includes("metalAcceleration=failed") && source.includes("transcribe-last.log") && source.includes("progressHeartbeatAt") && source.includes("progressPid") && source.includes("run_with_heartbeat segmenting") && source.includes("validate_local_asr_inference") && source.includes("TENCENT_MODEL_URL=") && source.includes("bootstrap_uv") && source.includes("detect_uv_arch") && source.includes("setup_python_and_packages") && source.includes("UV_PYTHON_DOWNLOADS=automatic") && source.includes("UV_PYTHON_PREFERENCE=managed") && source.includes("PYTHON_BUILD_STANDALONE_BUILD=") && source.includes("PYTHON_BUILD_STANDALONE_VERSION=") && source.includes("PYTHON_RUNTIME_VERSION=") && source.includes("PYTHON_RUNTIME_SHA256_ARM64=") && source.includes("PYTHON_RUNTIME_SHA256_X64=") && source.includes("TENCENT_PYTHON_DOWNLOAD_BASE=") && source.includes("PORTABLE_PYTHON=") && source.includes("install_portable_python") && source.includes("python_runtime_sha256") && source.includes('verify_sha256 "$archive_path" "$expected_sha256"') && source.includes("sys.version.split()[0] == sys.argv[1]") && source.includes('"$PORTABLE_PYTHON" -m venv "$VENV_DIR"') && source.includes('"$UV_BIN" python install 3.12') && source.includes('"$UV_BIN" venv "$VENV_DIR" --python 3.12 --managed-python') && portablePythonIndex >= 0 && uvManagedPythonIndex > portablePythonIndex;
  }
  return hasMinimumInstallerVersion(
    source,
    /\$InstallerScriptVersion\s*=\s*["'](\d+)\.(\d+)\.(\d+)["']/,
    [1, 2, 26]
  ) && source.includes("function Assert-TranscribeScriptCandidate") && source.includes("function Start-TranscribeScriptUpdate") && source.includes("function Promote-TranscribeScriptUpdate") && source.includes("function Restore-TranscribeScriptUpdate") && source.includes("function Complete-TranscribeScriptUpdate") && source.includes("[System.Management.Automation.Language.Parser]::ParseFile") && !source.includes("$SimplifiedPrompt") && !source.includes("--prompt") && source.includes("progressHeartbeatAt") && source.includes("progressPid") && source.includes('-ProgressStage "segmenting"') && source.includes('$TranscriptQualityGuardVersion = "repeat-guard-v2"') && source.includes('$NativeProcessRunnerVersion = "diagnostics-process-v1"') && source.includes("Invoke-NativeProcess") && source.includes("System.Diagnostics.ProcessStartInfo") && source.includes("ReadToEndAsync") && !source.includes("Start-Process") && source.includes("Convert-ExitCodeToHex") && source.includes("$hex = Convert-ExitCodeToHex -ExitCode $ExitCode") && source.includes("[string]$InstallRoot") && source.includes("Install-ExtractedPackage") && !source.includes("Move-Item -LiteralPath $FfmpegStageDir -Destination $FfmpegDir") && source.includes("safeModelPath") && source.includes("$TencentCosAssetBaseUrl") && source.includes("$WhisperWindowsTencentUrls") && source.includes("$WhisperWindowsCompatibilityUrls") && source.includes("$WhisperWindowsCompatibilitySha256") && source.includes("$FfmpegTencentUrls") && source.includes("$ModelTencentUrls") && source.includes("Get-EnabledAssetUrls") && source.includes("$WhisperWindowsFallbackUrls") && source.includes("Test-IllegalInstructionExitCode") && source.includes("whisper-bin-x64-compat.zip") && source.includes("Assert-FileSha256") && source.includes("GitHub release page parsing failed") && source.includes("INSTALLER FAILED") && source.includes("$DownloadTimeoutSeconds = 1200") && source.includes("--max-time $DownloadTimeoutSeconds") && source.includes("System.Text.UTF8Encoding") && source.includes("ReadAllText($chunkTxt, $Utf8NoBom)") && source.includes("WriteAllText($OutputPath");
}
__name(isLocalAsrInstallerCurrent, "isLocalAsrInstallerCurrent");
function isLocalOcrInstallerCurrent(scriptText, isMac = false) {
  const source = String(scriptText || "");
  if (!source.includes(".wechat-inbox-local-ocr")) return false;
  if (!source.includes("rapidocr-onnxruntime==1.4.4")) return false;
  if (!source.includes("pillow==12.3.0")) return false;
  if (isMac) {
    return source.includes("TENCENT_OCR_ASSET_BASE_URL") && source.includes("TENCENT_PIP_INDEX_URL") && source.includes("TENCENT_PYTHON_INSTALL_MIRROR") && source.includes('PYTHON_BUILD_STANDALONE_BUILD="20260623"') && source.includes('PYTHON_BUILD_STANDALONE_VERSION="3.12.13+20260623"') && source.includes("PORTABLE_PYTHON=") && source.includes("download_with_retry") && source.includes("find_existing_python") && source.includes("install_portable_python") && source.includes('"$PORTABLE_PYTHON" -m venv "$VENV_DIR"') && source.includes(".wechat-inbox-local-asr/python-venv/bin/python");
  }
  return source.includes("$TencentOcrAssetBaseUrl") && source.includes("$TencentPipIndexUrl") && source.includes("$TencentPythonInstallMirror") && source.includes('$PythonBuildStandaloneBuild = "20260623"') && source.includes('$PythonBuildStandaloneVersion = "3.12.13+20260623"') && source.includes("$PortablePython") && source.includes("Download-TextFile") && source.includes("function Install-PortablePython") && source.includes("function Expand-TarGzArchiveWithPowerShell") && source.includes("unique-staging-transaction-v2") && source.includes("$python = Install-PortablePython") && source.includes("Invoke-Python -PythonCommand $python -m venv $VenvDir");
}
__name(isLocalOcrInstallerCurrent, "isLocalOcrInstallerCurrent");
function isTrustedLocalOcrInstallerSource(scriptText, expectedSha256, isMac = false) {
  const expected = String(expectedSha256 || "").trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected) || !isLocalOcrInstallerCurrent(scriptText, isMac)) return false;
  return sha256Hex(Buffer.from(String(scriptText || ""), "utf8")) === expected;
}
__name(isTrustedLocalOcrInstallerSource, "isTrustedLocalOcrInstallerSource");
function createRetryableTranscriptionError(message) {
  const error = new Error(message);
  error.retryable = true;
  error.code = "TRANSCRIPTION_PENDING";
  return error;
}
__name(createRetryableTranscriptionError, "createRetryableTranscriptionError");
function isRetryableTranscriptionError(error) {
  return Boolean(error && (error.retryable || error.code === "TRANSCRIPTION_PENDING"));
}
__name(isRetryableTranscriptionError, "isRetryableTranscriptionError");
function shouldBypassExistingLocalNoteDedupe(record) {
  const metadata = record && record.metadata || {};
  const type = String(record && record.type || "").toLowerCase();
  const sourceUrl = String(metadata.url || record && record.content || "").trim();
  return type === "voice" || metadata.webpageMediaType === "audio_video" || Boolean(metadata.audioFileID) || metadata.transcriptOnly === true || type === "webpage" && isDouyinUrl(sourceUrl) || isXiaohongshuUrl(sourceUrl);
}
__name(shouldBypassExistingLocalNoteDedupe, "shouldBypassExistingLocalNoteDedupe");
function getPluginRuntimeIdentity(manifestVersion = "") {
  const normalizedManifestVersion = String(manifestVersion || "").trim() || "unknown";
  return {
    manifestVersion: normalizedManifestVersion,
    runtimeVersion: PLUGIN_RUNTIME_VERSION,
    buildMarker: PLUGIN_RUNTIME_BUILD_MARKER,
    matchesManifest: normalizedManifestVersion === PLUGIN_RUNTIME_VERSION
  };
}
__name(getPluginRuntimeIdentity, "getPluginRuntimeIdentity");
function getSafeUrlDiagnostic(url = "") {
  try {
    const parsed = new URL(String(url || ""));
    return {
      protocol: parsed.protocol.replace(":", "").toLowerCase(),
      host: parsed.hostname.replace(/^www\./, "").toLowerCase()
    };
  } catch (error) {
    return { protocol: "", host: "" };
  }
}
__name(getSafeUrlDiagnostic, "getSafeUrlDiagnostic");
function getXiaohongshuCapabilityMatrix({
  hasProAccess = false,
  commentsEnabled = true,
  isLoggedIn = false,
  imageOcrEnabled = false
} = {}) {
  const pro = hasProAccess === true;
  return {
    publicGraphic: true,
    mediaTranscription: pro,
    imageOcr: pro && imageOcrEnabled === true,
    comments: pro && commentsEnabled !== false && isLoggedIn === true
  };
}
__name(getXiaohongshuCapabilityMatrix, "getXiaohongshuCapabilityMatrix");
function getXiaohongshuBrowserCandidates(sourceUrl = "", targetIdentityUrl = "", responseFinalUrl = "") {
  const result = [];
  const seen = /* @__PURE__ */ new Set();
  const add = /* @__PURE__ */ __name((url, kind) => {
    const value = String(url || "").trim();
    if (!value || seen.has(value) || !isXiaohongshuUrl(value)) return;
    seen.add(value);
    result.push({ url: value, kind });
  }, "add");
  add(sourceUrl, isXiaohongshuShortLinkUrl(sourceUrl) ? "original-shortlink" : "source-url");
  add(targetIdentityUrl, "resolved-url");
  add(responseFinalUrl, "response-final-url");
  return result;
}
__name(getXiaohongshuBrowserCandidates, "getXiaohongshuBrowserCandidates");
function isXiaohongshuShareBoilerplateOnly(extracted) {
  if (!extracted) return false;
  const source = Array.from(new Set([
    extracted.description,
    extracted.markdown
  ].map((item) => String(item || "").trim()).filter(Boolean))).join("\n");
  const hasShareLink = /(?:xhslink\.(?:cn|com)|xiaohongshu\.com\/(?:explore|discovery)\/)/i.test(source);
  const hasShareInstruction = /(?:存下|复制).{0,12}(?:口令|信息)|(?:打开|跳转).{0,12}(?:小红书|RED).{0,12}(?:阅读|查看)?/is.test(source);
  return hasShareInstruction && (hasShareLink || source.replace(/\s+/g, "").length <= 80);
}
__name(isXiaohongshuShareBoilerplateOnly, "isXiaohongshuShareBoilerplateOnly");
function classifyXiaohongshuPage({ html = "", resolvedUrl = "", extracted = null } = {}) {
  const finalHost = getSafeUrlDiagnostic(resolvedUrl).host;
  if (finalHost && finalHost !== "xiaohongshu.com" && !finalHost.endsWith(".xiaohongshu.com")) {
    return "unexpected-host";
  }
  if (isUnavailableXiaohongshuPage(html, resolvedUrl)) return "xiaohongshu-unavailable";
  if (isGenericXiaohongshuLandingExtraction(extracted) || isXiaohongshuShareBoilerplateOnly(extracted)) {
    return "xiaohongshu-generic-landing";
  }
  if (hasReadableXiaohongshuGraphicContent(extracted, html, resolvedUrl) || extracted && extracted.videoUrl) {
    return "xiaohongshu-note";
  }
  return "unknown";
}
__name(classifyXiaohongshuPage, "classifyXiaohongshuPage");
function scoreXiaohongshuExtraction(extracted, html = "", url = "") {
  if (!hasReadableXiaohongshuGraphicContent(extracted, html, url) && !(extracted && extracted.videoUrl)) return -1;
  return (String(extracted && extracted.title || "").trim() ? 1e3 : 0) + Math.min(String(extracted && extracted.description || "").trim().length, 2e3) + Math.min(String(extracted && extracted.markdown || "").trim().length, 4e3) + (Array.isArray(extracted && extracted.tags) ? extracted.tags.length * 100 : 0) + (Array.isArray(extracted && extracted.imageUrls) ? extracted.imageUrls.length * 500 : 0) + (extracted && extracted.videoUrl ? 300 : 0);
}
__name(scoreXiaohongshuExtraction, "scoreXiaohongshuExtraction");
function buildXiaohongshuBrowserAttemptDiagnostic(candidate = {}, page = null, extracted = null, error = null) {
  const html = String(page && page.html || "");
  const finalUrl = String(page && page.url || candidate.url || "");
  return {
    inputKind: String(candidate.kind || ""),
    attempted: true,
    finalHost: getSafeUrlDiagnostic(finalUrl).host,
    pageType: error ? "request-error" : classifyXiaohongshuPage({ html, resolvedUrl: finalUrl, extracted }),
    bodyCharacterCount: String(extracted && (extracted.description || extracted.markdown) || "").trim().length,
    imageCount: Array.isArray(extracted && extracted.imageUrls) ? extracted.imageUrls.length : 0,
    failed: Boolean(error),
    ...error && error.code === "BROWSER_TASK_TIMEOUT" ? { timedOut: true } : {}
  };
}
__name(buildXiaohongshuBrowserAttemptDiagnostic, "buildXiaohongshuBrowserAttemptDiagnostic");
function buildXiaohongshuFailureDiagnostic({
  manifestVersion = "",
  sourceUrl = "",
  resolvedUrl = "",
  responseStatus = 0,
  html = "",
  extracted = null,
  renderError = null,
  requestError = null,
  redirectDiagnostic = null,
  browserAttempts = []
} = {}) {
  const source = getSafeUrlDiagnostic(sourceUrl);
  const final = getSafeUrlDiagnostic(resolvedUrl);
  const title = String(extracted && extracted.title ? extracted.title : "").trim();
  const description = String(extracted && extracted.description ? extracted.description : "").trim();
  const shareBoilerplateOnly = isXiaohongshuShareBoilerplateOnly(extracted);
  const genericLanding = isGenericXiaohongshuLandingExtraction(extracted);
  return {
    runtime: getPluginRuntimeIdentity(manifestVersion),
    request: {
      sourceProtocol: source.protocol,
      sourceHost: source.host,
      finalProtocol: final.protocol,
      finalHost: final.host,
      redirected: Boolean(source.host && final.host && source.host !== final.host),
      responseStatus: Number(responseStatus) || 0,
      pageType: classifyXiaohongshuPage({ html, resolvedUrl, extracted }),
      renderFailed: Boolean(renderError),
      requestFailed: Boolean(requestError),
      browserTimedOut: Boolean(
        renderError && renderError.code === "BROWSER_TASK_TIMEOUT" || requestError && requestError.code === "BROWSER_TASK_TIMEOUT" || Array.isArray(browserAttempts) && browserAttempts.some((attempt) => attempt && attempt.timedOut === true)
      ),
      redirectCount: Number(redirectDiagnostic && redirectDiagnostic.redirectCount) || 0,
      usedGetFallback: Boolean(redirectDiagnostic && redirectDiagnostic.usedGetFallback),
      redirectAttempts: redirectDiagnostic && Array.isArray(redirectDiagnostic.attempts) ? redirectDiagnostic.attempts.map((attempt) => ({
        method: String(attempt && attempt.method || ""),
        status: Number(attempt && attempt.status) || 0,
        host: String(attempt && attempt.host || ""),
        outcome: String(attempt && attempt.outcome || "")
      })) : [],
      browserAttempts: (Array.isArray(browserAttempts) ? browserAttempts : []).map((attempt) => ({
        inputKind: String(attempt && attempt.inputKind || ""),
        attempted: Boolean(attempt && attempt.attempted),
        finalHost: String(attempt && attempt.finalHost || ""),
        pageType: String(attempt && attempt.pageType || ""),
        bodyCharacterCount: Number(attempt && attempt.bodyCharacterCount) || 0,
        imageCount: Number(attempt && attempt.imageCount) || 0,
        failed: Boolean(attempt && attempt.failed),
        ...attempt && attempt.timedOut === true ? { timedOut: true } : {}
      }))
    },
    extraction: {
      hasUsableTitle: Boolean(title && title !== "小红书笔记" && !isGenericXiaohongshuTitle(title)),
      bodyCharacterCount: shareBoilerplateOnly ? 0 : description.length,
      imageCount: extracted && Array.isArray(extracted.imageUrls) ? extracted.imageUrls.length : 0,
      shareBoilerplateOnly,
      genericLanding,
      unavailablePage: isUnavailableXiaohongshuPage(html, resolvedUrl)
    }
  };
}
__name(buildXiaohongshuFailureDiagnostic, "buildXiaohongshuFailureDiagnostic");
function createRetryableXiaohongshuContentError(diagnostic = {}) {
  const error = new Error("小红书内容提取失败，已记录诊断，下次同步将重试。");
  error.retryable = true;
  error.code = "XIAOHONGSHU_CONTENT_UNAVAILABLE";
  error.diagnostic = redactSensitiveObject(
    diagnostic && typeof diagnostic === "object" ? diagnostic : {}
  );
  return error;
}
__name(createRetryableXiaohongshuContentError, "createRetryableXiaohongshuContentError");
function isRetryableXiaohongshuContentError(error) {
  return Boolean(error && error.code === "XIAOHONGSHU_CONTENT_UNAVAILABLE");
}
__name(isRetryableXiaohongshuContentError, "isRetryableXiaohongshuContentError");
function getRecordXiaohongshuIdentityCandidates(record = {}) {
  const metadata = record && record.metadata && typeof record.metadata === "object" ? record.metadata : {};
  return [
    record && record.content,
    metadata.url,
    metadata.originalUrl,
    metadata.resolvedUrl,
    metadata.canonicalUrl,
    metadata.sourceUrl,
    metadata.noteUrl,
    metadata.shareUrl
  ].map((value) => String(value || "").trim()).filter(Boolean);
}
__name(getRecordXiaohongshuIdentityCandidates, "getRecordXiaohongshuIdentityCandidates");
function hasRecoverableXiaohongshuRecordIdentity(record = {}) {
  const metadata = record && record.metadata && typeof record.metadata === "object" ? record.metadata : {};
  const explicitNoteId = [
    metadata.noteId,
    metadata.note_id,
    metadata.xiaohongshuNoteId,
    metadata.xhsNoteId
  ].map((value) => String(value || "").trim()).find(Boolean);
  if (explicitNoteId) return true;
  return getRecordXiaohongshuIdentityCandidates(record).some((candidate) => Boolean(getXiaohongshuTargetNoteId(candidate)));
}
__name(hasRecoverableXiaohongshuRecordIdentity, "hasRecoverableXiaohongshuRecordIdentity");
function isPermanentlyExpiredXiaohongshuShortlinkRecord(record = {}, error = null) {
  if (!isRetryableXiaohongshuContentError(error)) return false;
  const metadata = record && record.metadata && typeof record.metadata === "object" ? record.metadata : {};
  if ([
    metadata.fileID,
    metadata.fileId,
    metadata.audioFileID,
    metadata.audioFileId
  ].some((value) => String(value || "").trim())) return false;
  const candidates = getRecordXiaohongshuIdentityCandidates(record);
  if (!candidates.some((candidate) => isXiaohongshuShortLinkUrl(candidate))) return false;
  if (hasRecoverableXiaohongshuRecordIdentity(record)) return false;
  const diagnostic = error && error.diagnostic && typeof error.diagnostic === "object" ? error.diagnostic : {};
  const request = diagnostic.request && typeof diagnostic.request === "object" ? diagnostic.request : {};
  const extraction = diagnostic.extraction && typeof diagnostic.extraction === "object" ? diagnostic.extraction : {};
  const responseStatus = Number(request.responseStatus) || 0;
  const pageType = String(request.pageType || "");
  const finalHost = String(request.finalHost || "").toLowerCase();
  const browserAttempts = Array.isArray(request.browserAttempts) ? request.browserAttempts.filter((attempt) => attempt && attempt.attempted === true) : [];
  const browserFallbacksOnlyConfirmedFailure = browserAttempts.length > 0 && browserAttempts.every((attempt) => attempt.failed !== true && ["xiaohongshu-generic-landing", "xiaohongshu-unavailable"].includes(
    String(attempt.pageType || "")
  ));
  return request.requestFailed !== true && request.renderFailed !== true && request.browserTimedOut !== true && responseStatus >= 200 && responseStatus < 400 && isHostnameWithinDomain(finalHost, "xiaohongshu.com") && ["xiaohongshu-generic-landing", "xiaohongshu-unavailable"].includes(pageType) && browserFallbacksOnlyConfirmedFailure && extraction.hasUsableTitle !== true;
}
__name(isPermanentlyExpiredXiaohongshuShortlinkRecord, "isPermanentlyExpiredXiaohongshuShortlinkRecord");
function isRemoteAsrDownloadFailure(error) {
  const message = String(error && error.message || error || "");
  return /Invalid audio URI|audio download failed|Audio download failed/i.test(message);
}
__name(isRemoteAsrDownloadFailure, "isRemoteAsrDownloadFailure");
function isRecordNotFoundError(error) {
  const message = String(error && error.message || error || "");
  return /Record not found/i.test(message);
}
__name(isRecordNotFoundError, "isRecordNotFoundError");
function getDoubaoTaskKey(audioUrl) {
  return crypto.createHash("sha256").update(String(audioUrl || "")).digest("hex");
}
__name(getDoubaoTaskKey, "getDoubaoTaskKey");
function createClientId() {
  return `obsidian-${crypto.randomBytes(16).toString("hex")}`;
}
__name(createClientId, "createClientId");
function isWindowsLocalAsrCommand(command) {
  const normalized = String(command || "").toLowerCase();
  return normalized.includes("powershell") && (normalized.includes("transcribe.ps1") || normalized.includes(LOCAL_ASR_HOME));
}
__name(isWindowsLocalAsrCommand, "isWindowsLocalAsrCommand");
function normalizeLocalTranscriptionCommand(command, platform = os.platform()) {
  const normalized = String(command || "").trim().replace(/\$env:USERPROFILE/gi, "%USERPROFILE%");
  if (getLocalAsrPlatform(platform) === "darwin" && isWindowsLocalAsrCommand(normalized)) {
    return getDefaultLocalTranscriptionCommand(platform);
  }
  return normalized;
}
__name(normalizeLocalTranscriptionCommand, "normalizeLocalTranscriptionCommand");
function extractLocalAsrInstallRootFromCommand(command, platform = os.platform()) {
  const source = String(command || "").trim();
  if (!source) return "";
  const localPlatform = getLocalAsrPlatform(platform);
  const scriptName = localPlatform === "darwin" ? "transcribe.sh" : "transcribe.ps1";
  const scriptPattern = escapeRegExp(scriptName);
  const quotedMatch = source.match(new RegExp(`["']([^"']*${scriptPattern})["']`, "i"));
  const unquotedMatch = quotedMatch ? null : source.match(new RegExp(`(?:^|\\s)([^\\s"']*${scriptPattern})(?:\\s|$)`, "i"));
  const scriptPath = String(quotedMatch && quotedMatch[1] || unquotedMatch && unquotedMatch[1] || "").trim();
  if (!scriptPath || /[%$]|\{|\}/.test(scriptPath)) return "";
  const normalizedScriptPath = localPlatform === "win32" ? path.win32.normalize(scriptPath) : path.posix.normalize(scriptPath.replace(/\\/g, "/"));
  const normalizedScriptName = localPlatform === "win32" ? path.win32.basename(normalizedScriptPath) : path.posix.basename(normalizedScriptPath);
  if (normalizedScriptName.toLowerCase() !== scriptName.toLowerCase()) return "";
  return localPlatform === "win32" ? path.win32.dirname(normalizedScriptPath) : path.posix.dirname(normalizedScriptPath);
}
__name(extractLocalAsrInstallRootFromCommand, "extractLocalAsrInstallRootFromCommand");
function normalizeBindings(settings) {
  const sourceBindings = Array.isArray(settings && settings.bindings) ? settings.bindings : [];
  const legacyToken = normalizeBindCodeInput(settings && settings.token);
  const seen = /* @__PURE__ */ new Set();
  const bindings = [];
  sourceBindings.forEach((item) => {
    const token = normalizeBindCodeInput(item && item.token);
    if (!token || seen.has(token)) return;
    if (item && item.status === "unbound") return;
    seen.add(token);
    bindings.push({
      token,
      label: String(item && item.label || "").trim() || `微信 ${bindings.length + 1}`,
      enabled: item && Object.prototype.hasOwnProperty.call(item, "enabled") ? Boolean(item.enabled) : true,
      status: String(item && item.status || "").trim() || (item && item.enabled === false ? "paused" : "bound"),
      boundAt: item && item.boundAt || "",
      lastSyncAt: item && item.lastSyncAt || "",
      unboundAt: item && item.unboundAt || "",
      lastError: item && item.lastError || ""
    });
  });
  if (legacyToken && !seen.has(legacyToken)) {
    bindings.unshift({
      token: legacyToken,
      label: "默认微信",
      enabled: true,
      status: "bound",
      boundAt: "",
      lastSyncAt: "",
      unboundAt: "",
      lastError: ""
    });
  }
  return bindings.slice(0, MAX_PLUGIN_BINDINGS);
}
__name(normalizeBindings, "normalizeBindings");
function canAddPluginBinding(settings, candidateToken) {
  const token = normalizeBindCodeInput(candidateToken);
  if (!token) return false;
  const bindings = normalizeBindings(settings);
  if (bindings.some((item) => item && item.token === token)) return true;
  return bindings.filter((item) => item.status !== "needs_rebind").length < MAX_PLUGIN_BINDINGS;
}
__name(canAddPluginBinding, "canAddPluginBinding");
function getPrimaryBindingToken(bindings) {
  const active = (Array.isArray(bindings) ? bindings : []).find((item) => item && item.enabled !== false && item.status !== "unbound" && item.token);
  return active ? active.token : "";
}
__name(getPrimaryBindingToken, "getPrimaryBindingToken");
function normalizeApiBase(apiBase) {
  const normalized = String(apiBase || "").trim() || DEFAULT_SETTINGS.apiBase;
  return LEGACY_OFFICIAL_SYNC_API_BASES.includes(normalized) ? OFFICIAL_SYNC_API_BASE : normalized;
}
__name(normalizeApiBase, "normalizeApiBase");
function normalizeLocallyQuarantinedRecordIds(value) {
  return [...new Set(
    (Array.isArray(value) ? value : []).map((item) => String(item || "").trim()).filter(Boolean)
  )].slice(0, 200);
}
__name(normalizeLocallyQuarantinedRecordIds, "normalizeLocallyQuarantinedRecordIds");
function mergeSettings(savedSettings, platform = os.platform()) {
  const sourceSettings = savedSettings && typeof savedSettings === "object" ? savedSettings : {};
  const savedSettingsVersion = Number(sourceSettings.settingsVersion) || 0;
  const merged = {
    ...DEFAULT_SETTINGS,
    ...sourceSettings
  };
  merged.apiBase = normalizeApiBase(merged.apiBase);
  const rawEntitlementStatus = merged.localTranscriptionEntitlementStatus && typeof merged.localTranscriptionEntitlementStatus === "object" && !Array.isArray(merged.localTranscriptionEntitlementStatus) ? merged.localTranscriptionEntitlementStatus : null;
  const entitlementBindingToken = normalizeBindCodeInput(rawEntitlementStatus && rawEntitlementStatus.bindingToken);
  const entitlementRedeemCode = normalizeBindCodeInput(
    rawEntitlementStatus && (rawEntitlementStatus.code || rawEntitlementStatus.redeemCode) || ""
  );
  const pendingBindToken = normalizeBindCodeInput(merged.pendingBindCode);
  if (entitlementRedeemCode && !merged.pendingRedeemCode) {
    merged.pendingRedeemCode = entitlementRedeemCode;
  }
  const hasSourceBinding = Array.isArray(merged.bindings) && merged.bindings.some((item) => normalizeBindCodeInput(item && item.token) && item.status !== "unbound");
  const canRestoreLegacyPendingBindCode = savedSettingsVersion < DEFAULT_SETTINGS.settingsVersion;
  const normalizedToken = normalizeBindCodeInput(merged.token) || entitlementBindingToken || (canRestoreLegacyPendingBindCode && !hasSourceBinding ? pendingBindToken : "");
  if (normalizedToken && !hasSourceBinding) {
    merged.bindings = [{
      token: normalizedToken,
      label: String(rawEntitlementStatus && rawEntitlementStatus.bindingLabel || "").trim() || "微信 1",
      enabled: true,
      status: "bound",
      boundAt: "",
      lastSyncAt: "",
      unboundAt: "",
      lastError: ""
    }];
  }
  merged.bindings = normalizeBindings(merged);
  const tokenBinding = merged.bindings.find((item) => item.token === normalizedToken && item.enabled !== false && item.status !== "unbound" && item.status !== "needs_rebind");
  merged.token = tokenBinding ? normalizedToken : getPrimaryBindingToken(merged.bindings);
  merged.pendingBindCode = merged.token === pendingBindToken ? "" : pendingBindToken;
  merged.pendingRedeemCode = normalizeBindCodeInput(merged.pendingRedeemCode);
  merged.localTranscriptionEntitlementStatus = rawEntitlementStatus;
  if (isInvalidCloudBaseEnvMessage(merged.localTranscriptionEntitlementStatus && merged.localTranscriptionEntitlementStatus.message)) {
    merged.localTranscriptionEntitlementStatus = null;
  }
  if (!merged.token && !merged.bindings.length) {
    if (merged.localTranscriptionEntitlementStatus && !merged.localTranscriptionEntitlementStatus.hasAccess) {
      merged.localTranscriptionEntitlementStatus = {
        hasAccess: false,
        plan: LOCAL_TRANSCRIPTION_PLAN,
        status: "unbound",
        expiresAt: ""
      };
    }
  }
  merged.proSetupLastCheckedAt = String(merged.proSetupLastCheckedAt || "").trim();
  merged.proEntitlementLastError = String(merged.proEntitlementLastError || "").trim();
  merged.proEntitlementLastErrorAt = String(merged.proEntitlementLastErrorAt || "").trim();
  merged.proSetupInstallPromptSnoozedUntil = String(merged.proSetupInstallPromptSnoozedUntil || "").trim();
  merged.clientId = String(merged.clientId || "").trim() || createClientId();
  merged.inboxDir = normalizeConfiguredVaultPath(merged.inboxDir);
  merged.noteSaveMode = normalizeNoteSaveMode(merged.noteSaveMode);
  merged.notePropertyFields = DEFAULT_NOTE_PROPERTY_FIELDS;
  merged.autoSyncOnLoad = true;
  merged.aiProvider = AI_PROVIDER_NAMES[merged.aiProvider] ? merged.aiProvider : DEFAULT_SETTINGS.aiProvider;
  merged.settingsVersion = DEFAULT_SETTINGS.settingsVersion;
  merged.aiMetadataEnabled = true;
  merged.xiaohongshuCommentsEnabled = savedSettingsVersion < 2 ? true : merged.xiaohongshuCommentsEnabled !== false;
  merged.xiaohongshuImageOcrConsentVersion = Number(merged.xiaohongshuImageOcrConsentVersion) === 1 ? 1 : 0;
  merged.xiaohongshuImageOcrEnabled = merged.xiaohongshuImageOcrConsentVersion === 1 && merged.xiaohongshuImageOcrEnabled === true;
  merged.saveOriginalMediaEnabled = merged.saveOriginalMediaEnabled === true;
  merged.wechatChannelsExperimentUrl = String(merged.wechatChannelsExperimentUrl || "").trim();
  merged.feishuOAuthStatus = merged.feishuOAuthStatus && typeof merged.feishuOAuthStatus === "object" && !Array.isArray(merged.feishuOAuthStatus) ? merged.feishuOAuthStatus : null;
  delete merged.feishuCloudOAuthEnabled;
  delete merged.feishuOpenApiEnabled;
  merged.feishuAppId = String(merged.feishuAppId || "").trim();
  merged.feishuAppSecret = String(merged.feishuAppSecret || "").trim();
  merged.deepseekApiKey = String(merged.deepseekApiKey || "").trim();
  merged.deepseekModel = String(merged.deepseekModel || "").trim() || DEFAULT_SETTINGS.deepseekModel;
  merged.deepseekBaseUrl = String(merged.deepseekBaseUrl || "").trim() || DEFAULT_SETTINGS.deepseekBaseUrl;
  merged.cloudPreTranscriptionEnabled = Boolean(merged.cloudPreTranscriptionEnabled);
  merged.cloudPreTranscriptionThresholdMinutes = normalizeCloudPreTranscriptionThresholdMinutes(merged.cloudPreTranscriptionThresholdMinutes);
  merged.localAsrPlatform = "auto";
  merged.localAsrInstallMode = normalizeLocalAsrInstallMode(merged.localAsrInstallMode);
  merged.localTranscriptionCommand = normalizeLocalTranscriptionCommand(
    merged.localTranscriptionCommand,
    resolveLocalAsrPlatform(merged.localAsrPlatform, platform)
  );
  merged.aliyunApiKey = String(merged.aliyunApiKey || "").trim();
  merged.aliyunModel = String(merged.aliyunModel || "").trim() || DEFAULT_SETTINGS.aliyunModel;
  merged.aliyunBaseUrl = String(merged.aliyunBaseUrl || "").trim() || DEFAULT_SETTINGS.aliyunBaseUrl;
  merged.doubaoAsrApiKey = String(merged.doubaoAsrApiKey || "").trim();
  const doubaoPollAttempts = Number(merged.doubaoPollAttempts);
  const doubaoPollIntervalMs = Number(merged.doubaoPollIntervalMs);
  merged.doubaoPollAttempts = Math.max(1, Number.isFinite(doubaoPollAttempts) ? doubaoPollAttempts : DEFAULT_SETTINGS.doubaoPollAttempts);
  merged.doubaoPollIntervalMs = Math.max(1e3, Number.isFinite(doubaoPollIntervalMs) ? doubaoPollIntervalMs : DEFAULT_SETTINGS.doubaoPollIntervalMs);
  merged.pendingDoubaoTasks = merged.pendingDoubaoTasks && typeof merged.pendingDoubaoTasks === "object" && !Array.isArray(merged.pendingDoubaoTasks) ? merged.pendingDoubaoTasks : {};
  merged.tencentSecretId = String(merged.tencentSecretId || "").trim();
  merged.tencentSecretKey = String(merged.tencentSecretKey || "").trim();
  merged.tencentRegion = String(merged.tencentRegion || "").trim() || DEFAULT_SETTINGS.tencentRegion;
  merged.tencentEngineModelType = String(merged.tencentEngineModelType || "").trim() || DEFAULT_SETTINGS.tencentEngineModelType;
  const pollAttempts = Number(merged.tencentPollAttempts);
  const pollIntervalMs = Number(merged.tencentPollIntervalMs);
  merged.tencentPollAttempts = Math.max(1, Number.isFinite(pollAttempts) ? pollAttempts : DEFAULT_SETTINGS.tencentPollAttempts);
  merged.tencentPollIntervalMs = Math.max(1e3, Number.isFinite(pollIntervalMs) ? pollIntervalMs : DEFAULT_SETTINGS.tencentPollIntervalMs);
  merged.locallyQuarantinedRecordIds = normalizeLocallyQuarantinedRecordIds(
    merged.locallyQuarantinedRecordIds
  );
  merged.pendingSyncLifecycleAttempts = normalizePendingSyncLifecycleAttempts(
    merged.pendingSyncLifecycleAttempts
  );
  return merged;
}
__name(mergeSettings, "mergeSettings");
function validateSettings(settings) {
  const errors = [];
  if (!settings.apiBase) errors.push("请填写同步 API 地址");
  const hasEnabledBinding = Array.isArray(settings.bindings) && settings.bindings.some((item) => item && item.enabled !== false && item.status !== "unbound" && item.token);
  if (!settings.token && !hasEnabledBinding) errors.push("请填写小程序绑定码");
  return errors;
}
__name(validateSettings, "validateSettings");
function isBindingInvalidMessage(message) {
  const text = String(message || "");
  return text.includes("绑定码未绑定或已失效") || text.includes("Invalid bind code") || text.includes("Invalid or expired token");
}
__name(isBindingInvalidMessage, "isBindingInvalidMessage");
function getPrimaryBoundToken(bindings) {
  const active = (Array.isArray(bindings) ? bindings : []).find((item) => item && item.enabled !== false && item.status !== "unbound" && item.token);
  return active ? active.token : "";
}
__name(getPrimaryBoundToken, "getPrimaryBoundToken");
function trimTrailingSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}
__name(trimTrailingSlash, "trimTrailingSlash");
function isRequestUrlTransportError(message) {
  const text = String(message || "");
  return text.includes("net::ERR_") || text.includes("ERR_CONNECTION_") || text.includes("ECONNRESET") || text.includes("ETIMEDOUT") || text.includes("socket hang up") || text.includes("NetworkError") || /Request failed,\s*status\s+5\d\d/i.test(text);
}
__name(isRequestUrlTransportError, "isRequestUrlTransportError");
function isInvalidCloudBaseEnvMessage(message) {
  const text = String(message || "");
  return /INVALID_ENV/i.test(text) || /Env Not Exists/i.test(text);
}
__name(isInvalidCloudBaseEnvMessage, "isInvalidCloudBaseEnvMessage");
function requestJsonViaNode(options) {
  return new Promise((resolve, reject) => {
    const signal = options && options.signal;
    if (signal && signal.aborted) {
      reject(createAbortError());
      return;
    }
    let settled = false;
    let request = null;
    const cleanupAbort = /* @__PURE__ */ __name(() => {
      if (signal && typeof signal.removeEventListener === "function") {
        signal.removeEventListener("abort", onAbort);
      }
    }, "cleanupAbort");
    const settle = /* @__PURE__ */ __name((callback, value) => {
      if (settled) return;
      settled = true;
      cleanupAbort();
      callback(value);
    }, "settle");
    const onAbort = /* @__PURE__ */ __name(() => {
      const error = createAbortError();
      if (request && typeof request.destroy === "function") request.destroy(error);
      settle(reject, error);
    }, "onAbort");
    let parsedUrl;
    try {
      parsedUrl = new URL(options.url);
    } catch (error) {
      settle(reject, error);
      return;
    }
    const transport = parsedUrl.protocol === "http:" ? http : https;
    const body = options.body || "";
    const maxBytes = Number(options.maxBytes) > 0 ? Number(options.maxBytes) : 16 * 1024 * 1024;
    const headers = {
      ...options.headers || {},
      "User-Agent": "WeChat-Inbox-Sync-Obsidian/1.0"
    };
    if (body && !headers["Content-Length"]) {
      headers["Content-Length"] = Buffer.byteLength(body);
    }
    request = transport.request(parsedUrl, {
      method: options.method || "GET",
      headers,
      timeout: options.timeout || 2e4
    }, (response) => {
      const chunks = [];
      let receivedBytes = 0;
      let rejectedForSize = false;
      response.on("data", (chunk) => {
        if (rejectedForSize) return;
        const buffer = Buffer.from(chunk);
        receivedBytes += buffer.length;
        if (receivedBytes > maxBytes) {
          rejectedForSize = true;
          const error = new Error("Node HTTP response exceeded the configured size limit");
          settle(reject, error);
          if (typeof response.destroy === "function") response.destroy(error);
          if (typeof request.destroy === "function") request.destroy(error);
          return;
        }
        chunks.push(buffer);
      });
      response.on("end", () => {
        if (rejectedForSize) return;
        const buffer = Buffer.concat(chunks);
        const text = buffer.toString("utf8");
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch (error) {
          json = null;
        }
        settle(resolve, {
          status: response.statusCode,
          headers: response.headers,
          text,
          json,
          arrayBuffer: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength)
        });
      });
      response.on("error", (error) => settle(reject, error));
    });
    request.on("timeout", () => {
      request.destroy(new Error("Node HTTP request timeout"));
    });
    request.on("error", (error) => settle(reject, error));
    if (signal && typeof signal.addEventListener === "function") {
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) {
        onAbort();
        return;
      }
    }
    if (body) request.write(body);
    request.end();
  });
}
__name(requestJsonViaNode, "requestJsonViaNode");
function createAbortError(message = "当前转写已停止") {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}
__name(createAbortError, "createAbortError");
function isAbortError(error) {
  return error && (error.name === "AbortError" || /aborted|abort|已停止|用户已停止/i.test(error.message || ""));
}
__name(isAbortError, "isAbortError");
function throwIfAborted(signal) {
  if (signal && signal.aborted) {
    throw createAbortError();
  }
}
__name(throwIfAborted, "throwIfAborted");
function waitForPromiseWithAbort(promise, signal) {
  throwIfAborted(signal);
  if (!signal || typeof signal.addEventListener !== "function") {
    return Promise.resolve(promise);
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = /* @__PURE__ */ __name(() => {
      if (typeof signal.removeEventListener === "function") {
        signal.removeEventListener("abort", onAbort);
      }
    }, "cleanup");
    const finish = /* @__PURE__ */ __name((callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    }, "finish");
    const onAbort = /* @__PURE__ */ __name(() => finish(reject, createAbortError()), "onAbort");
    signal.addEventListener("abort", onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    Promise.resolve(promise).then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error)
    );
  });
}
__name(waitForPromiseWithAbort, "waitForPromiseWithAbort");
function createMediaDownloadTimeoutError(kind = "idle") {
  const detail = kind === "total" ? "媒体下载超时：下载超过最大等待时间仍未完成" : "媒体下载超时：连接长时间没有下载进度";
  const error = new Error(`MEDIA_DOWNLOAD_TIMEOUT: ${detail}`);
  error.code = "MEDIA_DOWNLOAD_TIMEOUT";
  return error;
}
__name(createMediaDownloadTimeoutError, "createMediaDownloadTimeoutError");
function createMediaDownloadInterruptedError() {
  const error = new Error("MEDIA_DOWNLOAD_INTERRUPTED: 媒体下载连接中断");
  error.code = "MEDIA_DOWNLOAD_INTERRUPTED";
  return error;
}
__name(createMediaDownloadInterruptedError, "createMediaDownloadInterruptedError");
function downloadArrayBufferViaNode(url, headers = {}, options = {}, redirectCount = 0, deadlineAt = 0) {
  return new Promise((resolve, reject) => {
    let parsedUrl;
    try {
      parsedUrl = new URL(url);
    } catch (error) {
      reject(error);
      return;
    }
    const signal = options.signal || null;
    if (signal && signal.aborted) {
      reject(createAbortError());
      return;
    }
    const totalTimeoutMs = Math.max(0, Number(options.totalTimeoutMs) || 15 * 60 * 1e3);
    const requestDeadlineAt = Number(deadlineAt) > 0 ? Number(deadlineAt) : totalTimeoutMs > 0 ? Date.now() + totalTimeoutMs : 0;
    const remainingTotalTimeoutMs = requestDeadlineAt > 0 ? requestDeadlineAt - Date.now() : 0;
    if (requestDeadlineAt > 0 && remainingTotalTimeoutMs <= 0) {
      reject(createMediaDownloadTimeoutError("total"));
      return;
    }
    const transport = parsedUrl.protocol === "http:" ? http : https;
    const idleTimeoutMs = Math.max(1e3, Number(options.idleTimeoutMs || options.timeout) || 9e4);
    let request = null;
    let totalTimeoutTimer = null;
    let settled = false;
    let abort = null;
    const clearTotalTimeout = /* @__PURE__ */ __name(() => {
      if (totalTimeoutTimer) clearTimeout(totalTimeoutTimer);
      totalTimeoutTimer = null;
    }, "clearTotalTimeout");
    const finish = /* @__PURE__ */ __name((callback, value) => {
      if (settled) return;
      settled = true;
      clearTotalTimeout();
      if (signal && abort && typeof signal.removeEventListener === "function") {
        signal.removeEventListener("abort", abort);
      }
      callback(value);
    }, "finish");
    const fail = /* @__PURE__ */ __name((error) => {
      if (request && !request.destroyed) request.destroy();
      finish(reject, error instanceof Error ? error : new Error(String(error || "媒体下载失败")));
    }, "fail");
    request = transport.request(parsedUrl, {
      method: "GET",
      headers,
      timeout: idleTimeoutMs
    }, (response) => {
      const location = response.headers && response.headers.location;
      if (response.statusCode >= 300 && response.statusCode < 400 && location && redirectCount < 5) {
        clearTotalTimeout();
        response.resume();
        try {
          const nextUrl = new URL(location, url).toString();
          downloadArrayBufferViaNode(nextUrl, headers, options, redirectCount + 1, requestDeadlineAt).then((value) => finish(resolve, value), (error) => finish(reject, error));
        } catch (error) {
          finish(reject, error);
        }
        return;
      }
      if (response.statusCode && (response.statusCode < 200 || response.statusCode >= 300)) {
        response.resume();
        finish(reject, new Error(`媒体下载失败：HTTP ${response.statusCode}`));
        return;
      }
      const chunks = [];
      let received = 0;
      const total = Number(response.headers && response.headers["content-length"]) || 0;
      response.once("aborted", () => fail(createMediaDownloadInterruptedError()));
      response.once("error", (error) => fail(error && error.code ? error : createMediaDownloadInterruptedError()));
      response.on("data", (chunk) => {
        if (settled) return;
        if (signal && signal.aborted) {
          fail(createAbortError());
          return;
        }
        const buffer = Buffer.from(chunk);
        chunks.push(buffer);
        received += buffer.length;
        if (typeof options.onProgress === "function") {
          options.onProgress({
            received,
            total,
            percent: total > 0 ? Math.max(1, Math.min(99, Math.floor(received * 100 / total))) : null
          });
        }
      });
      response.once("end", () => {
        if (signal && signal.aborted) {
          finish(reject, createAbortError());
          return;
        }
        const buffer = Buffer.concat(chunks);
        if (typeof options.onProgress === "function") {
          options.onProgress({
            received,
            total: total || received,
            percent: 100
          });
        }
        finish(resolve, buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength));
      });
    });
    if (requestDeadlineAt > 0) {
      totalTimeoutTimer = setTimeout(() => fail(createMediaDownloadTimeoutError("total")), remainingTotalTimeoutMs);
      if (totalTimeoutTimer && typeof totalTimeoutTimer.unref === "function") totalTimeoutTimer.unref();
    }
    abort = /* @__PURE__ */ __name(() => fail(createAbortError()), "abort");
    if (signal && typeof signal.addEventListener === "function") {
      signal.addEventListener("abort", abort, { once: true });
    }
    request.on("timeout", () => fail(createMediaDownloadTimeoutError("idle")));
    request.on("error", (error) => finish(reject, error));
    request.end();
  });
}
__name(downloadArrayBufferViaNode, "downloadArrayBufferViaNode");
function getRecordId(record) {
  return record._id || record.id || "";
}
__name(getRecordId, "getRecordId");
function getTypeDisplayName(type) {
  const normalized = String(type || "").toLowerCase();
  if (!TYPE_DISPLAY_NAMES[normalized]) {
    throw new Error(`Unsupported record type: ${type}`);
  }
  return TYPE_DISPLAY_NAMES[normalized];
}
__name(getTypeDisplayName, "getTypeDisplayName");
function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
__name(sha256Hex, "sha256Hex");
function hmacSha256(key, value, encoding) {
  return crypto.createHmac("sha256", key).update(value).digest(encoding);
}
__name(hmacSha256, "hmacSha256");
function formatTencentDate(timestamp) {
  return new Date(timestamp * 1e3).toISOString().slice(0, 10);
}
__name(formatTencentDate, "formatTencentDate");
function buildTencentCreateRecTaskBody({ audioUrl, engineModelType }) {
  return {
    EngineModelType: engineModelType || DEFAULT_SETTINGS.tencentEngineModelType,
    ChannelNum: 1,
    ResTextFormat: 0,
    SourceType: 0,
    Url: audioUrl
  };
}
__name(buildTencentCreateRecTaskBody, "buildTencentCreateRecTaskBody");
function buildTencentRequest({
  action,
  region,
  secretId,
  secretKey,
  body,
  timestamp = Math.floor(Date.now() / 1e3)
}) {
  const payload = JSON.stringify(body || {});
  const httpRequestMethod = "POST";
  const canonicalUri = "/";
  const canonicalQueryString = "";
  const canonicalHeaders = [
    "content-type:application/json; charset=utf-8",
    `host:${TENCENT_ASR_HOST}`,
    `x-tc-action:${String(action).toLowerCase()}`,
    ""
  ].join("\n");
  const signedHeaders = "content-type;host;x-tc-action";
  const hashedRequestPayload = sha256Hex(payload);
  const canonicalRequest = [
    httpRequestMethod,
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    hashedRequestPayload
  ].join("\n");
  const algorithm = "TC3-HMAC-SHA256";
  const date = formatTencentDate(timestamp);
  const credentialScope = `${date}/${TENCENT_ASR_SERVICE}/tc3_request`;
  const stringToSign = [
    algorithm,
    String(timestamp),
    credentialScope,
    sha256Hex(canonicalRequest)
  ].join("\n");
  const secretDate = hmacSha256(`TC3${secretKey}`, date);
  const secretService = hmacSha256(secretDate, TENCENT_ASR_SERVICE);
  const secretSigning = hmacSha256(secretService, "tc3_request");
  const signature = hmacSha256(secretSigning, stringToSign, "hex");
  const authorization = `${algorithm} Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return {
    url: `https://${TENCENT_ASR_HOST}`,
    body: payload,
    canonicalRequest,
    headers: {
      Authorization: authorization,
      "Content-Type": "application/json; charset=utf-8",
      Host: TENCENT_ASR_HOST,
      "X-TC-Action": action,
      "X-TC-Version": TENCENT_ASR_VERSION,
      "X-TC-Timestamp": String(timestamp),
      "X-TC-Region": region || DEFAULT_SETTINGS.tencentRegion
    }
  };
}
__name(buildTencentRequest, "buildTencentRequest");
function isVideoPlatform(platform, url = "") {
  const source = `${String(platform || "")} ${String(url || "")}`.toLowerCase();
  return /抖音|小红书|b站|bilibili|douyin|xiaohongshu/.test(source);
}
__name(isVideoPlatform, "isVideoPlatform");
function cleanTrailingTranscriptionHallucinations(text) {
  const lines = String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length < 2) return lines.join("\n");
  const isCredit = /* @__PURE__ */ __name((line) => /^(?:字幕|字幕\s*by|字幕\s*:|翻译|校对|制作|subtitles?\s*(?:by|:))/i.test(line), "isCredit");
  const isCorruptedClosing = /* @__PURE__ */ __name((line) => /(?:我们|咱们).{0,10}(?:下身|下生|下声|下省)(?:再见|见)[。！!]?$/u.test(line), "isCorruptedClosing");
  const isShortAsciiNoise = /* @__PURE__ */ __name((line) => /^[a-z\s'.,!?-]{1,40}$/i.test(line), "isShortAsciiNoise");
  const isRepeatedVisualNoise = /* @__PURE__ */ __name((line) => /画面.{0,8}画面/u.test(line), "isRepeatedVisualNoise");
  const knownTailHallucinationStart = lines.findIndex((line, index) => index >= Math.max(1, lines.length - 12) && /请不吝.{0,12}点赞.{0,12}订阅.{0,12}转发.{0,12}打赏.{0,20}明镜/u.test(line));
  let cutoff = knownTailHallucinationStart >= 0 ? knownTailHallucinationStart : lines.length;
  for (let index = lines.length - 1; index >= 1; index -= 1) {
    const line = lines[index];
    const repeated = line === lines[index - 1];
    if (isCredit(line) || isCorruptedClosing(line) || repeated) {
      cutoff = Math.min(cutoff, repeated ? index - 1 : index);
      continue;
    }
    if (cutoff < lines.length && (isShortAsciiNoise(line) || isRepeatedVisualNoise(line))) {
      cutoff = index;
      continue;
    }
    break;
  }
  const tailStart = Math.max(3, lines.length - 36);
  const tailOccurrences = /* @__PURE__ */ new Map();
  lines.slice(tailStart).forEach((line, offset) => {
    const normalized = normalizeTranscriptionQualityUnit(line);
    if (normalized.length < 4) return;
    const indexes = tailOccurrences.get(normalized) || [];
    indexes.push(tailStart + offset);
    tailOccurrences.set(normalized, indexes);
  });
  let repeatedTailStart = lines.length;
  tailOccurrences.forEach((indexes) => {
    if (indexes.length >= 6) {
      repeatedTailStart = Math.min(repeatedTailStart, indexes[0]);
    }
  });
  if (repeatedTailStart < lines.length) {
    const prefix = lines.slice(0, repeatedTailStart).join("");
    if (repeatedTailStart >= 3 && prefix.length >= 80) {
      cutoff = Math.min(cutoff, repeatedTailStart);
      for (let index = cutoff - 1; index >= 1; index -= 1) {
        const line = lines[index];
        if (isCredit(line) || isShortAsciiNoise(line) || isRepeatedVisualNoise(line)) {
          cutoff = index;
          continue;
        }
        break;
      }
    }
  }
  return lines.slice(0, cutoff).join("\n").trim();
}
__name(cleanTrailingTranscriptionHallucinations, "cleanTrailingTranscriptionHallucinations");
function buildAliyunVoiceRequest({ settings, audioUrl }) {
  return {
    model: settings.aliyunModel || DEFAULT_SETTINGS.aliyunModel,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "input_audio",
            input_audio: {
              data: audioUrl,
              format: getAudioFormatFromUrl(audioUrl)
            }
          },
          {
            type: "text",
            text: ALIYUN_TRANSCRIPTION_PROMPT
          }
        ]
      }
    ],
    modalities: ["text"],
    stream: true,
    stream_options: {
      include_usage: false
    }
  };
}
__name(buildAliyunVoiceRequest, "buildAliyunVoiceRequest");
function createRequestId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
__name(createRequestId, "createRequestId");
function buildDoubaoAsrRequest({ apiKey, audioUrl, requestId = createRequestId() }) {
  return {
    url: DOUBAO_ASR_SUBMIT_URL,
    throw: false,
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": apiKey,
      "X-Api-Resource-Id": DOUBAO_ASR_RESOURCE_ID,
      "X-Api-Request-Id": requestId,
      "X-Api-Sequence": "-1"
    },
    body: {
      user: {
        uid: "wechat-inbox-sync"
      },
      audio: {
        url: audioUrl,
        format: getAudioFormatFromUrl(audioUrl),
        codec: "raw",
        rate: 16e3,
        bits: 16,
        channel: 1
      },
      request: {
        model_name: "bigmodel",
        enable_itn: true,
        enable_punc: true,
        enable_ddc: false,
        enable_speaker_info: true,
        enable_channel_split: false,
        show_utterances: true,
        vad_segment: false,
        sensitive_words_filter: ""
      }
    }
  };
}
__name(buildDoubaoAsrRequest, "buildDoubaoAsrRequest");
function buildDoubaoAsrQueryRequest({ apiKey, requestId }) {
  return {
    url: DOUBAO_ASR_QUERY_URL,
    throw: false,
    headers: {
      "Content-Type": "application/json",
      "X-Api-Key": apiKey,
      "X-Api-Resource-Id": DOUBAO_ASR_RESOURCE_ID,
      "X-Api-Request-Id": requestId
    },
    body: {}
  };
}
__name(buildDoubaoAsrQueryRequest, "buildDoubaoAsrQueryRequest");
function sleep(ms) {
  const schedule = typeof globalThis !== "undefined" && typeof globalThis.setTimeout === "function" ? globalThis.setTimeout.bind(globalThis) : window.setTimeout.bind(window);
  return new Promise((resolve) => schedule(resolve, ms));
}
__name(sleep, "sleep");
function shouldGenerateAiMetadata(settings, record) {
  if (!record || !record.metadata) return false;
  const metadata = record.metadata || {};
  if (!extractAiMetadataInputText(record)) return false;
  const type = String(record.type || "").toLowerCase();
  const hasCompletedTranscript = metadata.transcriptionStatus === "success" && String(metadata.transcription || "").trim() && (metadata.transcriptOnly || metadata.webpageMediaType === "audio_video" || type === "voice" || type === "file" && metadata.transcriptionSource);
  if (hasCompletedTranscript) return true;
  if (type === "webpage" || type === "link") {
    return true;
  }
  return !getRecordDescription(metadata) || !getRecordKeywords(metadata).length;
}
__name(shouldGenerateAiMetadata, "shouldGenerateAiMetadata");
function cleanMarkdownForStorage(markdown, options = {}) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const out = [];
  const seen = /* @__PURE__ */ new Map();
  let lastWasBlank = true;
  let pendingListMarker = "";
  let inFence = false;
  let skippedFeishuOpeningOutline = false;
  let feishuOpeningOutlineCount = 0;
  let feishuOpeningContentStarted = false;
  lines.forEach((line) => {
    const rawLine = String(line || "").replace(/\u200b/g, "").replace(/\ufeff/g, "");
    const listIndentMatch = options.preserveListIndent ? rawLine.match(/^([ \t]+)(?=[-*]\s+)/) : null;
    const listIndent = listIndentMatch && listIndentMatch[1] ? listIndentMatch[1] : "";
    if (/^\s*```/.test(rawLine)) {
      out.push(rawLine.trim());
      inFence = !inFence;
      lastWasBlank = false;
      pendingListMarker = "";
      return;
    }
    if (inFence) {
      out.push(rawLine);
      lastWasBlank = false;
      return;
    }
    let text = String(line || "").replace(/\u200b/g, "").replace(/\ufeff/g, "").replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16))).replace(/&quot;/g, '"').trim();
    if (options.feishuTitle) {
      text = normalizeFeishuMarkdownLine(text, options.feishuTitle);
    }
    if (!text) {
      if (pendingListMarker) {
        return;
      }
      if (!lastWasBlank && out.length) {
        out.push("");
        lastWasBlank = true;
      }
      return;
    }
    if (options.feishuTitle && shouldDropFeishuLine(text, options.feishuTitle) && !isFeishuCodeLanguageLine(text)) {
      return;
    }
    if (options.feishuTitle && !feishuOpeningContentStarted && /^-\s+/.test(text)) {
      feishuOpeningOutlineCount += 1;
      if (feishuOpeningOutlineCount >= 3 || skippedFeishuOpeningOutline) {
        skippedFeishuOpeningOutline = true;
        return;
      }
    } else if (text && !/^!\[/.test(text)) {
      if (!/^#{1,6}\s+/.test(text) && !/^-\s+/.test(text) && text.length >= 12 && /[。！？.!?]/.test(text)) {
        feishuOpeningContentStarted = true;
      }
    }
    if (/^\d+\.$/.test(text) || /^[•·]$/.test(text)) {
      pendingListMarker = text === "•" || text === "·" ? "-" : text;
      return;
    }
    if (pendingListMarker) {
      text = `${pendingListMarker} ${text}`;
      pendingListMarker = "";
    }
    if (options.feishuTitle) {
      text = formatFeishuHeadingLine(text, options.feishuTitle);
    }
    if (options.dedupe && !text.startsWith("|")) {
      const key = text.replace(/^#{1,6}\s+/, "").replace(/\*\*/g, "").replace(/\s+/g, " ");
      const maxRepeats = Array.from(key).length <= 3 ? 2 : 1;
      const count = seen.get(key) || 0;
      if (count >= maxRepeats) {
        return;
      }
      seen.set(key, count + 1);
    }
    out.push(listIndent && /^[-*]\s+/.test(text) ? `${listIndent}${text}` : text);
    lastWasBlank = false;
  });
  let cleaned = restoreFlattenedSarBandTables(out).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  if (options.feishuTitle) {
    cleaned = postProcessFeishuMarkdown(cleaned, options.feishuTitle);
  }
  return cleaned;
}
__name(cleanMarkdownForStorage, "cleanMarkdownForStorage");
function escapeRegExp(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
__name(escapeRegExp, "escapeRegExp");
function isFeishuUrl(url) {
  const text = String(url || "").toLowerCase();
  return text.includes("feishu.cn") || text.includes("larksuite.com") || text.includes("feishu.net") || text.includes("feishu");
}
__name(isFeishuUrl, "isFeishuUrl");
function isWechatArticleUrl(url) {
  const text = String(url || "").toLowerCase();
  return text.includes("mp.weixin.qq.com") || text.includes("weixin.qq.com");
}
__name(isWechatArticleUrl, "isWechatArticleUrl");
function isWechatExplicitDecorativeImageAsset(asset) {
  if (!asset) return false;
  const alt = String(asset.alt || "").trim();
  if (alt && !/^(?:图片|image|img)$/i.test(alt)) return false;
  const sourceUrl = String(asset.imageUrl || "").toLowerCase();
  const hasExplicitDecorativeSignal = /(?:^|[\/_.?-])(?:decorative|spacer|separator|divider|loading|placeholder|tracking-pixel|tracker)(?:[\/_.?=&-]|$)/i.test(sourceUrl);
  if (!hasExplicitDecorativeSignal) return false;
  const dimensions = asset.dimensions;
  if (!dimensions) return false;
  const width = Number(dimensions.width) || 0;
  const height = Number(dimensions.height) || 0;
  return width > 0 && height > 0 && Math.max(width, height) <= 256;
}
__name(isWechatExplicitDecorativeImageAsset, "isWechatExplicitDecorativeImageAsset");
function isWechatMpArticleUrl(url) {
  const source = String(url || "").trim();
  if (!source) return false;
  try {
    const parsed = new URL(source);
    return /(^|\.)mp\.weixin\.qq\.com$/i.test(parsed.hostname);
  } catch (error) {
    return source.toLowerCase().includes("mp.weixin.qq.com");
  }
}
__name(isWechatMpArticleUrl, "isWechatMpArticleUrl");
function isWechatCaptchaUrl(url) {
  return /\/mp\/wappoc_appmsgcaptcha\b/i.test(String(url || ""));
}
__name(isWechatCaptchaUrl, "isWechatCaptchaUrl");
function decodeUrlComponentSafely(value) {
  let text = decodeHtmlEntities(String(value || "")).trim();
  for (let index = 0; index < 2; index += 1) {
    try {
      const decoded = decodeURIComponent(text);
      if (decoded === text) break;
      text = decoded;
    } catch (error) {
      break;
    }
  }
  return text;
}
__name(decodeUrlComponentSafely, "decodeUrlComponentSafely");
function extractWechatCaptchaTargetUrl(url) {
  const source = String(url || "");
  try {
    const parsed = new URL(source);
    const targetUrl = parsed.searchParams.get("target_url");
    if (targetUrl) return decodeUrlComponentSafely(targetUrl);
  } catch (error) {
  }
  const match = source.match(/[?&]target_url=([^&#]+)/i);
  return match && match[1] ? decodeUrlComponentSafely(match[1]) : "";
}
__name(extractWechatCaptchaTargetUrl, "extractWechatCaptchaTargetUrl");
function cleanDisplayUrl(url) {
  const source = String(url || "").trim();
  if (!source) return "";
  const target = extractWechatCaptchaTargetUrl(source) || source;
  if (!isWechatArticleUrl(target)) return source;
  try {
    const parsed = new URL(target);
    if (!/mp\.weixin\.qq\.com$/i.test(parsed.hostname)) return source;
    const cleaned = new URL(`${parsed.protocol}//${parsed.hostname}${parsed.pathname || "/s"}`);
    ["__biz", "mid", "idx", "sn"].forEach((key) => {
      const value = parsed.searchParams.get(key);
      if (value) cleaned.searchParams.set(key, value);
    });
    return cleaned.search ? cleaned.toString() : `${cleaned.origin}${cleaned.pathname}`;
  } catch (error) {
    return source;
  }
}
__name(cleanDisplayUrl, "cleanDisplayUrl");
function getHttpUrlHostname(url) {
  try {
    const parsed = new URL(String(url || "").trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return String(parsed.hostname || "").toLowerCase().replace(/\.$/, "");
  } catch (error) {
    return "";
  }
}
__name(getHttpUrlHostname, "getHttpUrlHostname");
function isHostnameWithinDomain(hostname, domain) {
  const host = String(hostname || "").toLowerCase().replace(/\.$/, "");
  const root = String(domain || "").toLowerCase().replace(/\.$/, "");
  return Boolean(host && root && (host === root || host.endsWith(`.${root}`)));
}
__name(isHostnameWithinDomain, "isHostnameWithinDomain");
function isXiaohongshuUrl(url) {
  const hostname = getHttpUrlHostname(url);
  return isHostnameWithinDomain(hostname, "xiaohongshu.com") || isHostnameWithinDomain(hostname, "xhslink.com") || isHostnameWithinDomain(hostname, "xhslink.cn");
}
__name(isXiaohongshuUrl, "isXiaohongshuUrl");
function isXiaohongshuShortLinkUrl(url) {
  const hostname = getHttpUrlHostname(url);
  return isHostnameWithinDomain(hostname, "xhslink.com") || isHostnameWithinDomain(hostname, "xhslink.cn");
}
__name(isXiaohongshuShortLinkUrl, "isXiaohongshuShortLinkUrl");
function isTrustedXiaohongshuCookieUrl(url) {
  try {
    const parsed = new URL(String(url || "").trim());
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && (!parsed.port || parsed.port === "443") && isHostnameWithinDomain(parsed.hostname, "xiaohongshu.com");
  } catch (error) {
    return false;
  }
}
__name(isTrustedXiaohongshuCookieUrl, "isTrustedXiaohongshuCookieUrl");
function isTrustedXiaohongshuTransportUrl(url) {
  try {
    const parsed = new URL(String(url || "").trim());
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && (!parsed.port || parsed.port === "443") && (isHostnameWithinDomain(parsed.hostname, "xiaohongshu.com") || isHostnameWithinDomain(parsed.hostname, "xhslink.com") || isHostnameWithinDomain(parsed.hostname, "xhslink.cn"));
  } catch (error) {
    return false;
  }
}
__name(isTrustedXiaohongshuTransportUrl, "isTrustedXiaohongshuTransportUrl");
function isDouyinUrl(url) {
  const text = String(url || "").toLowerCase();
  return text.includes("douyin.com") || text.includes("iesdouyin.com") || text.includes("amemv.com");
}
__name(isDouyinUrl, "isDouyinUrl");
function isDouyinMediaUrl(url) {
  return /douyinvod\.com|zjcdn\.com\/tos-|snssdk\.com\/aweme\/v1\/play|bytedance[^/]*\.com\/.*(?:tos-|video)|mime_type=video/i.test(String(url || ""));
}
__name(isDouyinMediaUrl, "isDouyinMediaUrl");
function extractDouyinAwemeId(url) {
  const text = String(url || "");
  const patterns = [
    /\/video\/(\d{8,})/i,
    /\/share\/video\/(\d{8,})/i,
    /\/aweme\/detail\/(\d{8,})/i,
    /[?&](?:aweme_id|item_id|item_ids|modal_id)=(\d{8,})/i
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) return match[1];
  }
  return "";
}
__name(extractDouyinAwemeId, "extractDouyinAwemeId");
function buildDouyinDomIdentityExtractorScript() {
  return String.raw`
    const collectIdentityIds = (node) => {
      const ids = [];
      const seenIds = new Set();
      const addIdentityText = (value) => {
        const text = String(value || '');
        const patterns = [
          /(?:\/video\/|\/share\/video\/|\/aweme\/detail\/)(\d{8,})/ig,
          /(?:aweme_id|item_id|item_ids|modal_id)[=:]+(\d{8,})/ig,
        ];
        patterns.forEach((pattern) => {
          let match;
          while ((match = pattern.exec(text))) {
            if (!seenIds.has(match[1])) {
              seenIds.add(match[1]);
              ids.push(match[1]);
            }
          }
        });
        if (/^\d{8,}$/.test(text) && !seenIds.has(text)) {
          seenIds.add(text);
          ids.push(text);
        }
      };
      let current = node;
      for (let depth = 0; current && depth < 7; depth += 1) {
        ['id', 'href', 'src', 'data-aweme-id', 'data-item-id', 'data-id'].forEach((name) => {
          try { addIdentityText(current.getAttribute && current.getAttribute(name)); } catch (error) {}
        });
        current = current.parentElement;
      }
      return ids;
    };
  `;
}
__name(buildDouyinDomIdentityExtractorScript, "buildDouyinDomIdentityExtractorScript");
function selectPrimaryDouyinDomMediaUrls(candidates = [], targetAwemeId = "") {
  const targetId = String(targetAwemeId || "").trim();
  const ranked = (Array.isArray(candidates) ? candidates : []).map((candidate, fallbackIndex) => {
    const urls = normalizeBrowserCapturedMediaUrls([candidate && candidate.urls]);
    const identityIds = Array.from(new Set(
      (Array.isArray(candidate && candidate.identityIds) ? candidate.identityIds : []).map((value) => String(value || "").trim()).filter(Boolean)
    ));
    if (!urls.length || targetId && identityIds.some((identityId) => identityId !== targetId)) {
      return null;
    }
    return {
      urls,
      exactIdentity: Boolean(targetId && identityIds.includes(targetId)),
      isPlaying: candidate && candidate.isPlaying === true,
      visibleInViewport: Boolean(candidate && candidate.visible && candidate.intersectsViewport),
      area: Math.max(0, Number(candidate && candidate.area) || 0),
      index: Number.isFinite(Number(candidate && candidate.index)) ? Number(candidate.index) : fallbackIndex
    };
  }).filter(Boolean).sort((left, right) => Number(right.exactIdentity) - Number(left.exactIdentity) || Number(right.isPlaying) - Number(left.isPlaying) || Number(right.visibleInViewport) - Number(left.visibleInViewport) || right.area - left.area || left.index - right.index);
  return ranked.length ? ranked[0].urls : [];
}
__name(selectPrimaryDouyinDomMediaUrls, "selectPrimaryDouyinDomMediaUrls");
function selectIdentityBoundDouyinBrowserMedia({
  targetAwemeId = "",
  finalUrl = "",
  canonicalUrl = "",
  debuggerMediaUrls = [],
  domMediaCandidates = [],
  pageIdentityIds = [],
  primaryDomMediaUrls = []
} = {}) {
  const targetId = String(targetAwemeId || "").trim();
  if (!targetId) return [];
  const exactPayloadMedia = normalizeBrowserCapturedMediaUrls([debuggerMediaUrls]);
  if (exactPayloadMedia.length) return exactPayloadMedia;
  const loadedIds = [finalUrl, canonicalUrl].map((value) => extractDouyinAwemeId(value)).filter(Boolean);
  if (loadedIds.some((loadedId) => loadedId !== targetId)) return [];
  const candidates = Array.isArray(domMediaCandidates) ? domMediaCandidates : [];
  const exactDomCandidates = candidates.filter((candidate) => {
    const identityIds = Array.from(new Set(
      (Array.isArray(candidate && candidate.identityIds) ? candidate.identityIds : []).map((value) => String(value || "").trim()).filter(Boolean)
    ));
    return identityIds.includes(targetId) && !identityIds.some((identityId) => identityId !== targetId);
  });
  if (exactDomCandidates.length) {
    return selectPrimaryDouyinDomMediaUrls(exactDomCandidates, targetId);
  }
  const normalizedPageIds = Array.from(new Set(
    (Array.isArray(pageIdentityIds) ? pageIdentityIds : []).map((value) => String(value || "").trim()).filter(Boolean)
  ));
  const pageUniquelyMatchesTarget = normalizedPageIds.length === 1 && normalizedPageIds[0] === targetId;
  const loadedPageMatchesTarget = loadedIds.includes(targetId);
  if (!loadedPageMatchesTarget && !pageUniquelyMatchesTarget) return [];
  if (!loadedPageMatchesTarget && pageUniquelyMatchesTarget) {
    const unboundVisiblePlayingCandidates = candidates.filter((candidate) => {
      const identityIds = Array.from(new Set(
        (Array.isArray(candidate && candidate.identityIds) ? candidate.identityIds : []).map((value) => String(value || "").trim()).filter(Boolean)
      ));
      return identityIds.length === 0 && candidate.isPlaying === true && candidate.visible !== false && candidate.intersectsViewport !== false;
    });
    if (unboundVisiblePlayingCandidates.length !== 1) return [];
    return selectPrimaryDouyinDomMediaUrls(unboundVisiblePlayingCandidates, targetId);
  }
  if (candidates.length) {
    return selectPrimaryDouyinDomMediaUrls(candidates, targetId);
  }
  return normalizeBrowserCapturedMediaUrls([primaryDomMediaUrls]);
}
__name(selectIdentityBoundDouyinBrowserMedia, "selectIdentityBoundDouyinBrowserMedia");
function normalizeDouyinTargetUrl(originalUrl, resolvedUrl = "") {
  const original = String(originalUrl || "").trim();
  const resolved = String(resolvedUrl || "").trim();
  const awemeId = extractDouyinAwemeId(resolved) || extractDouyinAwemeId(original);
  if (awemeId) {
    return {
      awemeId,
      url: `https://www.douyin.com/video/${awemeId}`
    };
  }
  const candidate = resolved || original;
  if (/^https?:\/\//i.test(candidate) && isDouyinUrl(candidate)) {
    return { awemeId: "", url: candidate };
  }
  return { awemeId: "", url: "" };
}
__name(normalizeDouyinTargetUrl, "normalizeDouyinTargetUrl");
function getDouyinAwemeDetailUrls(awemeId) {
  const id = String(awemeId || "").trim();
  if (!id) return [];
  const query = `aweme_id=${encodeURIComponent(id)}&aid=6383&device_platform=webapp`;
  return [
    `https://www.douyin.com/aweme/v1/web/aweme/detail/?${query}`,
    `https://www.douyin.com/aweme/v1/web/aweme/detail/?aweme_id=${encodeURIComponent(id)}&aid=1128&device_platform=webapp`
  ];
}
__name(getDouyinAwemeDetailUrls, "getDouyinAwemeDetailUrls");
function getDouyinMobileSharePageUrls(awemeId) {
  const id = String(awemeId || "").trim();
  if (!id) return [];
  return [`https://www.iesdouyin.com/share/video/${encodeURIComponent(id)}/?from_ssr=1`];
}
__name(getDouyinMobileSharePageUrls, "getDouyinMobileSharePageUrls");
function getDouyinMobileShareRequestHeaders(url) {
  return {
    ...getSocialRequestHeaders(url),
    "User-Agent": DOUYIN_MOBILE_SHARE_USER_AGENT,
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    Referer: "https://www.iesdouyin.com/"
  };
}
__name(getDouyinMobileShareRequestHeaders, "getDouyinMobileShareRequestHeaders");
function parseJsonObjectAssignedTo(source, variableName) {
  const text = String(source || "");
  const assignmentIndex = text.indexOf(variableName);
  if (assignmentIndex < 0) return null;
  const objectStart = text.indexOf("{", assignmentIndex + variableName.length);
  if (objectStart < 0) return null;
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = objectStart; index < text.length; index += 1) {
    const char = text[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(objectStart, index + 1));
        } catch (error) {
          return null;
        }
      }
    }
  }
  return null;
}
__name(parseJsonObjectAssignedTo, "parseJsonObjectAssignedTo");
function extractDouyinMediaUrlsFromShareHtml(html, awemeId) {
  const source = String(html || "");
  const scriptPattern = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while (match = scriptPattern.exec(source)) {
    const payload = parseJsonObjectAssignedTo(match[1], "window._ROUTER_DATA");
    const urls = extractDouyinMediaUrlsForAweme(payload, awemeId);
    if (urls.length) return urls;
  }
  return extractDouyinMediaUrlsForAweme(parseJsonObjectAssignedTo(source, "window._ROUTER_DATA"), awemeId);
}
__name(extractDouyinMediaUrlsFromShareHtml, "extractDouyinMediaUrlsFromShareHtml");
function findDouyinDetailForAweme(payload, awemeId) {
  const targetId = String(awemeId || "").trim();
  if (!targetId || !payload || typeof payload !== "object") return null;
  const seen = /* @__PURE__ */ new Set();
  let matched = null;
  const visit = /* @__PURE__ */ __name((value, depth = 0) => {
    if (matched || !value || typeof value !== "object" || depth > 16 || seen.size > 1e4 || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    const candidateId = String(value.aweme_id || value.awemeId || "").trim();
    if (candidateId === targetId) {
      matched = value;
      return;
    }
    Object.values(value).forEach((item) => visit(item, depth + 1));
  }, "visit");
  visit(payload);
  return matched;
}
__name(findDouyinDetailForAweme, "findDouyinDetailForAweme");
function extractDouyinDetailFromShareHtml(html, awemeId) {
  const source = String(html || "");
  const scriptPattern = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let match;
  while (match = scriptPattern.exec(source)) {
    const detail = findDouyinDetailForAweme(
      parseJsonObjectAssignedTo(match[1], "window._ROUTER_DATA"),
      awemeId
    );
    if (detail) return detail;
  }
  return findDouyinDetailForAweme(
    parseJsonObjectAssignedTo(source, "window._ROUTER_DATA"),
    awemeId
  );
}
__name(extractDouyinDetailFromShareHtml, "extractDouyinDetailFromShareHtml");
function deriveDouyinTitleFromDescription(description = "") {
  const cleanedDescription = cleanSocialDescription(description);
  if (!cleanedDescription) return "";
  const firstContentLine = cleanedDescription.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !line.startsWith("#")) || "";
  const withoutInlineTags = firstContentLine.replace(/\s*#[\p{L}\p{N}_-].*$/u, "").trim();
  const candidate = withoutInlineTags || firstContentLine;
  if (candidate.length <= 80) return candidate;
  const firstSentence = candidate.split(/[。！？!?；;]/, 1)[0].trim();
  if (firstSentence && firstSentence.length <= 80) return firstSentence;
  return `${candidate.slice(0, 77).trim()}...`;
}
__name(deriveDouyinTitleFromDescription, "deriveDouyinTitleFromDescription");
function isGenericDouyinTitle(title = "") {
  const compact = String(title || "").toLowerCase().replace(/[\s\-_|·•]+/g, "");
  return !compact || compact === "抖音" || compact === "douyin" || compact === "抖音短视频" || compact === "记录美好生活" || compact === "抖音记录美好生活";
}
__name(isGenericDouyinTitle, "isGenericDouyinTitle");
var buildDouyinStructuredContent = createDouyinStructuredContentBuilder({
  cleanDescription: cleanSocialDescription,
  extractTags: extractTagsFromText,
  buildMetrics: buildSocialMetrics,
  hasMetrics: hasSocialMetrics,
  isGenericTitle: isGenericDouyinTitle,
  deriveTitle: deriveDouyinTitleFromDescription,
  normalizeUrl: normalizeExtractedUrl
});
function shouldResolveMediaDownloadUrl(url) {
  const text = String(url || "").toLowerCase();
  return text.includes("/aweme/v1/play") || text.includes("v.douyin.com") || text.includes("iesdouyin.com/share/video") || text.includes("amemv.com");
}
__name(shouldResolveMediaDownloadUrl, "shouldResolveMediaDownloadUrl");
function isBilibiliUrl(url) {
  const text = String(url || "").toLowerCase();
  return text.includes("bilibili.com") || text.includes("b23.tv");
}
__name(isBilibiliUrl, "isBilibiliUrl");
function isXiaoyuzhouUrl(url) {
  const text = String(url || "").toLowerCase();
  return text.includes("xiaoyuzhoufm.com") || text.includes("xiaoyuzhou.com");
}
__name(isXiaoyuzhouUrl, "isXiaoyuzhouUrl");
var WECHAT_CHANNELS_FEED_INFO_URL = "https://channels.weixin.qq.com/finder-preview/api/feed/get_feed_info";
function isWechatChannelsUrl(url) {
  const text = String(url || "").toLowerCase();
  return text.includes("channels.weixin.qq.com") || /(^|\/\/)weixin\.qq\.com\/sph\//i.test(text);
}
__name(isWechatChannelsUrl, "isWechatChannelsUrl");
function isWechatChannelsMediaUrl(url) {
  return /finder\.video\.qq\.com|mpvideo\.qpic\.cn|(^|[./-])mpvideo/i.test(String(url || ""));
}
__name(isWechatChannelsMediaUrl, "isWechatChannelsMediaUrl");
function extractWechatChannelsRequestPayload(url) {
  const source = String(url || "").trim();
  try {
    const parsed = new URL(source);
    const hostname = parsed.hostname.toLowerCase();
    const path2 = parsed.pathname || "";
    if (hostname === "weixin.qq.com") {
      const match = path2.match(/\/sph\/([^/?#]+)/i);
      if (match && match[1]) return { shortUri: decodeURIComponent(match[1]) };
    }
    if (hostname === "channels.weixin.qq.com") {
      const id = parsed.searchParams.get("id");
      if (id) return { shortUri: id };
      const eid = parsed.searchParams.get("eid");
      if (eid) return { exportId: eid };
    }
  } catch (error) {
  }
  const shortMatch = source.match(/weixin\.qq\.com\/sph\/([^/?#\s]+)/i) || source.match(/[?&]id=([^&#\s]+)/i);
  if (shortMatch && shortMatch[1]) {
    return { shortUri: decodeUrlComponentSafely(shortMatch[1]) };
  }
  const exportMatch = source.match(/[?&]eid=([^&#\s]+)/i);
  if (exportMatch && exportMatch[1]) {
    return { exportId: decodeUrlComponentSafely(exportMatch[1]) };
  }
  return {};
}
__name(extractWechatChannelsRequestPayload, "extractWechatChannelsRequestPayload");
function shouldHydrateLinkAsWebpage(url) {
  return isWechatMpArticleUrl(url) || isFeishuUrl(url) || isXiaohongshuUrl(url) || isDouyinUrl(url) || isBilibiliUrl(url) || isXiaoyuzhouUrl(url);
}
__name(shouldHydrateLinkAsWebpage, "shouldHydrateLinkAsWebpage");
function isSafeAutomaticWebpageUrl(url) {
  try {
    const parsed = new URL(String(url || "").trim());
    if (!["http:", "https:"].includes(parsed.protocol)) return false;
    if (parsed.username || parsed.password) return false;
    return Boolean(parsed.hostname);
  } catch (error) {
    return false;
  }
}
__name(isSafeAutomaticWebpageUrl, "isSafeAutomaticWebpageUrl");
function isTrustedAutomaticPlatformUrl(url) {
  const hostname = getHttpUrlHostname(url);
  return isHostnameWithinDomain(hostname, "mp.weixin.qq.com") || isHostnameWithinDomain(hostname, "feishu.cn") || isHostnameWithinDomain(hostname, "feishu.net") || isHostnameWithinDomain(hostname, "larksuite.com") || isHostnameWithinDomain(hostname, "xiaohongshu.com") || isHostnameWithinDomain(hostname, "xhslink.com") || isHostnameWithinDomain(hostname, "xhslink.cn") || isHostnameWithinDomain(hostname, "douyin.com") || isHostnameWithinDomain(hostname, "iesdouyin.com") || isHostnameWithinDomain(hostname, "amemv.com") || isHostnameWithinDomain(hostname, "bilibili.com") || isHostnameWithinDomain(hostname, "b23.tv") || isHostnameWithinDomain(hostname, "xiaoyuzhoufm.com") || isHostnameWithinDomain(hostname, "xiaoyuzhou.com");
}
__name(isTrustedAutomaticPlatformUrl, "isTrustedAutomaticPlatformUrl");
function extractAutomaticWebpageUrlCandidates(text) {
  const matches = String(text || "").match(/https?:\/\/[a-z0-9\-._~:/?#\[\]@!$&()*+,;=%]+/gi) || [];
  const unique = [];
  const seen = /* @__PURE__ */ new Set();
  for (const match of matches) {
    const candidate = String(match || "").replace(/[)\]}>，。！？、；："'~.,!;]+$/g, "");
    if (!candidate || !isSafeAutomaticWebpageUrl(candidate)) continue;
    let normalized;
    try {
      normalized = new URL(candidate).toString();
      if (!/[/?#]$/.test(candidate) && normalized.endsWith("/")) {
        normalized = normalized.slice(0, -1);
      }
    } catch (error) {
      continue;
    }
    if (!seen.has(normalized)) {
      seen.add(normalized);
      unique.push(normalized);
    }
  }
  return unique;
}
__name(extractAutomaticWebpageUrlCandidates, "extractAutomaticWebpageUrlCandidates");
function selectAutomaticWebpageUrlFromText(text) {
  const candidates = extractAutomaticWebpageUrlCandidates(text);
  if (candidates.length === 1) return candidates[0];
  const supportedPlatformCandidates = candidates.filter((url) => isTrustedAutomaticPlatformUrl(url));
  return supportedPlatformCandidates.length === 1 ? supportedPlatformCandidates[0] : "";
}
__name(selectAutomaticWebpageUrlFromText, "selectAutomaticWebpageUrlFromText");
function getSafeRedirectRequestHeaders(sourceUrl, targetUrl, headers = {}) {
  const result = { ...headers && typeof headers === "object" ? headers : {} };
  let mayRetainSensitiveHeaders = false;
  try {
    const source = new URL(String(sourceUrl || "").trim());
    const target = new URL(String(targetUrl || "").trim());
    mayRetainSensitiveHeaders = source.protocol === "https:" && target.protocol === "https:" && source.origin === target.origin;
  } catch (error) {
    mayRetainSensitiveHeaders = false;
  }
  if (mayRetainSensitiveHeaders) return result;
  const safeCrossOriginHeaderNames = /* @__PURE__ */ new Set([
    "accept",
    "accept-language",
    "user-agent"
  ]);
  for (const headerName of Object.keys(result)) {
    if (!safeCrossOriginHeaderNames.has(String(headerName || "").trim().toLowerCase())) {
      delete result[headerName];
    }
  }
  return result;
}
__name(getSafeRedirectRequestHeaders, "getSafeRedirectRequestHeaders");
function requestPublicWebpageText(url, options = {}) {
  const source = String(url || "").trim();
  const redirectsRemaining = Number.isInteger(options.redirectsRemaining) ? options.redirectsRemaining : 5;
  const maxBytes = Number(options.maxBytes) > 0 ? Number(options.maxBytes) : 8 * 1024 * 1024;
  if (!isSafeAutomaticWebpageUrl(source)) {
    return Promise.reject(new Error("网页地址不是可自动访问的 HTTP(S) 地址"));
  }
  if (redirectsRemaining < 0) {
    return Promise.reject(new Error("网页跳转次数过多"));
  }
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(source);
    } catch (error) {
      reject(new Error("网页地址格式无效"));
      return;
    }
    const client = parsed.protocol === "http:" ? http : https;
    const request = client.request(parsed, {
      method: "GET",
      headers: options.headers || getSocialRequestHeaders(source)
    }, (response) => {
      const location = response.headers && response.headers.location;
      if (response.statusCode >= 300 && response.statusCode < 400 && location) {
        response.resume();
        let redirectUrl;
        try {
          redirectUrl = new URL(location, source).toString();
        } catch (error) {
          reject(new Error("网页返回了无效跳转地址"));
          return;
        }
        if (typeof options.allowedRedirectUrl === "function" && options.allowedRedirectUrl(redirectUrl, source) !== true) {
          reject(new Error("网页跳转到了不受信任的地址，已停止抓取"));
          return;
        }
        requestPublicWebpageText(redirectUrl, {
          ...options,
          headers: options.headers ? getSafeRedirectRequestHeaders(source, redirectUrl, options.headers) : getSocialRequestHeaders(redirectUrl),
          redirectsRemaining: redirectsRemaining - 1
        }).then(resolve, reject);
        return;
      }
      const chunks = [];
      let received = 0;
      response.on("data", (chunk) => {
        received += chunk.length;
        if (received > maxBytes) {
          request.destroy(new Error("网页正文超过安全大小限制"));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => {
        resolve({
          status: Number(response.statusCode) || 0,
          text: Buffer.concat(chunks).toString("utf8"),
          headers: response.headers || {},
          url: source
        });
      });
      response.on("error", reject);
    });
    request.setTimeout(1e4, () => {
      request.destroy(new Error("网页抓取超时"));
    });
    request.on("error", reject);
    request.end();
  });
}
__name(requestPublicWebpageText, "requestPublicWebpageText");
function isAutomaticWebpageHydrationSuccessful(record) {
  const metadata = record && record.metadata || {};
  const conversionStatus = String(metadata.conversionStatus || "").toLowerCase();
  const transcriptionStatus = String(metadata.transcriptionStatus || "").toLowerCase();
  if (["failed", "link_saved", "wechat_captcha"].includes(conversionStatus)) return false;
  if (transcriptionStatus === "failed") return false;
  const hasStoredContent = Boolean(String(
    metadata.markdown || metadata.snapshot || metadata.contentSnapshot || metadata.transcription || metadata.convertedMarkdown || ""
  ).trim());
  return (conversionStatus === "success" || transcriptionStatus === "success") && hasStoredContent;
}
__name(isAutomaticWebpageHydrationSuccessful, "isAutomaticWebpageHydrationSuccessful");
function createAutomaticWebpageExtractionError(url) {
  const host = getSafeUrlDiagnostic(url).host || "unknown-host";
  const error = new Error(`剪切板链接网页提取失败，已保留待重试：${host}`);
  error.code = "AUTOMATIC_WEBPAGE_EXTRACTION_FAILED";
  return error;
}
__name(createAutomaticWebpageExtractionError, "createAutomaticWebpageExtractionError");
function getSocialRequestHeaders(url) {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
    Accept: "*/*",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"
  };
  if (isBilibiliUrl(url)) headers.Referer = "https://www.bilibili.com/";
  if (/bilivideo\.com/i.test(String(url || ""))) headers.Referer = "https://www.bilibili.com/";
  if (isXiaohongshuUrl(url)) headers.Referer = "https://www.xiaohongshu.com/";
  if (isDouyinUrl(url) || isDouyinMediaUrl(url)) headers.Referer = "https://www.douyin.com/";
  if (isXiaoyuzhouUrl(url)) headers.Referer = "https://www.xiaoyuzhoufm.com/";
  if (isWechatChannelsUrl(url) || isWechatChannelsMediaUrl(url)) headers.Referer = "https://channels.weixin.qq.com/";
  return headers;
}
__name(getSocialRequestHeaders, "getSocialRequestHeaders");
function isHeaderProtectedMediaUrl(url) {
  return /bilivideo\.com|upos-[^/]+\.bilivideo\.com/i.test(String(url || ""));
}
__name(isHeaderProtectedMediaUrl, "isHeaderProtectedMediaUrl");
function shouldRetryRedirectWithGet(url, statusCode) {
  return shouldResolvePlatformRedirect(url) && [400, 403, 404, 405, 501].includes(Number(statusCode));
}
__name(shouldRetryRedirectWithGet, "shouldRetryRedirectWithGet");
function getRedirectFallbackCandidates(source, method, resolverState) {
  if (method !== "HEAD") return [];
  const candidates = [];
  try {
    const parsed = new URL(source);
    if (isXiaohongshuShortLinkUrl(source) && parsed.protocol === "http:") {
      parsed.protocol = "https:";
      candidates.push(parsed.toString());
    }
  } catch (error) {
  }
  candidates.push(source);
  const attempted = resolverState.fallbackRequestKeys;
  return candidates.filter((candidate) => {
    const key = `GET:${candidate}`;
    if (attempted.has(key)) return false;
    attempted.add(key);
    return true;
  });
}
__name(getRedirectFallbackCandidates, "getRedirectFallbackCandidates");
function resolveRedirectFallbackCandidates(candidates, index, maxRedirects, resolverState, originalSource) {
  if (index >= candidates.length) {
    return Promise.resolve({ url: originalSource, diagnostic: resolverState.diagnostic });
  }
  const candidate = candidates[index];
  const attemptCountBefore = resolverState.diagnostic.attempts.length;
  return resolveRedirectUrlWithDiagnostics(candidate, maxRedirects, "GET", resolverState).then((result) => {
    const finalAttempt = resolverState.diagnostic.attempts[resolverState.diagnostic.attempts.length - 1];
    const requestFailed = resolverState.diagnostic.attempts.length > attemptCountBefore && finalAttempt && (finalAttempt.outcome === "request-error" || finalAttempt.outcome === "timeout");
    if (requestFailed) {
      return resolveRedirectFallbackCandidates(candidates, index + 1, maxRedirects, resolverState, originalSource);
    }
    return result;
  });
}
__name(resolveRedirectFallbackCandidates, "resolveRedirectFallbackCandidates");
function resolveRedirectUrlWithDiagnostics(url, maxRedirects = 5, method = "HEAD", state = null) {
  const source = String(url || "").trim();
  const resolverState = state && state.diagnostic ? state : {
    diagnostic: state || {
      attempts: [],
      redirectCount: 0,
      usedGetFallback: false
    },
    fallbackRequestKeys: /* @__PURE__ */ new Set(),
    originalSource: source
  };
  if (!resolverState.originalSource) resolverState.originalSource = source;
  const diagnostic = resolverState.diagnostic;
  const resolveGetFallback = /* @__PURE__ */ __name(() => {
    const candidates = getRedirectFallbackCandidates(source, method, resolverState);
    if (!candidates.length) return Promise.resolve({ url: source, diagnostic });
    diagnostic.usedGetFallback = true;
    return resolveRedirectFallbackCandidates(candidates, 0, maxRedirects, resolverState, source);
  }, "resolveGetFallback");
  if (!/^https?:\/\//i.test(source) || maxRedirects <= 0) {
    return Promise.resolve({ url: source, diagnostic });
  }
  if (!isSafeAutomaticWebpageUrl(source)) {
    diagnostic.attempts.push({
      method,
      status: 0,
      host: getSafeUrlDiagnostic(source).host,
      outcome: "blocked-url"
    });
    return Promise.resolve({ url: source, diagnostic });
  }
  return new Promise((resolve) => {
    let settled = false;
    let parsed;
    try {
      parsed = new URL(source);
    } catch (error) {
      diagnostic.attempts.push({
        method,
        status: 0,
        host: "",
        outcome: "invalid-url"
      });
      resolve({ url: source, diagnostic });
      return;
    }
    const client = parsed.protocol === "http:" ? http : https;
    const request = client.request(parsed, {
      method,
      headers: getSocialRequestHeaders(source)
    }, (response) => {
      if (settled) {
        response.resume();
        return;
      }
      settled = true;
      const location = response.headers && response.headers.location;
      response.resume();
      const attempt = {
        method,
        status: Number(response.statusCode) || 0,
        host: getSafeUrlDiagnostic(source).host,
        outcome: "response"
      };
      diagnostic.attempts.push(attempt);
      if (response.statusCode >= 300 && response.statusCode < 400 && location) {
        let redirectUrl = "";
        try {
          redirectUrl = new URL(location, source).toString();
        } catch (error) {
          attempt.outcome = "invalid-redirect";
          resolve({ url: source, diagnostic });
          return;
        }
        diagnostic.redirectCount += 1;
        if (isXiaohongshuShortLinkUrl(resolverState.originalSource) && !isXiaohongshuUrl(redirectUrl)) {
          attempt.outcome = "blocked-redirect";
          resolve({ url: redirectUrl, diagnostic });
          return;
        }
        attempt.outcome = "redirect";
        resolve(resolveRedirectUrlWithDiagnostics(
          redirectUrl,
          maxRedirects - 1,
          "HEAD",
          resolverState
        ));
        return;
      }
      if (method === "HEAD" && shouldRetryRedirectWithGet(source, response.statusCode)) {
        resolve(resolveGetFallback());
        return;
      }
      resolve({ url: source, diagnostic });
    });
    request.setTimeout(8e3, () => {
      if (settled) return;
      settled = true;
      diagnostic.attempts.push({
        method,
        status: 0,
        host: getSafeUrlDiagnostic(source).host,
        outcome: "timeout"
      });
      request.destroy();
      if (method === "HEAD" && isXiaohongshuShortLinkUrl(source)) {
        resolve(resolveGetFallback());
        return;
      }
      resolve({ url: source, diagnostic });
    });
    request.on("error", () => {
      if (settled) return;
      settled = true;
      diagnostic.attempts.push({
        method,
        status: 0,
        host: getSafeUrlDiagnostic(source).host,
        outcome: "request-error"
      });
      if (method === "HEAD" && isXiaohongshuShortLinkUrl(source)) {
        resolve(resolveGetFallback());
        return;
      }
      resolve({ url: source, diagnostic });
    });
    request.end();
  });
}
__name(resolveRedirectUrlWithDiagnostics, "resolveRedirectUrlWithDiagnostics");
async function resolveRedirectUrl(url, maxRedirects = 5, method = "HEAD") {
  const result = await resolveRedirectUrlWithDiagnostics(url, maxRedirects, method);
  return result.url;
}
__name(resolveRedirectUrl, "resolveRedirectUrl");
function shouldResolvePlatformRedirect(url) {
  const text = String(url || "").toLowerCase();
  return text.includes("b23.tv") || text.includes("v.douyin.com") || isXiaohongshuShortLinkUrl(url) || /weixin\.qq\.com\/sph\//i.test(text);
}
__name(shouldResolvePlatformRedirect, "shouldResolvePlatformRedirect");
function getUrlHostname(url) {
  try {
    return new URL(String(url || "")).hostname.replace(/^www\./, "");
  } catch (error) {
    const match = String(url || "").match(/^https?:\/\/([^/?#]+)/i);
    return match && match[1] ? match[1].replace(/^www\./, "") : "";
  }
}
__name(getUrlHostname, "getUrlHostname");
function getUrlLastPathSegment(url) {
  try {
    const parsed = new URL(String(url || ""));
    const segments = parsed.pathname.split("/").filter(Boolean);
    return segments.length ? segments[segments.length - 1] : "";
  } catch (error) {
    return "";
  }
}
__name(getUrlLastPathSegment, "getUrlLastPathSegment");
function stripFileExtension(fileName) {
  const leaf = String(fileName || "").split(/[\\/]/).pop() || "";
  return leaf.replace(/\.[a-z0-9]{1,12}$/i, "").trim();
}
__name(stripFileExtension, "stripFileExtension");
function truncateByChars(text, maxLength) {
  const chars = Array.from(String(text || ""));
  return chars.length > maxLength ? chars.slice(0, maxLength).join("") : chars.join("");
}
__name(truncateByChars, "truncateByChars");
function sanitizeNoteTitlePart(text, fallback = "未命名") {
  const cleaned = decodeHtmlEntities(String(text || "")).replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "").replace(/[\\/:*?"<>|]/g, "-").replace(/\s+/g, " ").replace(/^[.\s]+|[.\s]+$/g, "").trim();
  const value = cleaned || fallback;
  return truncateByChars(value, 56).replace(/[.\s]+$/g, "").trim() || fallback;
}
__name(sanitizeNoteTitlePart, "sanitizeNoteTitlePart");
function getWebpageSourcePrefix(url) {
  if (isFeishuUrl(url)) return "飞书";
  if (isWechatChannelsUrl(url)) return "视频号";
  if (isWechatArticleUrl(url)) return "公众号";
  if (isXiaohongshuUrl(url)) return "小红书";
  if (isDouyinUrl(url)) return "抖音";
  if (isBilibiliUrl(url)) return "B站";
  if (isXiaoyuzhouUrl(url)) return "小宇宙";
  return "网页";
}
__name(getWebpageSourcePrefix, "getWebpageSourcePrefix");
function getRecordSourcePrefix(record) {
  const type = String(record && record.type || "").toLowerCase();
  const metadata = record && record.metadata || {};
  if (type === "link" && shouldHydrateLinkAsWebpage(metadata.url || record.content || "")) {
    return getWebpageSourcePrefix(metadata.url || record.content || "");
  }
  if (type === "text") return "文本";
  if (type === "link") return "链接";
  if (type === "voice") return "录音";
  if (type === "webpage") return getWebpageSourcePrefix(metadata.url || record.content || "");
  if (type === "file") {
    return getAttachmentExt(metadata.fileName || record.content || "", metadata.fileExt) || "文件";
  }
  return getTypeDisplayName(type);
}
__name(getRecordSourcePrefix, "getRecordSourcePrefix");
function getRecordSourceName(record) {
  const type = String(record && record.type || "").toLowerCase();
  const metadata = record && record.metadata || {};
  const content = String(record && record.content || "").trim();
  const fallbackTime = getTitleTimePart(record && record.createdAt);
  if (type === "file") {
    return stripFileExtension(metadata.fileName || content) || fallbackTime;
  }
  if (type === "voice") {
    const audioName = stripFileExtension(metadata.originalAudioFileName || metadata.audioFileName || "");
    if (audioName) return audioName;
    if (content && !/^现场语音备忘录\s*-/.test(content)) return content;
    return fallbackTime;
  }
  if (type === "webpage") {
    const url = metadata.url || content;
    return metadata.title || getUrlLastPathSegment(url) || getUrlHostname(url) || fallbackTime;
  }
  if (type === "link") {
    const url = metadata.url || content;
    if (shouldHydrateLinkAsWebpage(url)) {
      return metadata.title || getUrlLastPathSegment(url) || getUrlHostname(url) || fallbackTime;
    }
    return metadata.title || getUrlHostname(url) || getUrlLastPathSegment(url) || content || fallbackTime;
  }
  return content || fallbackTime;
}
__name(getRecordSourceName, "getRecordSourceName");
function buildRecordTitleBase(record) {
  const prefix = sanitizeNoteTitlePart(getRecordSourcePrefix(record), "内容");
  const name = sanitizeNoteTitlePart(getRecordSourceName(record), getTitleTimePart(record && record.createdAt));
  return `${prefix}-${name}`;
}
__name(buildRecordTitleBase, "buildRecordTitleBase");
function getHtmlAttribute(tag, name) {
  const pattern = new RegExp(`\\s${escapeRegExp(name)}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i");
  const match = String(tag || "").match(pattern);
  return match ? decodeHtmlEntities(match[1] || match[2] || match[3] || "") : "";
}
__name(getHtmlAttribute, "getHtmlAttribute");
function extractMetaContent(html, names) {
  const wanted = new Set((Array.isArray(names) ? names : [names]).map((name) => String(name || "").toLowerCase()));
  const source = String(html || "");
  const tags = source.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of tags) {
    const key = (getHtmlAttribute(tag, "property") || getHtmlAttribute(tag, "name") || getHtmlAttribute(tag, "itemprop")).toLowerCase();
    if (wanted.has(key)) {
      const content = getHtmlAttribute(tag, "content");
      if (content) return content.trim();
    }
  }
  return "";
}
__name(extractMetaContent, "extractMetaContent");
function extractKeywordList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  return String(value || "").split(/[,，、\s]+/).map((item) => item.trim()).filter(Boolean);
}
__name(extractKeywordList, "extractKeywordList");
function normalizePendingReviewSummary(summary = {}) {
  return {
    total: Math.max(0, Number(summary && summary.total) || 0),
    audioVideoCount: Math.max(0, Number(summary && summary.audioVideoCount) || 0)
  };
}
__name(normalizePendingReviewSummary, "normalizePendingReviewSummary");
function mergePendingReviewSummaries(summaries = []) {
  return (Array.isArray(summaries) ? summaries : []).reduce((merged, summary) => {
    const normalized = normalizePendingReviewSummary(summary);
    return {
      total: merged.total + normalized.total,
      audioVideoCount: merged.audioVideoCount + normalized.audioVideoCount
    };
  }, { total: 0, audioVideoCount: 0 });
}
__name(mergePendingReviewSummaries, "mergePendingReviewSummaries");
function buildPendingReviewNotice(summary = {}) {
  const normalized = normalizePendingReviewSummary(summary);
  if (normalized.audioVideoCount > 0) {
    return `有 ${normalized.audioVideoCount} 条音频/音视频正在微信安全审核，通过后会自动进入转写`;
  }
  if (normalized.total > 0) {
    return `有 ${normalized.total} 条内容正在微信安全审核，通过后会自动进入同步`;
  }
  return "";
}
__name(buildPendingReviewNotice, "buildPendingReviewNotice");
var SYNC_RECORD_DIAGNOSTIC_ENUMS = {
  type: /* @__PURE__ */ new Set(["text", "webpage", "file", "image", "voice", "audio", "video", "link", "unknown"]),
  status: /* @__PURE__ */ new Set(["pending", "security_pending", "security_submitting", "processing", "failed", "synced", "unknown"]),
  sourcePlatform: /* @__PURE__ */ new Set([
    "wechat",
    "wechat-public-account",
    "feishu",
    "xiaohongshu",
    "douyin",
    "bilibili",
    "xiaoyuzhou",
    "web",
    "file",
    "voice",
    "manual",
    "unknown"
  ]),
  mediaType: /* @__PURE__ */ new Set(["audio_video", "audio", "video", "image", "document", "webpage", "text", "unknown"]),
  transcriptionStatus: /* @__PURE__ */ new Set([
    "pending",
    "queued",
    "processing",
    "completed",
    "failed",
    "skipped",
    "not_required",
    "unavailable",
    "unknown"
  ]),
  filterReason: /* @__PURE__ */ new Set(["security-review", "processing", "failed", "already-synced", "deduplicated", "other"])
};
function normalizeSyncRecordDiagnosticEnum(value, allowedValues) {
  const normalized = String(value || "").trim().toLowerCase();
  return allowedValues.has(normalized) ? normalized : "unknown";
}
__name(normalizeSyncRecordDiagnosticEnum, "normalizeSyncRecordDiagnosticEnum");
function normalizeSyncRecordDiagnosticTimestamp(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}
__name(normalizeSyncRecordDiagnosticTimestamp, "normalizeSyncRecordDiagnosticTimestamp");
function normalizeSyncRecordDiagnosticRecordId(value) {
  const recordId = String(value || "").trim();
  return /^[a-zA-Z0-9_-]{1,128}$/.test(recordId) ? recordId : "";
}
__name(normalizeSyncRecordDiagnosticRecordId, "normalizeSyncRecordDiagnosticRecordId");
function normalizeSyncRecordDiagnosticSnapshot(snapshot = {}) {
  if (!snapshot || typeof snapshot !== "object" || Number(snapshot.schemaVersion) !== 1) return null;
  const sourceRecords = Array.isArray(snapshot.records) ? snapshot.records : [];
  const sourceCounts = snapshot.counts && typeof snapshot.counts === "object" ? snapshot.counts : {};
  return {
    schemaVersion: 1,
    examinedCount: Math.max(0, Number(snapshot.examinedCount) || 0),
    returnedCount: Math.max(0, Number(snapshot.returnedCount) || 0),
    truncated: snapshot.truncated === true,
    counts: {
      securityReview: Math.max(0, Number(sourceCounts.securityReview) || 0),
      processing: Math.max(0, Number(sourceCounts.processing) || 0),
      failed: Math.max(0, Number(sourceCounts.failed) || 0),
      alreadySynced: Math.max(0, Number(sourceCounts.alreadySynced) || 0),
      deduplicated: Math.max(0, Number(sourceCounts.deduplicated) || 0),
      other: Math.max(0, Number(sourceCounts.other) || 0)
    },
    records: sourceRecords.slice(0, 10).map((record) => ({
      recordId: normalizeSyncRecordDiagnosticRecordId(record && record.recordId),
      type: normalizeSyncRecordDiagnosticEnum(record && record.type, SYNC_RECORD_DIAGNOSTIC_ENUMS.type),
      status: normalizeSyncRecordDiagnosticEnum(record && record.status, SYNC_RECORD_DIAGNOSTIC_ENUMS.status),
      sourcePlatform: normalizeSyncRecordDiagnosticEnum(
        record && record.sourcePlatform,
        SYNC_RECORD_DIAGNOSTIC_ENUMS.sourcePlatform
      ),
      mediaType: normalizeSyncRecordDiagnosticEnum(record && record.mediaType, SYNC_RECORD_DIAGNOSTIC_ENUMS.mediaType),
      transcriptionStatus: normalizeSyncRecordDiagnosticEnum(
        record && record.transcriptionStatus,
        SYNC_RECORD_DIAGNOSTIC_ENUMS.transcriptionStatus
      ),
      filterReason: normalizeSyncRecordDiagnosticEnum(
        record && record.filterReason,
        SYNC_RECORD_DIAGNOSTIC_ENUMS.filterReason
      ),
      createdAt: normalizeSyncRecordDiagnosticTimestamp(record && record.createdAt),
      updatedAt: normalizeSyncRecordDiagnosticTimestamp(record && record.updatedAt)
    }))
  };
}
__name(normalizeSyncRecordDiagnosticSnapshot, "normalizeSyncRecordDiagnosticSnapshot");
function extractWebpageMetadataFromHtml(html, url = "") {
  const source = String(html || "");
  const description = cleanSocialDescription(extractMetaContent(source, [
    "description",
    "og:description",
    "twitter:description"
  ]));
  return {
    title: extractMetaContent(source, ["og:title", "twitter:title"]) || extractHtmlTitle(source),
    author: extractMetaContent(source, [
      "author",
      "article:author",
      "og:site_name",
      "weixin:author",
      "twitter:creator"
    ]),
    description,
    keywords: extractKeywordList(extractMetaContent(source, ["keywords", "article:tag"])),
    platform: getWebpageSourcePrefix(url),
    contentCategory: isDouyinUrl(url) || isBilibiliUrl(url) || isXiaoyuzhouUrl(url) ? "音视频" : "图文"
  };
}
__name(extractWebpageMetadataFromHtml, "extractWebpageMetadataFromHtml");
var buildSocialMediaSupplementalMarkdownFromHtml = createSocialMediaContextHtmlBuilder({
  extractPageMetadata: extractWebpageMetadataFromHtml,
  extractTagsFromText,
  extractMetaContent,
  collectImageUrls: collectImageUrlsFromHtml,
  normalizeUrl: normalizeExtractedUrl,
  isBilibiliUrl
});
var extractSocialMetricsFromHtml = createSocialMetricsHtmlExtractor({
  collectJsonBlocks: collectTopLevelJsonObjectBlocks,
  tryParseJson
});
function normalizeExtractedUrl(url) {
  const normalized = decodeHtmlEntities(String(url || "")).replace(/\\u002F/g, "/").replace(/\\\//g, "/").trim();
  return normalized.startsWith("//") ? `https:${normalized}` : normalized;
}
__name(normalizeExtractedUrl, "normalizeExtractedUrl");
function decodeJsonLikeString(text) {
  const source = String(text || "");
  if (!source) return "";
  try {
    return JSON.parse(`"${source.replace(/"/g, '\\"')}"`);
  } catch (error) {
    return source.replace(/\\n/g, "\n").replace(/\\r/g, "\n").replace(/\\t/g, " ").replace(/\\"/g, '"').replace(/\\u002F/g, "/").replace(/\\\//g, "/");
  }
}
__name(decodeJsonLikeString, "decodeJsonLikeString");
function pushUniqueUrl(list, value) {
  const url = normalizeExtractedUrl(value);
  if (!url || /^data:/i.test(url) || /^blob:/i.test(url)) return;
  if (!/^https?:\/\//i.test(url)) return;
  if (!list.includes(url)) list.push(url);
}
__name(pushUniqueUrl, "pushUniqueUrl");
function isLikelyMediaUrl(value) {
  const url = normalizeExtractedUrl(value);
  if (!url) return false;
  if (/\.(?:mp3|m4a|aac|wav|ogg|flac|mp4|m4s|m3u8)(?:[?#]|$)/i.test(url)) return true;
  return /(?:media\.xyzcdn\.net|finder\.video\.qq\.com|mpvideo|bilivideo\.com|bilibili\.com\/.*audio|(?:douyin\.com|snssdk\.com)\/aweme\/v1\/play|douyinvod\.com|zjcdn\.com\/tos-|bytedance[^/]*\.com\/.*(?:tos-|video)|mime_type=video)/i.test(url);
}
__name(isLikelyMediaUrl, "isLikelyMediaUrl");
function pushUniqueMediaUrl(list, value) {
  const url = normalizeExtractedUrl(value);
  if (!/^https?:\/\//i.test(url)) return;
  if (!isLikelyMediaUrl(url)) return;
  if (!list.includes(url)) list.push(url);
}
__name(pushUniqueMediaUrl, "pushUniqueMediaUrl");
function extractLooseMediaUrlsFromText(text) {
  const source = String(text || "");
  const urls = [];
  const patterns = [
    /https?:\\?\/\\?\/[^"'\s<>]*?(?:finder\.video\.qq\.com|mpvideo\.qpic\.cn|mpvideo)[^"'\s<>]*/gi,
    /https?:\\?\/\\?\/[^"'\s<>]+?\.(?:mp3|m4a|aac|wav|ogg|flac|mp4|m4s|m3u8)(?:[?#][^"'\s<>]*)?/gi
  ];
  patterns.forEach((pattern) => {
    let match;
    while (match = pattern.exec(source)) {
      const rawUrl = String(match[0] || "").replace(/[),.;]+$/g, "");
      pushUniqueMediaUrl(urls, rawUrl);
    }
  });
  return urls;
}
__name(extractLooseMediaUrlsFromText, "extractLooseMediaUrlsFromText");
function getTranscriptionMediaScore(value) {
  const url = normalizeExtractedUrl(value).toLowerCase();
  if (!url) return -1e3;
  let score = 0;
  if (/\.(?:mp3|m4a|aac|wav|ogg|flac)(?:[?#]|$)/i.test(url)) score += 1e3;
  if (/audio|music|voice|mime_type=audio|audio_url|music_url|play_audio/i.test(url)) score += 800;
  if (/aweme\/v1\/play/i.test(url)) score += 500;
  if (/\.(?:mp4)(?:[?#]|$)|finder\.video\.qq\.com|mpvideo|douyinvod\.com|zjcdn\.com\/tos-|mime_type=video/i.test(url)) score += 250;
  if (/\.(?:m4s|m3u8)(?:[?#]|$)/i.test(url)) score -= 300;
  if (/\.css(?:[?#]|$)|\.js(?:[?#]|$)|image|webp|jpg|png/i.test(url)) score -= 1e3;
  return score;
}
__name(getTranscriptionMediaScore, "getTranscriptionMediaScore");
function sortMediaUrlsForTranscription(urls) {
  const seen = /* @__PURE__ */ new Set();
  return (urls || []).map((url, index) => ({ url: normalizeExtractedUrl(url), index })).filter((item) => {
    if (!/^https?:\/\//i.test(item.url) || !isLikelyMediaUrl(item.url) || seen.has(item.url)) {
      return false;
    }
    seen.add(item.url);
    return true;
  }).sort((a, b) => {
    const scoreDiff = getTranscriptionMediaScore(b.url) - getTranscriptionMediaScore(a.url);
    return scoreDiff || a.index - b.index;
  }).map((item) => item.url);
}
__name(sortMediaUrlsForTranscription, "sortMediaUrlsForTranscription");
function collectBrowserCapturedMediaUrls(value, urls = [], seen = /* @__PURE__ */ new Set(), depth = 0, state = null) {
  const traversal = state && state.urlSet instanceof Set ? state : {
    urlSet: new Set(urls),
    visitedNodes: 0,
    visitedEntries: 0,
    truncated: false
  };
  if (value === void 0 || value === null || depth > 5) return urls;
  if (urls.length >= BROWSER_MEDIA_CAPTURE_MAX_URLS || traversal.visitedNodes >= BROWSER_MEDIA_CAPTURE_MAX_NODES) {
    traversal.truncated = true;
    return urls;
  }
  traversal.visitedNodes += 1;
  const add = /* @__PURE__ */ __name((candidate) => {
    if (urls.length >= BROWSER_MEDIA_CAPTURE_MAX_URLS) {
      traversal.truncated = true;
      return;
    }
    const normalized = normalizeExtractedUrl(candidate);
    if (!/^https?:\/\//i.test(normalized) || !isLikelyMediaUrl(normalized) || traversal.urlSet.has(normalized)) return;
    traversal.urlSet.add(normalized);
    urls.push(normalized);
  }, "add");
  if (typeof value === "string") {
    const source = value.slice(0, BROWSER_MEDIA_CAPTURE_MAX_STRING_CHARACTERS);
    if (value.length > source.length) traversal.truncated = true;
    add(source);
    for (const mediaUrl of extractLooseMediaUrlsFromText(source)) {
      add(mediaUrl);
      if (urls.length >= BROWSER_MEDIA_CAPTURE_MAX_URLS) break;
    }
    return urls;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      collectBrowserCapturedMediaUrls(item, urls, seen, depth + 1, traversal);
      if (traversal.truncated || urls.length >= BROWSER_MEDIA_CAPTURE_MAX_URLS) break;
    }
    return urls;
  }
  if (typeof value !== "object" || seen.has(value)) return urls;
  seen.add(value);
  const resourceType = String(value.resourceType || value.initiatorType || value.type || "").toLowerCase();
  if (["image", "img", "script", "stylesheet", "font", "css"].includes(resourceType)) {
    return urls;
  }
  [
    "url",
    "requestUrl",
    "redirectURL",
    "redirectUrl",
    "name",
    "src",
    "currentSrc"
  ].forEach((key) => collectBrowserCapturedMediaUrls(value[key], urls, seen, depth + 1, traversal));
  ["request", "response", "resource", "details"].forEach((key) => {
    if (value[key]) collectBrowserCapturedMediaUrls(value[key], urls, seen, depth + 1, traversal);
  });
  for (const key in value) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) continue;
    traversal.visitedEntries += 1;
    if (traversal.visitedEntries > BROWSER_MEDIA_CAPTURE_MAX_NODES || urls.length >= BROWSER_MEDIA_CAPTURE_MAX_URLS) {
      traversal.truncated = true;
      break;
    }
    if (/url|src|media|video|audio|stream|download|play|name/i.test(key)) {
      collectBrowserCapturedMediaUrls(value[key], urls, seen, depth + 1, traversal);
    }
  }
  return urls;
}
__name(collectBrowserCapturedMediaUrls, "collectBrowserCapturedMediaUrls");
function normalizeBrowserCapturedMediaUrls(items) {
  const urls = [];
  collectBrowserCapturedMediaUrls(items, urls);
  return sortMediaUrlsForTranscription(urls).slice(0, BROWSER_MEDIA_CAPTURE_MAX_URLS);
}
__name(normalizeBrowserCapturedMediaUrls, "normalizeBrowserCapturedMediaUrls");
function shouldBlockExternalAppUrl(value) {
  const url = String(value || "").trim();
  if (!url) return false;
  try {
    const protocol = new URL(url).protocol.toLowerCase();
    return !["http:", "https:", "blob:", "data:", "about:"].includes(protocol);
  } catch (error) {
    return false;
  }
}
__name(shouldBlockExternalAppUrl, "shouldBlockExternalAppUrl");
var DOUYIN_EXTERNAL_PROTOCOLS = ["bytedance", "snssdk1128"];
async function installDouyinExternalProtocolHandlers(session) {
  const protocol = session && session.protocol;
  if (!protocol) return false;
  let installedAny = false;
  for (const scheme of DOUYIN_EXTERNAL_PROTOCOLS) {
    try {
      if (typeof protocol.handle === "function") {
        const handled = typeof protocol.isProtocolHandled === "function" ? protocol.isProtocolHandled(scheme) : false;
        if (!handled) {
          protocol.handle(scheme, async () => new Response(null, { status: 204 }));
          installedAny = true;
        }
        continue;
      }
      if (typeof protocol.registerStringProtocol === "function") {
        const registered = typeof protocol.isProtocolRegistered === "function" ? protocol.isProtocolRegistered(scheme) : false;
        if (!registered) {
          protocol.registerStringProtocol(
            scheme,
            (_request, callback) => callback({ data: "", mimeType: "text/plain" })
          );
          installedAny = true;
        }
      }
    } catch (error) {
    }
  }
  return installedAny;
}
__name(installDouyinExternalProtocolHandlers, "installDouyinExternalProtocolHandlers");
function installExternalAppNavigationGuards(webContents) {
  if (!webContents) return;
  const preventExternalNavigation = /* @__PURE__ */ __name((event, navigationUrl) => {
    const targetUrl = typeof navigationUrl === "string" ? navigationUrl : navigationUrl && navigationUrl.url || event && event.url;
    if (shouldBlockExternalAppUrl(targetUrl) && event && typeof event.preventDefault === "function") {
      event.preventDefault();
    }
  }, "preventExternalNavigation");
  if (typeof webContents.on === "function") {
    webContents.on("will-navigate", preventExternalNavigation);
    webContents.on("will-frame-navigate", preventExternalNavigation);
    webContents.on("will-redirect", preventExternalNavigation);
  }
  if (typeof webContents.setWindowOpenHandler === "function") {
    webContents.setWindowOpenHandler((details) => shouldBlockExternalAppUrl(details && details.url) ? { action: "deny" } : { action: "allow" });
  }
}
__name(installExternalAppNavigationGuards, "installExternalAppNavigationGuards");
function isAllowedXiaohongshuBrowserNavigationUrl(url) {
  try {
    const parsed = new URL(String(url || "").trim());
    if (parsed.username || parsed.password) return false;
    if (isHostnameWithinDomain(parsed.hostname, "xiaohongshu.com")) {
      return parsed.protocol === "https:" && (!parsed.port || parsed.port === "443");
    }
    if (isHostnameWithinDomain(parsed.hostname, "xhslink.com") || isHostnameWithinDomain(parsed.hostname, "xhslink.cn")) {
      return parsed.protocol === "http:" && (!parsed.port || parsed.port === "80") || parsed.protocol === "https:" && (!parsed.port || parsed.port === "443");
    }
    return false;
  } catch (error) {
    return false;
  }
}
__name(isAllowedXiaohongshuBrowserNavigationUrl, "isAllowedXiaohongshuBrowserNavigationUrl");
function shouldBlockXiaohongshuBrowserNavigationRequest(details = {}) {
  const resourceType = String(details && details.resourceType || "").toLowerCase().replace(/[^a-z]/g, "");
  const isNavigation = resourceType === "mainframe" || resourceType === "subframe" || !resourceType && Number(details && details.frameId) === 0 && Number(details && details.parentFrameId) < 0;
  return isNavigation && !isAllowedXiaohongshuBrowserNavigationUrl(details && details.url);
}
__name(shouldBlockXiaohongshuBrowserNavigationRequest, "shouldBlockXiaohongshuBrowserNavigationRequest");
function installXiaohongshuNavigationGuards(webContents) {
  if (!webContents) return;
  const preventUntrustedNavigation = /* @__PURE__ */ __name((event, navigationUrl) => {
    const targetUrl = typeof navigationUrl === "string" ? navigationUrl : navigationUrl && navigationUrl.url || event && event.url;
    if (!isAllowedXiaohongshuBrowserNavigationUrl(targetUrl) && event && typeof event.preventDefault === "function") {
      event.preventDefault();
    }
  }, "preventUntrustedNavigation");
  if (typeof webContents.on === "function") {
    webContents.on("will-navigate", preventUntrustedNavigation);
    webContents.on("will-frame-navigate", preventUntrustedNavigation);
    webContents.on("will-redirect", preventUntrustedNavigation);
  }
  if (typeof webContents.setWindowOpenHandler === "function") {
    webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  }
}
__name(installXiaohongshuNavigationGuards, "installXiaohongshuNavigationGuards");
var activeXiaohongshuBrowserWindows = /* @__PURE__ */ new Set();
var activeXiaohongshuLoginPromise = null;
function trackXiaohongshuBrowserWindow(browserWindow) {
  if (!browserWindow) return browserWindow;
  activeXiaohongshuBrowserWindows.add(browserWindow);
  if (typeof browserWindow.on === "function") {
    browserWindow.on("closed", () => {
      activeXiaohongshuBrowserWindows.delete(browserWindow);
    });
  }
  return browserWindow;
}
__name(trackXiaohongshuBrowserWindow, "trackXiaohongshuBrowserWindow");
function bindBrowserWindowToAbortSignal(browserWindow, signal) {
  if (!browserWindow || !signal || typeof signal.addEventListener !== "function") {
    return () => {
    };
  }
  let cleaned = false;
  const closeWindow = /* @__PURE__ */ __name(() => {
    try {
      const destroyed = typeof browserWindow.isDestroyed === "function" ? browserWindow.isDestroyed() : false;
      if (!destroyed && typeof browserWindow.destroy === "function") {
        browserWindow.destroy();
      }
    } catch (error) {
    }
  }, "closeWindow");
  const cleanup = /* @__PURE__ */ __name(() => {
    if (cleaned) return;
    cleaned = true;
    if (typeof signal.removeEventListener === "function") {
      signal.removeEventListener("abort", closeWindow);
    }
  }, "cleanup");
  if (signal.aborted) {
    closeWindow();
  } else {
    signal.addEventListener("abort", closeWindow, { once: true });
  }
  return cleanup;
}
__name(bindBrowserWindowToAbortSignal, "bindBrowserWindowToAbortSignal");
function closeActiveXiaohongshuBrowserWindows() {
  let closedCount = 0;
  for (const browserWindow of [...activeXiaohongshuBrowserWindows]) {
    activeXiaohongshuBrowserWindows.delete(browserWindow);
    try {
      const destroyed = typeof browserWindow.isDestroyed === "function" ? browserWindow.isDestroyed() : false;
      if (!destroyed && typeof browserWindow.destroy === "function") {
        browserWindow.destroy();
        closedCount += 1;
      }
    } catch (error) {
    }
  }
  return closedCount;
}
__name(closeActiveXiaohongshuBrowserWindows, "closeActiveXiaohongshuBrowserWindows");
function installXiaohongshuLoginWindowGuards(webContents) {
  installXiaohongshuNavigationGuards(webContents);
  if (webContents && typeof webContents.setWindowOpenHandler === "function") {
    webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  }
}
__name(installXiaohongshuLoginWindowGuards, "installXiaohongshuLoginWindowGuards");
function enableDebuggerNetworkCapture(debuggerApi) {
  if (!debuggerApi || typeof debuggerApi.sendCommand !== "function") return false;
  try {
    const command = debuggerApi.sendCommand("Network.enable");
    if (command && typeof command.catch === "function") {
      command.catch(() => {
      });
    }
    return true;
  } catch (error) {
    return false;
  }
}
__name(enableDebuggerNetworkCapture, "enableDebuggerNetworkCapture");
function beginBestEffortBrowserLoad(browserWindow, url) {
  if (!browserWindow || typeof browserWindow.loadURL !== "function") return false;
  try {
    const loadTask = browserWindow.loadURL(url);
    if (loadTask && typeof loadTask.catch === "function") {
      loadTask.catch(() => {
      });
    }
    return true;
  } catch (error) {
    return false;
  }
}
__name(beginBestEffortBrowserLoad, "beginBestEffortBrowserLoad");
async function waitForBrowserTasksWithin(tasks, timeoutMs = 2500, timeoutTaskFactory = null) {
  const pendingTasks = Array.isArray(tasks) ? tasks.filter(Boolean) : [];
  if (!pendingTasks.length) return "empty";
  let timer = null;
  const timeoutTask = typeof timeoutTaskFactory === "function" ? Promise.resolve().then(() => timeoutTaskFactory(timeoutMs)) : new Promise((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  try {
    return await Promise.race([
      Promise.allSettled(pendingTasks).then(() => "settled"),
      timeoutTask
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
__name(waitForBrowserTasksWithin, "waitForBrowserTasksWithin");
function createBrowserTaskTimeoutError(label, timeoutMs) {
  const error = new Error(`${label} timed out after ${timeoutMs}ms`);
  error.code = "BROWSER_TASK_TIMEOUT";
  return error;
}
__name(createBrowserTaskTimeoutError, "createBrowserTaskTimeoutError");
async function runBrowserTaskWithTimeout(task, timeoutMs, label = "browser task") {
  const boundedTimeoutMs = Math.max(1, Number(timeoutMs) || 1);
  let timer = null;
  try {
    return await Promise.race([
      Promise.resolve(task),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(createBrowserTaskTimeoutError(label, boundedTimeoutMs)),
          boundedTimeoutMs
        );
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
__name(runBrowserTaskWithTimeout, "runBrowserTaskWithTimeout");
function isLikelyImageUrl(value) {
  const url = normalizeExtractedUrl(value);
  if (!url) return false;
  if (/\.(?:js|css|pdf|mp4|m4a|mp3|m3u8)(?:[?#]|$)/i.test(url)) return false;
  return /\.(?:jpg|jpeg|png|webp)(?:[?!#]|$)/i.test(url) || /\/notes_pre_post\//i.test(url) || /sns-webpic/i.test(url) || /(?:^|[!?#&])nd_(?:dft|prv)/i.test(url) || /\/image\//i.test(url);
}
__name(isLikelyImageUrl, "isLikelyImageUrl");
function getImageVariantKey(value) {
  const url = normalizeExtractedUrl(value);
  const getNormalizedAssetName = /* @__PURE__ */ __name((pathname = "") => {
    const lastSegment = String(pathname || "").split("/").filter(Boolean).pop() || "";
    return lastSegment.replace(/!.+$/i, "").replace(/\.(?:jpe?g|png|webp|bmp)$/i, "").toLowerCase();
  }, "getNormalizedAssetName");
  let xiaohongshuAssetName = "";
  try {
    const parsed = new URL(url);
    if (isHostnameWithinDomain(parsed.hostname, "xhscdn.com") || isHostnameWithinDomain(parsed.hostname, "xiaohongshu.com")) {
      xiaohongshuAssetName = getNormalizedAssetName(parsed.pathname);
    }
  } catch (error) {
    xiaohongshuAssetName = "";
  }
  if (xiaohongshuAssetName.length >= 20 && /^[a-z0-9_-]+$/i.test(xiaohongshuAssetName)) {
    return `xiaohongshu-asset:${xiaohongshuAssetName}`;
  }
  const noteImageMatch = url.match(/\/notes_pre_post\/([^"'\\\s<>?#]+)/i);
  if (noteImageMatch) return `notes_pre_post:${getNormalizedAssetName(noteImageMatch[1])}`;
  const spectrumImageMatch = url.match(/\/spectrum\/([^"'\\\s<>?#]+)/i);
  if (spectrumImageMatch) return `spectrum:${getNormalizedAssetName(spectrumImageMatch[1])}`;
  return url.replace(/^http:\/\//i, "https://").replace(/([!?#&])nd_(?:dft|prv)[^?#&]*/i, "$1nd").replace(/[?#].*$/g, "");
}
__name(getImageVariantKey, "getImageVariantKey");
function dedupeImageVariants(urls) {
  const map = /* @__PURE__ */ new Map();
  (urls || []).forEach((url) => {
    if (!isLikelyImageUrl(url)) return;
    const key = getImageVariantKey(url);
    const existing = map.get(key);
    if (!existing || /(?:^|[!?#&])nd_dft/i.test(url)) {
      map.set(key, url);
    }
  });
  return Array.from(map.values());
}
__name(dedupeImageVariants, "dedupeImageVariants");
function collectJsonArrayBlocks(source, keys, options = {}) {
  const wanted = (keys || []).map((key) => String(key || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!wanted.length) return [];
  const pattern = new RegExp(`["'](?:${wanted.join("|")})["']\\s*:\\s*\\[`, "gi");
  const blocks = [];
  const text = String(source || "");
  const maxSourceCharacters = Number.isFinite(Number(options.maxSourceCharacters)) ? Math.max(1, Math.floor(Number(options.maxSourceCharacters))) : Number.POSITIVE_INFINITY;
  if (text.length > maxSourceCharacters) return blocks;
  const maxBlocks = Number.isFinite(Number(options.maxBlocks)) ? Math.max(1, Math.floor(Number(options.maxBlocks))) : Number.POSITIVE_INFINITY;
  const maxBlockCharacters = Number.isFinite(Number(options.maxBlockCharacters)) ? Math.max(1, Math.floor(Number(options.maxBlockCharacters))) : Number.POSITIVE_INFINITY;
  const maxTotalCharacters = Number.isFinite(Number(options.maxTotalCharacters)) ? Math.max(1, Math.floor(Number(options.maxTotalCharacters))) : Number.POSITIVE_INFINITY;
  let totalCharacters = 0;
  let match;
  while (blocks.length < maxBlocks && (match = pattern.exec(text))) {
    let depth = 1;
    let inString = "";
    let escaped = false;
    let closed = false;
    const start = pattern.lastIndex - 1;
    for (let index = pattern.lastIndex; index < text.length; index += 1) {
      const char = text[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (inString) {
        if (char === inString) inString = "";
        continue;
      }
      if (char === '"' || char === "'") {
        inString = char;
        continue;
      }
      if (char === "[") depth += 1;
      if (char === "]") depth -= 1;
      if (depth === 0) {
        const blockLength = index + 1 - start;
        if (blockLength <= maxBlockCharacters && totalCharacters + blockLength <= maxTotalCharacters) {
          blocks.push(text.slice(start, index + 1));
          totalCharacters += blockLength;
        }
        pattern.lastIndex = index + 1;
        closed = true;
        break;
      }
    }
    if (!closed) break;
  }
  return blocks;
}
__name(collectJsonArrayBlocks, "collectJsonArrayBlocks");
function collectTopLevelJsonObjectBlocks(source, options = {}) {
  const blocks = [];
  const text = String(source || "");
  const maxBlocks = Number.isFinite(Number(options.maxBlocks)) ? Math.max(1, Math.floor(Number(options.maxBlocks))) : Number.POSITIVE_INFINITY;
  const maxBlockCharacters = Number.isFinite(Number(options.maxBlockCharacters)) ? Math.max(1, Math.floor(Number(options.maxBlockCharacters))) : Number.POSITIVE_INFINITY;
  const maxTotalCharacters = Number.isFinite(Number(options.maxTotalCharacters)) ? Math.max(1, Math.floor(Number(options.maxTotalCharacters))) : Number.POSITIVE_INFINITY;
  const requiredTexts = (Array.isArray(options.requiredTexts) ? options.requiredTexts : [options.requiredText]).map((value) => String(value || "")).filter(Boolean);
  let totalCharacters = 0;
  let depth = 0;
  let start = -1;
  let inString = "";
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (inString) {
      if (char === inString) inString = "";
      continue;
    }
    if (char === '"' || char === "'") {
      inString = char;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        const blockLength = index + 1 - start;
        if (blockLength <= maxBlockCharacters && totalCharacters + blockLength <= maxTotalCharacters) {
          const blockText = text.slice(start, index + 1);
          const containsRequiredText = !requiredTexts.length || requiredTexts.some((requiredText) => blockText.includes(requiredText));
          if (containsRequiredText) {
            blocks.push(blockText);
            totalCharacters += blockLength;
          }
          if (blocks.length >= maxBlocks || totalCharacters >= maxTotalCharacters) return blocks;
        }
        start = -1;
      }
    }
  }
  return blocks;
}
__name(collectTopLevelJsonObjectBlocks, "collectTopLevelJsonObjectBlocks");
function collectJsonStringValues(source, keys, options = {}) {
  const wanted = new Set((keys || []).map((key) => String(key || "").toLowerCase()));
  const values = [];
  const seen = /* @__PURE__ */ new Set();
  const text = String(source || "");
  const maxSourceCharacters = Number.isFinite(Number(options.maxSourceCharacters)) ? Math.max(1, Math.floor(Number(options.maxSourceCharacters))) : Number.POSITIVE_INFINITY;
  if (text.length > maxSourceCharacters) return values;
  const maxMatches = Number.isFinite(Number(options.maxMatches)) ? Math.max(1, Math.floor(Number(options.maxMatches))) : Number.POSITIVE_INFINITY;
  const maxValues = Number.isFinite(Number(options.maxValues)) ? Math.max(1, Math.floor(Number(options.maxValues))) : Number.POSITIVE_INFINITY;
  const pattern = /["']([A-Za-z0-9_$-]{2,40})["']\s*:\s*["']((?:\\.|[^"'\\])*)["']/g;
  let match;
  let matchedFields = 0;
  while (match = pattern.exec(text)) {
    if (!wanted.has(String(match[1] || "").toLowerCase())) continue;
    matchedFields += 1;
    const value = decodeHtmlEntities(decodeJsonLikeString(match[2])).trim();
    if (value && !seen.has(value)) {
      seen.add(value);
      values.push(value);
    }
    if (matchedFields >= maxMatches || values.length >= maxValues) break;
  }
  return values;
}
__name(collectJsonStringValues, "collectJsonStringValues");
function collectJsonArrayStringValues(source, keys, options = {}) {
  const wanted = new Set((keys || []).map((key) => String(key || "").toLowerCase()));
  const values = [];
  const seen = /* @__PURE__ */ new Set();
  const text = String(source || "");
  const maxSourceCharacters = Number.isFinite(Number(options.maxSourceCharacters)) ? Math.max(1, Math.floor(Number(options.maxSourceCharacters))) : Number.POSITIVE_INFINITY;
  if (text.length > maxSourceCharacters) return values;
  const maxValues = Number.isFinite(Number(options.maxValues)) ? Math.max(1, Math.floor(Number(options.maxValues))) : Number.POSITIVE_INFINITY;
  const pattern = /["']([A-Za-z0-9_$-]{2,40})["']\s*:\s*\[((?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'\s*,?\s*)+)\]/g;
  let match;
  while (match = pattern.exec(text)) {
    if (!wanted.has(String(match[1] || "").toLowerCase())) continue;
    const arraySource = match[2] || "";
    const itemPattern = /["']((?:\\.|[^"'\\])*)["']/g;
    let itemMatch;
    while (itemMatch = itemPattern.exec(arraySource)) {
      const value = decodeHtmlEntities(decodeJsonLikeString(itemMatch[1])).trim();
      if (value && !seen.has(value)) {
        seen.add(value);
        values.push(value);
      }
      if (values.length >= maxValues) return values;
    }
  }
  return values;
}
__name(collectJsonArrayStringValues, "collectJsonArrayStringValues");
function collectLooseXiaohongshuImageUrls(source, options = {}) {
  const text = String(source || "");
  const maxSourceCharacters = Number.isFinite(Number(options.maxSourceCharacters)) ? Math.max(1, Math.floor(Number(options.maxSourceCharacters))) : Number.POSITIVE_INFINITY;
  if (text.length > maxSourceCharacters) return [];
  const maxValues = Number.isFinite(Number(options.maxValues)) ? Math.max(1, Math.floor(Number(options.maxValues))) : Number.POSITIVE_INFINITY;
  const normalized = decodeHtmlEntities(text).replace(/\\u002F/gi, "/").replace(/\\\//g, "/");
  const urls = [];
  const seen = /* @__PURE__ */ new Set();
  const pattern = /https?:\/\/[^"'\\\s<>]*(?:sns-webpic|xhscdn|notes_pre_post)[^"'\\\s<>]*/gi;
  let match;
  while (urls.length < maxValues && (match = pattern.exec(normalized))) {
    const url = normalizeExtractedUrl(match[0]);
    if (url && !seen.has(url)) {
      seen.add(url);
      urls.push(url);
    }
  }
  return urls;
}
__name(collectLooseXiaohongshuImageUrls, "collectLooseXiaohongshuImageUrls");
function collectImageUrlsFromHtml(html, options = {}) {
  const source = String(html || "");
  const maxSourceCharacters = Number.isFinite(Number(options.maxSourceCharacters)) ? Math.max(1, Math.floor(Number(options.maxSourceCharacters))) : Number.POSITIVE_INFINITY;
  if (source.length > maxSourceCharacters) return [];
  const maxValues = Number.isFinite(Number(options.maxValues)) ? Math.max(1, Math.floor(Number(options.maxValues))) : Number.POSITIVE_INFINITY;
  const acceptUrl = typeof options.acceptUrl === "function" ? options.acceptUrl : () => true;
  const urls = [];
  const seen = /* @__PURE__ */ new Set();
  const addUrl = /* @__PURE__ */ __name((value) => {
    if (urls.length >= maxValues) return;
    const url = normalizeExtractedUrl(value);
    if (!url || /^data:|^blob:/i.test(url) || !/^https?:\/\//i.test(url) || !acceptUrl(url) || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  }, "addUrl");
  [
    extractMetaContent(source, ["og:image", "og:image:url", "twitter:image"])
  ].forEach(addUrl);
  const imageTagPattern = /<img\b[^>]*>/gi;
  let imageTagMatch;
  while (urls.length < maxValues && (imageTagMatch = imageTagPattern.exec(source))) {
    const tag = imageTagMatch[0];
    addUrl(getHtmlAttribute(tag, "data-src") || getHtmlAttribute(tag, "src"));
    const srcset = getHtmlAttribute(tag, "srcset");
    if (srcset) {
      addUrl(srcset.split(",")[0].trim().split(/\s+/)[0]);
    }
  }
  const imagePattern = /https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:jpg|jpeg|png|webp)(?:\?[^"'\\\s<>]*)?/gi;
  let match;
  while (urls.length < maxValues && (match = imagePattern.exec(source))) {
    addUrl(match[0]);
  }
  collectJsonStringValues(source, [
    "url",
    "urlDefault",
    "urlPre",
    "url_pre",
    "urlSizeLarge",
    "url_size_large",
    "original",
    "originalUrl",
    "original_url",
    "src",
    "image",
    "imageUrl",
    "image_url",
    "cover"
  ], {
    maxSourceCharacters,
    maxMatches: maxValues,
    maxValues
  }).forEach((url) => {
    if (isLikelyImageUrl(url)) {
      addUrl(url);
    }
  });
  collectLooseXiaohongshuImageUrls(source, {
    maxSourceCharacters,
    maxValues
  }).forEach(addUrl);
  return dedupeImageVariants(urls).slice(0, maxValues);
}
__name(collectImageUrlsFromHtml, "collectImageUrlsFromHtml");
function isNoisyXiaohongshuImageUrl(value) {
  const url = normalizeExtractedUrl(value).toLowerCase();
  return /picasso-static\.xiaohongshu\.com\/fe-platform\//i.test(url) || /fe-platform\.xhscdn\.com\/platform\//i.test(url) || /(?:^|\/\/)[^/]*xhscdn\.com\/platform\//i.test(url) || /(?:avatar|sns-avatar|recommend|banner|logo|icon|emoji|sticker|qrcode|qr-code|comment|user|profile|ads?)[^/]*(?:\.jpg|\.jpeg|\.png|\.webp|!|$)/i.test(url) || /ci\.xiaohongshu\.com\/(?:recommend|banner|logo|icon|avatar)/i.test(url);
}
__name(isNoisyXiaohongshuImageUrl, "isNoisyXiaohongshuImageUrl");
function collectFilteredImageTagUrls(source, options = {}) {
  const text = String(source || "");
  const maxSourceCharacters = Number.isFinite(Number(options.maxSourceCharacters)) ? Math.max(1, Math.floor(Number(options.maxSourceCharacters))) : Number.POSITIVE_INFINITY;
  if (text.length > maxSourceCharacters) return [];
  const maxValues = Number.isFinite(Number(options.maxValues)) ? Math.max(1, Math.floor(Number(options.maxValues))) : Number.POSITIVE_INFINITY;
  const urls = [];
  const seen = /* @__PURE__ */ new Set();
  const addUrl = /* @__PURE__ */ __name((value) => {
    if (urls.length >= maxValues) return;
    const url = normalizeExtractedUrl(value);
    if (!url || !isLikelyImageUrl(url) || isNoisyXiaohongshuImageUrl(url) || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  }, "addUrl");
  const imageTagPattern = /<img\b[^>]*>/gi;
  let match;
  while (urls.length < maxValues && (match = imageTagPattern.exec(text))) {
    const tag = match[0];
    const src = getHtmlAttribute(tag, "data-src") || getHtmlAttribute(tag, "src");
    addUrl(src);
    const srcset = getHtmlAttribute(tag, "srcset");
    if (srcset) {
      addUrl(srcset.split(",")[0].trim().split(/\s+/)[0]);
    }
  }
  return urls;
}
__name(collectFilteredImageTagUrls, "collectFilteredImageTagUrls");
function collectPreferredXiaohongshuImageObjectUrl(source) {
  const preferredKeys = [
    "original",
    "originalUrl",
    "original_url",
    "urlSizeLarge",
    "url_size_large",
    "urlDefault",
    "url",
    "src",
    "image",
    "imageUrl",
    "image_url",
    "cover",
    "urlPre",
    "url_pre"
  ];
  for (const key of preferredKeys) {
    const value = collectJsonStringValues(source, [key], {
      maxSourceCharacters: 256 * 1024,
      maxMatches: 4,
      maxValues: 1
    }).find((url) => isLikelyImageUrl(url) && !isNoisyXiaohongshuImageUrl(url));
    if (value) return value;
  }
  return "";
}
__name(collectPreferredXiaohongshuImageObjectUrl, "collectPreferredXiaohongshuImageObjectUrl");
function collectXiaohongshuNoteImageUrls(html) {
  const source = String(html || "");
  if (source.length > XIAOHONGSHU_FALLBACK_MAX_SOURCE_CHARACTERS) return [];
  const imageBlocks = collectJsonArrayBlocks(source, [
    "imageList",
    "image_list",
    "images",
    "imageUrls",
    "image_urls",
    "imageUrlList",
    "image_url_list"
  ], {
    maxSourceCharacters: XIAOHONGSHU_FALLBACK_MAX_SOURCE_CHARACTERS,
    maxBlocks: 16,
    maxBlockCharacters: XIAOHONGSHU_FALLBACK_MAX_JSON_BLOCK_CHARACTERS,
    maxTotalCharacters: XIAOHONGSHU_FALLBACK_MAX_SOURCE_CHARACTERS
  });
  const structuredUrls = [];
  for (const block of imageBlocks) {
    if (structuredUrls.length >= XIAOHONGSHU_CONTENT_MAX_IMAGES) break;
    const remainingImageCount = XIAOHONGSHU_CONTENT_MAX_IMAGES - structuredUrls.length;
    const imageObjects = collectTopLevelJsonObjectBlocks(block, {
      maxBlocks: remainingImageCount,
      maxBlockCharacters: 256 * 1024,
      maxTotalCharacters: XIAOHONGSHU_FALLBACK_MAX_JSON_BLOCK_CHARACTERS
    });
    if (imageObjects.length) {
      for (const imageObject of imageObjects) {
        pushUniqueUrl(structuredUrls, collectPreferredXiaohongshuImageObjectUrl(imageObject));
        if (structuredUrls.length >= XIAOHONGSHU_CONTENT_MAX_IMAGES) break;
      }
      continue;
    }
    collectJsonStringValues(block, [
      "url",
      "urlDefault",
      "urlPre",
      "url_pre",
      "urlSizeLarge",
      "url_size_large",
      "original",
      "originalUrl",
      "original_url",
      "src",
      "image",
      "imageUrl",
      "image_url",
      "cover"
    ], {
      maxSourceCharacters: XIAOHONGSHU_FALLBACK_MAX_JSON_BLOCK_CHARACTERS,
      maxMatches: XIAOHONGSHU_CONTENT_MAX_IMAGES,
      maxValues: remainingImageCount
    }).forEach((url) => {
      if (isLikelyImageUrl(url) && !isNoisyXiaohongshuImageUrl(url)) {
        pushUniqueUrl(structuredUrls, url);
      }
    });
    collectLooseXiaohongshuImageUrls(block, {
      maxSourceCharacters: XIAOHONGSHU_FALLBACK_MAX_JSON_BLOCK_CHARACTERS,
      maxValues: Math.max(1, XIAOHONGSHU_CONTENT_MAX_IMAGES - structuredUrls.length)
    }).forEach((url) => {
      if (!isNoisyXiaohongshuImageUrl(url)) pushUniqueUrl(structuredUrls, url);
    });
  }
  const structuredImages = dedupeImageVariants(structuredUrls).slice(0, XIAOHONGSHU_CONTENT_MAX_IMAGES);
  if (structuredImages.length) {
    return structuredImages;
  }
  const urls = [];
  [
    extractMetaContent(source, ["og:image", "og:image:url", "twitter:image"])
  ].forEach((url) => {
    if (url && !isNoisyXiaohongshuImageUrl(url)) pushUniqueUrl(urls, url);
  });
  collectFilteredImageTagUrls(source, {
    maxSourceCharacters: XIAOHONGSHU_FALLBACK_MAX_SOURCE_CHARACTERS,
    maxValues: XIAOHONGSHU_CONTENT_MAX_IMAGES
  }).forEach((url) => pushUniqueUrl(urls, url));
  const noteImages = dedupeImageVariants(urls).slice(0, XIAOHONGSHU_CONTENT_MAX_IMAGES);
  if (noteImages.length > 1) return noteImages;
  const fallbackImages = collectImageUrlsFromHtml(source, {
    maxSourceCharacters: XIAOHONGSHU_FALLBACK_MAX_SOURCE_CHARACTERS,
    maxValues: XIAOHONGSHU_CONTENT_MAX_IMAGES,
    acceptUrl: /* @__PURE__ */ __name((imageUrl) => !isNoisyXiaohongshuImageUrl(imageUrl), "acceptUrl")
  });
  return dedupeImageVariants([...noteImages, ...fallbackImages]).slice(0, 6);
}
__name(collectXiaohongshuNoteImageUrls, "collectXiaohongshuNoteImageUrls");
function sanitizeXiaohongshuMarkdownImages(markdown) {
  const source = String(markdown || "");
  if (!source.includes("## 图片")) return source;
  const lines = source.split("\n");
  const start = lines.findIndex((line) => /^##\s+图片\s*$/u.test(String(line || "").trim()));
  if (start < 0) return source;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/u.test(String(lines[index] || "").trim())) {
      end = index;
      break;
    }
  }
  const imageSection = lines.slice(start, end).join("\n");
  const imageUrls = [];
  const imagePattern = /!\[[^\]]*]\(([^)]+)\)/g;
  let match;
  while (match = imagePattern.exec(imageSection)) {
    const imageUrl = normalizeExtractedUrl(match[1]);
    if (imageUrl && isLikelyImageUrl(imageUrl) && !isNoisyXiaohongshuImageUrl(imageUrl)) {
      pushUniqueUrl(imageUrls, imageUrl);
    }
  }
  const cleanImages = dedupeImageVariants(imageUrls);
  if (!cleanImages.length || cleanImages.length === (imageSection.match(/!\[[^\]]*]\(/g) || []).length) {
    return source;
  }
  const replacement = ["## 图片", "", "### 封面", "", `![封面](${cleanImages[0]})`, ""];
  if (cleanImages.length > 1) {
    replacement.push("### 内页图", "");
    cleanImages.slice(1).forEach((imageUrl, index) => {
      replacement.push(`![内页图 ${index + 1}](${imageUrl})`, "");
    });
  }
  return [
    ...lines.slice(0, start),
    ...replacement,
    ...lines.slice(end)
  ].join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
__name(sanitizeXiaohongshuMarkdownImages, "sanitizeXiaohongshuMarkdownImages");
function extractVideoUrlFromHtml(html) {
  const source = String(html || "");
  const fromMeta = extractMetaContent(source, ["og:video", "og:video:url", "og:video:secure_url", "twitter:player:stream"]);
  if (fromMeta) return normalizeExtractedUrl(fromMeta);
  const videoTags = source.match(/<(?:video|source)\b[^>]*>/gi) || [];
  for (const tag of videoTags) {
    const src = getHtmlAttribute(tag, "src");
    if (src && isLikelyMediaUrl(src)) return normalizeExtractedUrl(src);
  }
  const match = source.match(/https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:mp4|m4a|mp3|m3u8)(?:\?[^"'\\\s<>]*)?/i);
  return match ? normalizeExtractedUrl(match[0]) : "";
}
__name(extractVideoUrlFromHtml, "extractVideoUrlFromHtml");
function extractPodcastAudioUrlFromHtml(html) {
  const source = String(html || "");
  const urls = [];
  [
    extractMetaContent(source, ["og:audio", "og:audio:url", "music:album", "twitter:player:stream"])
  ].forEach((url) => pushUniqueMediaUrl(urls, url));
  const audioTags = source.match(/<audio\b[^>]*>/gi) || [];
  audioTags.forEach((tag) => {
    pushUniqueMediaUrl(urls, getHtmlAttribute(tag, "src"));
  });
  collectJsonStringValues(source, [
    "audioUrl",
    "audio_url",
    "mediaUrl",
    "media_url",
    "enclosureUrl",
    "enclosure_url",
    "src",
    "url"
  ]).forEach((url) => pushUniqueMediaUrl(urls, url));
  const mediaPattern = /https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:mp3|m4a|aac|wav|ogg|flac)(?:\?[^"'\\\s<>]*)?/gi;
  let match;
  while (match = mediaPattern.exec(source)) {
    pushUniqueMediaUrl(urls, match[0]);
  }
  return urls[0] || "";
}
__name(extractPodcastAudioUrlFromHtml, "extractPodcastAudioUrlFromHtml");
function extractSocialMediaUrlsFromHtml(html) {
  const source = String(html || "");
  const urls = [];
  [
    extractVideoUrlFromHtml(source),
    extractPodcastAudioUrlFromHtml(source)
  ].forEach((url) => pushUniqueMediaUrl(urls, url));
  collectJsonStringValues(source, [
    "audioUrl",
    "audio_url",
    "downloadAddr",
    "download_addr",
    "mediaUrl",
    "media_url",
    "musicUrl",
    "music_url",
    "playApi",
    "play_api",
    "playAddr",
    "play_addr",
    "src",
    "streamUrl",
    "stream_url",
    "url",
    "videoUrl",
    "video_url"
  ]).forEach((url) => pushUniqueMediaUrl(urls, url));
  collectJsonArrayStringValues(source, [
    "urlList",
    "url_list",
    "downloadList",
    "download_list",
    "playUrlList",
    "play_url_list"
  ]).forEach((url) => pushUniqueMediaUrl(urls, url));
  extractLooseMediaUrlsFromText(source).forEach((url) => pushUniqueMediaUrl(urls, url));
  const mediaPattern = /https?:\\?\/\\?\/[^"'\\\s<>]+?\.(?:mp3|m4a|aac|wav|ogg|flac|mp4|m4s|m3u8)(?:\?[^"'\\\s<>]*)?/gi;
  let match;
  while (match = mediaPattern.exec(source)) {
    pushUniqueMediaUrl(urls, match[0]);
  }
  return sortMediaUrlsForTranscription(urls);
}
__name(extractSocialMediaUrlsFromHtml, "extractSocialMediaUrlsFromHtml");
function extractSocialMediaUrlFromHtml(html) {
  return extractSocialMediaUrlsFromHtml(html)[0] || "";
}
__name(extractSocialMediaUrlFromHtml, "extractSocialMediaUrlFromHtml");
function collectDouyinUrlList(value, urls) {
  if (!value) return;
  if (typeof value === "string") {
    pushUniqueMediaUrl(urls, value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectDouyinUrlList(item, urls));
    return;
  }
  if (typeof value === "object") {
    collectDouyinUrlList(value.url_list, urls);
    collectDouyinUrlList(value.urlList, urls);
    collectDouyinUrlList(value.url, urls);
  }
}
__name(collectDouyinUrlList, "collectDouyinUrlList");
function extractDouyinMediaUrlsFromDetailPayload(payload) {
  const detail = payload && (payload.aweme_detail || payload.awemeDetail || payload.item_list && payload.item_list[0]);
  if (!detail || typeof detail !== "object") return [];
  const video = detail.video || {};
  const urls = [];
  collectDouyinUrlList(video.play_addr, urls);
  collectDouyinUrlList(video.download_addr, urls);
  collectDouyinUrlList(video.playAddr, urls);
  collectDouyinUrlList(video.downloadAddr, urls);
  (Array.isArray(video.bit_rate) ? video.bit_rate : []).forEach((item) => {
    collectDouyinUrlList(item && item.play_addr, urls);
    collectDouyinUrlList(item && item.playAddr, urls);
  });
  return sortMediaUrlsForTranscription(urls);
}
__name(extractDouyinMediaUrlsFromDetailPayload, "extractDouyinMediaUrlsFromDetailPayload");
function getDouyinDetailAwemeId(payload) {
  const detail = payload && (payload.aweme_detail || payload.awemeDetail || payload.item_list && payload.item_list[0]);
  return String(detail && (detail.aweme_id || detail.awemeId) || "").trim();
}
__name(getDouyinDetailAwemeId, "getDouyinDetailAwemeId");
function extractDouyinMediaUrlsForAweme(payload, awemeId) {
  const targetId = String(awemeId || "").trim();
  if (!targetId) return [];
  let root = payload;
  if (typeof root === "string") {
    try {
      root = JSON.parse(root || "{}");
    } catch (error) {
      return [];
    }
  }
  if (!root || typeof root !== "object") return [];
  const urls = [];
  const seen = /* @__PURE__ */ new Set();
  const visit = /* @__PURE__ */ __name((value, depth = 0) => {
    if (!value || typeof value !== "object" || depth > 16 || seen.size > 1e4 || seen.has(value)) return;
    seen.add(value);
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, depth + 1));
      return;
    }
    const candidateId = String(value.aweme_id || value.awemeId || "").trim();
    if (candidateId === targetId && value.video && typeof value.video === "object") {
      extractDouyinMediaUrlsFromDetailPayload({ aweme_detail: value }).forEach((url) => pushUniqueMediaUrl(urls, url));
    }
    Object.values(value).forEach((item) => visit(item, depth + 1));
  }, "visit");
  visit(root);
  return sortMediaUrlsForTranscription(urls);
}
__name(extractDouyinMediaUrlsForAweme, "extractDouyinMediaUrlsForAweme");
function isUnavailableXiaohongshuPage(html, url = "") {
  const source = decodeHtmlEntities(String(html || ""));
  const target = String(url || "");
  return /xiaohongshu\.com\/404/i.test(target) || /errorCode=-510001|error_code=300031/i.test(target) || source.includes("你访问的页面不见了") || source.includes("当前笔记暂时无法浏览");
}
__name(isUnavailableXiaohongshuPage, "isUnavailableXiaohongshuPage");
function isGenericXiaohongshuTitle(title) {
  return String(title || "").trim().includes("你的生活兴趣社区");
}
__name(isGenericXiaohongshuTitle, "isGenericXiaohongshuTitle");
function getXiaohongshuTargetNoteId(url = "") {
  if (!isTrustedXiaohongshuCookieUrl(url)) return "";
  try {
    const parsed = new URL(String(url || "").trim());
    const pathMatch = parsed.pathname.match(/\/(?:explore|discovery\/item|item)\/([0-9a-z_-]{6,})/i);
    if (pathMatch) return decodeURIComponent(pathMatch[1]);
    for (const key of ["note_id", "noteId", "item_id", "itemId"]) {
      const value = String(parsed.searchParams.get(key) || "").trim();
      if (/^[0-9a-z_-]{6,}$/i.test(value)) return value;
    }
  } catch (error) {
  }
  return "";
}
__name(getXiaohongshuTargetNoteId, "getXiaohongshuTargetNoteId");
function normalizeXiaohongshuJsonState(source) {
  const input = String(source || "");
  let output = "";
  let quote = "";
  let escaped = false;
  for (let index = 0; index < input.length; ) {
    const char = input[index];
    if (escaped) {
      output += char;
      escaped = false;
      index += 1;
      continue;
    }
    if (quote) {
      output += char;
      if (char === "\\") escaped = true;
      else if (char === quote) quote = "";
      index += 1;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      output += char;
      index += 1;
      continue;
    }
    const primitive = input.slice(index).match(/^(?:-?Infinity|undefined|NaN)(?![A-Za-z0-9_$])/);
    if (primitive) {
      output += "null";
      index += primitive[0].length;
      continue;
    }
    output += char;
    index += 1;
  }
  return output;
}
__name(normalizeXiaohongshuJsonState, "normalizeXiaohongshuJsonState");
function tryParseXiaohongshuStateBlock(source) {
  try {
    return JSON.parse(String(source || ""));
  } catch (error) {
    try {
      return JSON.parse(normalizeXiaohongshuJsonState(source));
    } catch (normalizedError) {
      return null;
    }
  }
}
__name(tryParseXiaohongshuStateBlock, "tryParseXiaohongshuStateBlock");
function normalizeXiaohongshuStructuredTag(value) {
  const raw = typeof value === "string" ? value : String(value && (value.name || value.tagName || value.tag_name || value.title || value.topicName || value.topic_name) || "");
  const cleaned = raw.trim().replace(/^#+/, "").replace(/\s+/g, "_");
  if (!cleaned || cleaned.length > 48 || /^https?:\/\//i.test(cleaned)) return "";
  return `#${cleaned}`;
}
__name(normalizeXiaohongshuStructuredTag, "normalizeXiaohongshuStructuredTag");
function collectXiaohongshuStructuredTags(note, description = "") {
  const tags = extractTagsFromText(description, "").slice(0, 64);
  const seen = new Set(tags);
  const addTag = /* @__PURE__ */ __name((value) => {
    if (tags.length >= 64) return;
    const tag = normalizeXiaohongshuStructuredTag(value);
    if (tag && !seen.has(tag)) {
      seen.add(tag);
      tags.push(tag);
    }
  }, "addTag");
  [
    note && note.tagList,
    note && note.tag_list,
    note && note.topicList,
    note && note.topic_list,
    note && note.topics
  ].forEach((group) => {
    if (!Array.isArray(group) || tags.length >= 64) return;
    for (let index = 0; index < group.length && tags.length < 64; index += 1) {
      addTag(group[index]);
    }
  });
  return tags;
}
__name(collectXiaohongshuStructuredTags, "collectXiaohongshuStructuredTags");
function collectXiaohongshuStructuredImages(note) {
  const imageList = note && (note.imageList || note.image_list || note.images || note.imageUrls || note.image_urls) || [];
  if (!Array.isArray(imageList) || !imageList.length) return [];
  try {
    return collectXiaohongshuNoteImageUrls(JSON.stringify({
      imageList: imageList.slice(0, 100)
    })).slice(0, 100);
  } catch (error) {
    return [];
  }
}
__name(collectXiaohongshuStructuredImages, "collectXiaohongshuStructuredImages");
function extractXiaohongshuStructuredVideoUrl(note) {
  if (!note || typeof note !== "object") return "";
  const urls = [];
  let visitedEntries = 0;
  const collect = /* @__PURE__ */ __name((value, depth = 0) => {
    if (!value || depth > 10 || visitedEntries >= 500 || urls.length >= 8) return;
    visitedEntries += 1;
    if (typeof value === "string") {
      pushUniqueMediaUrl(urls, value);
      return;
    }
    if (Array.isArray(value)) {
      for (let index = 0; index < value.length && visitedEntries < 500 && urls.length < 8; index += 1) {
        collect(value[index], depth + 1);
      }
      return;
    }
    if (typeof value !== "object") return;
    Object.entries(value).forEach(([key, child]) => {
      if (/^(?:url|urlList|url_list|masterUrl|master_url|backupUrls|backup_urls|playUrl|play_url|originVideoKey|origin_video_key)$/i.test(key) || /^(?:media|stream|h264|h265|h266|av1|consumer|videoInfo|video_info)$/i.test(key)) {
        collect(child, depth + 1);
      }
    });
  }, "collect");
  [
    note.videoUrl,
    note.video_url,
    note.video,
    note.videoInfo,
    note.video_info
  ].forEach((value) => collect(value));
  return urls[0] || "";
}
__name(extractXiaohongshuStructuredVideoUrl, "extractXiaohongshuStructuredVideoUrl");
function isXiaohongshuStructuredVideoNote(note) {
  if (!note || typeof note !== "object") return false;
  const declaredType = String(
    note.noteType || note.note_type || note.type || note.contentType || note.content_type || ""
  ).trim().toLowerCase();
  if (/(?:video|视频)/i.test(declaredType)) return true;
  return Boolean(note.video || note.videoInfo || note.video_info || note.videoUrl || note.video_url);
}
__name(isXiaohongshuStructuredVideoNote, "isXiaohongshuStructuredVideoNote");
function extractXiaohongshuPrimaryNotePayload(html, url = "") {
  const targetNoteId = getXiaohongshuTargetNoteId(url);
  const empty = {
    targetNoteIdPresent: Boolean(targetNoteId),
    matched: false,
    structuredIdentityMismatch: false,
    title: "",
    description: "",
    tags: [],
    imageUrls: [],
    videoUrl: "",
    isVideoNote: false,
    author: "",
    socialMetrics: {}
  };
  if (!targetNoteId) return empty;
  const rawSource = String(html || "");
  if (rawSource.length > 8 * 1024 * 1024) return empty;
  const normalizedTargetId = targetNoteId.toLowerCase();
  const candidates = [];
  const source = decodeHtmlEntities(rawSource);
  const blocks = collectTopLevelJsonObjectBlocks(source, {
    maxBlocks: 16,
    maxBlockCharacters: 2 * 1024 * 1024,
    maxTotalCharacters: 4 * 1024 * 1024,
    requiredTexts: ["noteDetailMap", '"noteId"', '"note_id"']
  }).filter((block) => /noteDetailMap|note_?id|displayTitle|imageList|image_list/i.test(block));
  const traversalBudget = { nodes: 0, maxNodes: 3e4 };
  let structuredIdentityMismatch = false;
  const visit = /* @__PURE__ */ __name((value, path2 = [], seen = /* @__PURE__ */ new Set(), depth = 0) => {
    if (!value || typeof value !== "object" || depth > 20 || seen.size > 2e4 || traversalBudget.nodes >= traversalBudget.maxNodes || candidates.length >= 8 || seen.has(value)) return;
    seen.add(value);
    traversalBudget.nodes += 1;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, path2, seen, depth + 1));
      return;
    }
    const normalizedPath = path2.map((entry) => String(entry || "").toLowerCase());
    const insideExcludedTree = normalizedPath.some((entry) => entry !== normalizedTargetId && /^(?:comments?|comment_?list|replies|reply_?list|feeds?|recommend(?:ation|ed|s)?|search(?:result|results)?|related|cards?|similar)$/i.test(entry));
    const objectNoteIds = [value.noteId, value.note_id].map((entry) => String(entry || "").trim().toLowerCase()).filter(Boolean);
    const objectKeys = Object.keys(value);
    const looksLikeNote = objectKeys.some((key) => /^(?:displayTitle|display_title|desc|description|noteContent|note_content|content|imageList|image_list|noteType|note_type)$/i.test(key));
    if (looksLikeNote && objectNoteIds.length && !objectNoteIds.includes(normalizedTargetId)) {
      structuredIdentityMismatch = true;
    }
    const targetPathIndex = normalizedPath.lastIndexOf(normalizedTargetId);
    const targetPathSuffix = targetPathIndex >= 0 ? normalizedPath.slice(targetPathIndex + 1).join("/") : "";
    const inheritsTargetFromPath = targetPathIndex >= 0 && [
      "",
      "note",
      "data",
      "item",
      "notedetail",
      "note_detail",
      "data/note",
      "item/note",
      "notedetail/note",
      "note_detail/note"
    ].includes(targetPathSuffix);
    const matchesTarget = objectNoteIds.length ? objectNoteIds.includes(normalizedTargetId) : inheritsTargetFromPath;
    if (matchesTarget && looksLikeNote && !insideExcludedTree) {
      const title = decodeHtmlEntities(String(
        value.displayTitle || value.display_title || value.title || ""
      )).trim();
      const description = cleanSocialDescription(
        value.desc || value.description || value.noteContent || value.note_content || value.content || ""
      ).slice(0, 1e5);
      const imageUrls = collectXiaohongshuStructuredImages(value);
      const videoUrl = extractXiaohongshuStructuredVideoUrl(value);
      const isVideoNote = isXiaohongshuStructuredVideoNote(value);
      const author = cleanSocialDescription(
        value.user && (value.user.nickname || value.user.nickName || value.user.userName) || value.userInfo && (value.userInfo.nickname || value.userInfo.nickName || value.userInfo.userName) || ""
      );
      const hasSubstantiveDescription = Boolean(description) && !isDefaultXiaohongshuDescription(description) && !isXiaohongshuShareBoilerplateOnly({
        title,
        description,
        markdown: description
      });
      if (hasSubstantiveDescription || imageUrls.length || videoUrl) {
        candidates.push({
          targetNoteIdPresent: true,
          matched: true,
          title: isGenericXiaohongshuTitle(title) ? "" : title,
          description: hasSubstantiveDescription ? description : "",
          tags: collectXiaohongshuStructuredTags(value, description),
          imageUrls,
          videoUrl,
          isVideoNote,
          author,
          socialMetrics: buildSocialMetrics(value)
        });
      }
    }
    Object.entries(value).forEach(([key, child]) => {
      if (child && typeof child === "object") {
        visit(child, [...normalizedPath, String(key || "").toLowerCase()], seen, depth + 1);
      }
    });
  }, "visit");
  blocks.forEach((block) => {
    const parsed = tryParseXiaohongshuStateBlock(block);
    if (parsed) visit(parsed, []);
  });
  if (!candidates.length) return {
    ...empty,
    structuredIdentityMismatch
  };
  candidates.sort((left, right) => (String(right.title || "").length ? 1e3 : 0) + Math.min(String(right.description || "").length, 5e3) + right.imageUrls.length * 500 + (right.videoUrl ? 300 : 0) - ((String(left.title || "").length ? 1e3 : 0) + Math.min(String(left.description || "").length, 5e3) + left.imageUrls.length * 500 + (left.videoUrl ? 300 : 0)));
  return {
    ...candidates[0],
    structuredIdentityMismatch
  };
}
__name(extractXiaohongshuPrimaryNotePayload, "extractXiaohongshuPrimaryNotePayload");
function shouldStopWaitingForXiaohongshuContent(html, url = "") {
  return extractXiaohongshuPrimaryNotePayload(html, url).matched === true;
}
__name(shouldStopWaitingForXiaohongshuContent, "shouldStopWaitingForXiaohongshuContent");
function getXiaohongshuCanonicalUrlFromHtml(html = "") {
  const source = String(html || "");
  const linkTags = source.match(/<link\b[^>]*>/gi) || [];
  for (const tag of linkTags) {
    const rel = String(getHtmlAttribute(tag, "rel") || "").toLowerCase().split(/\s+/);
    if (!rel.includes("canonical")) continue;
    const href = normalizeExtractedUrl(getHtmlAttribute(tag, "href"));
    if (isXiaohongshuUrl(href) && getXiaohongshuTargetNoteId(href)) return href;
  }
  const ogUrl = normalizeExtractedUrl(extractMetaContent(source, ["og:url"]));
  return isXiaohongshuUrl(ogUrl) && getXiaohongshuTargetNoteId(ogUrl) ? ogUrl : "";
}
__name(getXiaohongshuCanonicalUrlFromHtml, "getXiaohongshuCanonicalUrlFromHtml");
function resolveXiaohongshuIdentityUrl(urls = [], html = "") {
  const candidates = Array.isArray(urls) ? urls : [urls];
  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (isXiaohongshuUrl(value) && getXiaohongshuTargetNoteId(value)) return value;
  }
  return getXiaohongshuCanonicalUrlFromHtml(html);
}
__name(resolveXiaohongshuIdentityUrl, "resolveXiaohongshuIdentityUrl");
function rememberXiaohongshuObservedIdentity(previous = "", details = {}) {
  const remembered = resolveXiaohongshuIdentityUrl([previous]);
  if (remembered) return remembered;
  const resourceType = String(details && details.resourceType || "").toLowerCase().replace(/[^a-z]/g, "");
  const isMainFrame = resourceType ? resourceType === "mainframe" : Number(details && details.frameId) === 0 && Number(details && details.parentFrameId) < 0;
  if (!isMainFrame) return "";
  return resolveXiaohongshuIdentityUrl([
    details && details.redirectURL,
    details && details.url
  ]);
}
__name(rememberXiaohongshuObservedIdentity, "rememberXiaohongshuObservedIdentity");
function installXiaohongshuIdentityObserver(webContents, onIdentity) {
  if (!webContents || typeof webContents.on !== "function" || typeof webContents.removeListener !== "function" || typeof onIdentity !== "function") {
    return () => {
    };
  }
  const observeNavigationDetails = /* @__PURE__ */ __name((event, navigationUrl, legacyIsMainFrame, assumeLegacyMainFrame) => {
    const hasCurrentDetails = Boolean(
      event && typeof event.url === "string" && typeof event.isMainFrame === "boolean"
    );
    const candidate = hasCurrentDetails ? event.url : String(navigationUrl && navigationUrl.url || navigationUrl || "");
    const isMainFrame = hasCurrentDetails ? event.isMainFrame === true : typeof legacyIsMainFrame === "boolean" ? legacyIsMainFrame : assumeLegacyMainFrame;
    if (!isMainFrame) return;
    const identityUrl = rememberXiaohongshuObservedIdentity("", {
      resourceType: "mainFrame",
      url: candidate
    });
    if (identityUrl) onIdentity(identityUrl);
  }, "observeNavigationDetails");
  const observeNavigation = /* @__PURE__ */ __name((event, navigationUrl, _isInPlace, isMainFrame) => {
    observeNavigationDetails(event, navigationUrl, isMainFrame, true);
  }, "observeNavigation");
  const observeRedirect = /* @__PURE__ */ __name((event, navigationUrl, _isInPlace, isMainFrame) => {
    observeNavigationDetails(event, navigationUrl, isMainFrame, false);
  }, "observeRedirect");
  webContents.on("will-navigate", observeNavigation);
  webContents.on("will-redirect", observeRedirect);
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    webContents.removeListener("will-navigate", observeNavigation);
    webContents.removeListener("will-redirect", observeRedirect);
  };
}
__name(installXiaohongshuIdentityObserver, "installXiaohongshuIdentityObserver");
function selectXiaohongshuBrowserSnapshot(previous = null, current = null, expectedUrl = "") {
  const prior = previous && typeof previous === "object" ? previous : {};
  const candidate = current && typeof current === "object" ? current : {};
  const currentHtml = String(candidate.html || "");
  const currentUrl = String(candidate.url || "");
  const identityUrl = resolveXiaohongshuIdentityUrl([
    expectedUrl,
    prior.identityUrl,
    currentUrl
  ], currentHtml);
  const matched = isTrustedXiaohongshuCookieUrl(currentUrl) && Boolean(identityUrl) && shouldStopWaitingForXiaohongshuContent(currentHtml, identityUrl);
  if (matched) {
    return {
      html: currentHtml,
      url: currentUrl,
      identityUrl,
      matched: true
    };
  }
  const previousHtml = String(prior.html || "");
  const selected = currentHtml.length > previousHtml.length ? candidate : prior;
  return {
    html: String(selected.html || ""),
    url: String(selected.url || ""),
    identityUrl,
    matched: false
  };
}
__name(selectXiaohongshuBrowserSnapshot, "selectXiaohongshuBrowserSnapshot");
function isGenericXiaohongshuLandingExtraction(extracted) {
  if (!extracted) return true;
  if (extracted.xiaohongshuPrimaryNoteMatched === true) return false;
  const title = String(extracted.title || "").trim();
  const description = String(extracted.description || "").trim();
  return isGenericXiaohongshuTitle(title) || /该内容来自小红书/.test(description) && /打开小红书/.test(description);
}
__name(isGenericXiaohongshuLandingExtraction, "isGenericXiaohongshuLandingExtraction");
function getPreferredXiaohongshuTitle(existingTitle, extractedTitle, fallback = "小红书笔记") {
  const current = String(existingTitle || "").trim();
  if (current && !isGenericXiaohongshuTitle(current)) return current;
  return String(extractedTitle || "").trim() || fallback;
}
__name(getPreferredXiaohongshuTitle, "getPreferredXiaohongshuTitle");
function hasReadableXiaohongshuGraphicContent(extracted, html, url = "") {
  if (!extracted || !isTrustedXiaohongshuCookieUrl(url) || isUnavailableXiaohongshuPage(html, url)) return false;
  const hasImages = Array.isArray(extracted.imageUrls) && extracted.imageUrls.length > 0;
  if (hasImages) return true;
  if (isXiaohongshuShareBoilerplateOnly(extracted)) return false;
  const description = String(extracted.description || "").trim();
  if (/分享口令/.test(description)) return false;
  if (!description || description.length < 20) return false;
  if (/^(?:短链落地页|当前笔记暂时无法浏览|你访问的页面不见了|页面未直接暴露正文)/.test(description)) return false;
  return true;
}
__name(hasReadableXiaohongshuGraphicContent, "hasReadableXiaohongshuGraphicContent");
function shouldProbeXiaohongshuMediaFromGenericLanding(extracted, html, url = "") {
  if (!extracted || extracted.videoUrl || isUnavailableXiaohongshuPage(html, url)) return false;
  const title = String(extracted.title || "").trim();
  const description = String(extracted.description || "").trim();
  return title.includes("你的生活兴趣社区") || /该内容来自小红书/.test(description) && /打开小红书/.test(description);
}
__name(shouldProbeXiaohongshuMediaFromGenericLanding, "shouldProbeXiaohongshuMediaFromGenericLanding");
function extractBilibiliSubtitleUrlsFromHtml(html) {
  const source = String(html || "");
  const urls = [];
  collectJsonStringValues(source, [
    "subtitle_url",
    "subtitleUrl"
  ]).forEach((value) => {
    const url = normalizeExtractedUrl(value);
    if (/^https?:\/\//i.test(url) && !urls.includes(url)) urls.push(url);
  });
  const pattern = /["']subtitle_url["']\s*:\s*["']((?:\\.|[^"'\\])+)["']/gi;
  let match;
  while (match = pattern.exec(source)) {
    const url = normalizeExtractedUrl(decodeJsonLikeString(match[1]));
    if (url && !urls.includes(url)) urls.push(url);
  }
  return urls;
}
__name(extractBilibiliSubtitleUrlsFromHtml, "extractBilibiliSubtitleUrlsFromHtml");
function parseBilibiliSubtitlePayload(payload) {
  const data = typeof payload === "string" ? tryParseJson(payload) : payload;
  const body = Array.isArray(data && data.body) ? data.body : [];
  return body.map((item) => String(item && (item.content || item.text) || "").trim()).filter(Boolean).join("\n").trim();
}
__name(parseBilibiliSubtitlePayload, "parseBilibiliSubtitlePayload");
function extractBilibiliBvid(url) {
  const match = String(url || "").match(/BV[0-9A-Za-z]+/);
  return match ? match[0] : "";
}
__name(extractBilibiliBvid, "extractBilibiliBvid");
function extractBilibiliCidFromPayload(payload) {
  const data = typeof payload === "string" ? tryParseJson(payload) : payload;
  const pages = data && data.data && Array.isArray(data.data.pages) ? data.data.pages : [];
  const cid = pages[0] && pages[0].cid || data && data.data && data.data.cid || "";
  return cid ? String(cid) : "";
}
__name(extractBilibiliCidFromPayload, "extractBilibiliCidFromPayload");
function extractBilibiliAudioUrlFromPlayurlPayload(payload) {
  const data = typeof payload === "string" ? tryParseJson(payload) : payload;
  const playData = data && data.data ? data.data : {};
  const audioList = playData.dash && Array.isArray(playData.dash.audio) ? playData.dash.audio : [];
  for (const item of audioList) {
    const url = normalizeExtractedUrl(item && (item.baseUrl || item.base_url || item.url));
    if (url) return url;
    const backups = item && (item.backupUrl || item.backup_url) || [];
    if (Array.isArray(backups) && backups.length) {
      const backupUrl = normalizeExtractedUrl(backups[0]);
      if (backupUrl) return backupUrl;
    }
  }
  const durlList = Array.isArray(playData.durl) ? playData.durl : [];
  for (const item of durlList) {
    const url = normalizeExtractedUrl(item && item.url);
    if (url) return url;
  }
  return "";
}
__name(extractBilibiliAudioUrlFromPlayurlPayload, "extractBilibiliAudioUrlFromPlayurlPayload");
function extractBilibiliProgressiveVideoUrlFromPlayurlPayload(payload) {
  const data = typeof payload === "string" ? tryParseJson(payload) : payload;
  const playData = data && data.data ? data.data : {};
  const durlList = Array.isArray(playData.durl) ? playData.durl : [];
  for (const item of durlList) {
    const url = normalizeExtractedUrl(item && item.url);
    if (url) return url;
    const backups = item && (item.backupUrl || item.backup_url) || [];
    if (Array.isArray(backups) && backups.length) {
      const backupUrl = normalizeExtractedUrl(backups[0]);
      if (backupUrl) return backupUrl;
    }
  }
  return "";
}
__name(extractBilibiliProgressiveVideoUrlFromPlayurlPayload, "extractBilibiliProgressiveVideoUrlFromPlayurlPayload");
function extractBilibiliAudioUrlFromHtml(html) {
  const source = String(html || "");
  const urls = [];
  collectJsonStringValues(source, [
    "baseUrl",
    "base_url",
    "backupUrl",
    "backup_url"
  ]).forEach((url) => pushUniqueMediaUrl(urls, url));
  const mediaPattern = /https?:\\?\/\\?\/[^"'\\\s<>]+?(?:bilivideo\.com|bilibili\.com)[^"'\\\s<>]+?(?:audio|\.m4s|\.m4a|\.mp3)[^"'\\\s<>]*/gi;
  let match;
  while (match = mediaPattern.exec(source)) {
    pushUniqueMediaUrl(urls, match[0]);
  }
  return urls[0] || "";
}
__name(extractBilibiliAudioUrlFromHtml, "extractBilibiliAudioUrlFromHtml");
function extractTagsFromText(text, html = "") {
  const tags = [];
  const source = `${text || ""}
${extractMetaContent(html, ["keywords", "article:tag"]) || ""}`;
  const hashPattern = /#([\p{L}\p{N}_-]{1,32})/gu;
  let match;
  while (match = hashPattern.exec(source)) {
    const tag = `#${match[1]}`;
    if (!tags.includes(tag)) tags.push(tag);
  }
  source.split(/[,，、\s]+/).forEach((item) => {
    const cleaned = item.trim();
    if (cleaned && cleaned.length <= 24 && !cleaned.includes("http") && !cleaned.startsWith("#") && extractMetaContent(html, ["keywords"]).includes(cleaned)) {
      const tag = `#${cleaned}`;
      if (!tags.includes(tag)) tags.push(tag);
    }
  });
  return tags;
}
__name(extractTagsFromText, "extractTagsFromText");
function cleanSocialDescription(text) {
  return decodeHtmlEntities(String(text || "")).replace(/\\n/g, "\n").replace(/https?:\/\/\S+/gi, "").replace(/把文字复制好，?\s*然后去【小红书】查看详情。?/g, "").replace(/\s+#/g, "\n#").replace(/\n{3,}/g, "\n\n").trim();
}
__name(cleanSocialDescription, "cleanSocialDescription");
function isDefaultXiaohongshuDescription(text) {
  return /^3\s*亿人的生活经验/.test(String(text || "").trim());
}
__name(isDefaultXiaohongshuDescription, "isDefaultXiaohongshuDescription");
function isNoisyXiaohongshuDescription(text) {
  const source = String(text || "");
  if (!source) return true;
  if (isDefaultXiaohongshuDescription(source)) return true;
  const compact = source.replace(/\s+/g, "");
  if (compact.length > 6e3) return true;
  const noisyMarkers = [
    "window.__INITIAL_STATE__",
    "window.__SSR__",
    "ICP备",
    "营业执照",
    "违法不良信息举报",
    "增值电信业务经营许可证",
    "创作中心",
    "appSettings",
    "serverTime",
    "webpack"
  ];
  const markerCount = noisyMarkers.reduce((count, marker) => count + (source.includes(marker) ? 1 : 0), 0);
  if (markerCount >= 2) return true;
  const jsonNoiseCount = (source.match(/[{}[\]"'=]/g) || []).length;
  return source.length > 1200 && jsonNoiseCount / Math.max(source.length, 1) > 0.08;
}
__name(isNoisyXiaohongshuDescription, "isNoisyXiaohongshuDescription");
function stripScriptAndStyleBlocks(html) {
  return String(html || "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<noscript[\s\S]*?<\/noscript>/gi, "");
}
__name(stripScriptAndStyleBlocks, "stripScriptAndStyleBlocks");
function scoreXiaohongshuDescriptionCandidate(candidate) {
  const text = String(candidate.text || "").trim();
  const length = Array.from(text).length;
  let score = Math.min(length, 3e3) + (candidate.weight || 0);
  if (/#([\p{L}\p{N}_-]{1,32})/u.test(text)) score += 500;
  if (/[\u4e00-\u9fff].*[\u4e00-\u9fff]/u.test(text)) score += 200;
  if (length < 12) score -= 1e3;
  return score;
}
__name(scoreXiaohongshuDescriptionCandidate, "scoreXiaohongshuDescriptionCandidate");
function collectXiaohongshuNoteContentValues(source) {
  const values = [];
  const rawSource = String(source || "");
  if (rawSource.length > 8 * 1024 * 1024) return values;
  const traversalBudget = { nodes: 0, maxNodes: 3e4 };
  const seen = /* @__PURE__ */ new Set();
  const pushValue = /* @__PURE__ */ __name((value) => {
    const text = decodeHtmlEntities(String(value || "")).trim();
    if (text && !values.includes(text)) values.push(text);
  }, "pushValue");
  const visit = /* @__PURE__ */ __name((value, path2 = []) => {
    if (!value || typeof value !== "object" || traversalBudget.nodes >= traversalBudget.maxNodes || values.length >= 64 || seen.has(value)) return;
    seen.add(value);
    traversalBudget.nodes += 1;
    if (Array.isArray(value)) {
      value.forEach((item) => visit(item, path2));
      return;
    }
    const normalizedPath = path2.map((entry) => String(entry || "").toLowerCase());
    const insideCommentTree = normalizedPath.some((entry) => /comment|reply/.test(entry));
    const objectKeys = Object.keys(value).map((key) => String(key || "").toLowerCase());
    const looksLikeNote = normalizedPath.some((entry) => /note/.test(entry)) || objectKeys.some((key) => /^(?:image_?list|display_?title|note_?type)$/.test(key));
    Object.entries(value).forEach(([key, child]) => {
      const normalizedKey = String(key || "").toLowerCase();
      if (normalizedKey === "content" && typeof child === "string" && looksLikeNote && !insideCommentTree) {
        pushValue(child);
      }
      if (child && typeof child === "object") visit(child, [...normalizedPath, normalizedKey]);
    });
  }, "visit");
  collectTopLevelJsonObjectBlocks(decodeHtmlEntities(rawSource), {
    maxBlocks: 16,
    maxBlockCharacters: 2 * 1024 * 1024,
    maxTotalCharacters: 4 * 1024 * 1024,
    requiredTexts: ['"content"', "'content'"]
  }).forEach((block) => {
    try {
      visit(JSON.parse(block), []);
    } catch (error) {
    }
  });
  return values;
}
__name(collectXiaohongshuNoteContentValues, "collectXiaohongshuNoteContentValues");
function extractXiaohongshuDescription(html, fallbackText = "") {
  var _a;
  const source = String(html || "");
  const jsonCandidates = [
    ...collectJsonStringValues(source, [
      "desc",
      "description",
      "noteContent",
      "note_content",
      "displayTitle"
    ], {
      maxSourceCharacters: 4 * 1024 * 1024,
      maxMatches: 256,
      maxValues: 64
    }),
    ...collectXiaohongshuNoteContentValues(source)
  ];
  const candidates = [
    { text: cleanSocialDescription(fallbackText), weight: 100 },
    { text: cleanSocialDescription(extractMetaContent(source, ["description", "og:description", "twitter:description"])), weight: 300 },
    ...jsonCandidates.map((text) => ({ text: cleanSocialDescription(text), weight: 800 })),
    { text: cleanSocialDescription(stripHtmlTags(stripScriptAndStyleBlocks(selectReadableHtml(source)))), weight: 0 }
  ].filter((item) => item.text && !/^https?:\/\//i.test(item.text) && !isNoisyXiaohongshuDescription(item.text));
  candidates.sort((a, b) => scoreXiaohongshuDescriptionCandidate(b) - scoreXiaohongshuDescriptionCandidate(a));
  return ((_a = candidates[0]) == null ? void 0 : _a.text) || "";
}
__name(extractXiaohongshuDescription, "extractXiaohongshuDescription");
function extractXiaohongshuAuthor(html) {
  const source = String(html || "");
  const candidates = collectJsonStringValues(source, [
    "nickname",
    "nickName",
    "userNickname",
    "user_nickname",
    "userName"
  ], {
    maxSourceCharacters: 4 * 1024 * 1024,
    maxMatches: 128,
    maxValues: 64
  }).map((item) => cleanSocialDescription(item)).filter((item) => item && item.length <= 40 && !/^https?:\/\//i.test(item));
  return candidates[0] || "";
}
__name(extractXiaohongshuAuthor, "extractXiaohongshuAuthor");
var buildXiaohongshuMarkdown = createXiaohongshuMarkdownBuilder({
  buildCommentsMarkdown: /* @__PURE__ */ __name((...args) => buildSocialCommentsMarkdown(...args), "buildCommentsMarkdown")
});
function extractXiaohongshuMarkdownFromHtml(html, url, fallbackText = "", options = {}) {
  url = cleanDisplayUrl(url);
  const source = String(html || "");
  const primaryNote = extractXiaohongshuPrimaryNotePayload(source, url);
  const pageTitle = extractMetaContent(source, ["og:title", "twitter:title"]) || extractHtmlTitle(source) || "小红书笔记";
  const title = primaryNote.matched ? primaryNote.title || "小红书笔记" : pageTitle;
  const description = primaryNote.matched ? primaryNote.description : extractXiaohongshuDescription(source, fallbackText);
  const tags = primaryNote.matched ? primaryNote.tags : extractTagsFromText(description, source);
  const images = primaryNote.matched ? primaryNote.imageUrls : collectXiaohongshuNoteImageUrls(source);
  const videoUrl = primaryNote.matched ? primaryNote.videoUrl : extractVideoUrlFromHtml(source);
  const includeComments = options.includeComments !== false;
  const comments = includeComments ? extractSocialCommentsFromHtml(source) : [];
  return {
    title,
    author: primaryNote.matched ? primaryNote.author : extractXiaohongshuAuthor(source),
    description,
    tags,
    markdown: buildXiaohongshuMarkdown({
      title,
      description,
      tags,
      imageUrls: images,
      videoUrl,
      comments
    }),
    imageUrls: images,
    videoUrl,
    isVideoNote: primaryNote.matched ? primaryNote.isVideoNote === true : false,
    comments,
    socialMetrics: primaryNote.matched ? primaryNote.socialMetrics || {} : {},
    xiaohongshuTargetNoteIdPresent: primaryNote.targetNoteIdPresent,
    xiaohongshuPrimaryNoteMatched: primaryNote.matched,
    xiaohongshuStructuredIdentityMismatch: primaryNote.structuredIdentityMismatch
  };
}
__name(extractXiaohongshuMarkdownFromHtml, "extractXiaohongshuMarkdownFromHtml");
function mergeXiaohongshuExtractions(extractions = [], preferred = null) {
  var _a;
  const ordered = [];
  const addExtraction = /* @__PURE__ */ __name((item) => {
    if (!item || typeof item !== "object" || ordered.includes(item)) return;
    ordered.push(item);
  }, "addExtraction");
  addExtraction(preferred);
  (Array.isArray(extractions) ? extractions : []).forEach(addExtraction);
  if (!ordered.length) return preferred || null;
  const matchedPrimary = ordered.filter((item) => item.xiaohongshuPrimaryNoteMatched === true);
  const identityBound = matchedPrimary.length ? matchedPrimary : ordered;
  const selectedPreferred = matchedPrimary.length ? (preferred == null ? void 0 : preferred.xiaohongshuPrimaryNoteMatched) === true ? preferred : matchedPrimary[0] : preferred;
  const substantive = identityBound.filter((item) => !isXiaohongshuShareBoilerplateOnly(item));
  const sources = substantive.length ? substantive : identityBound;
  if (!matchedPrimary.length) {
    const normalizedTitles = sources.map((item) => String(item.title || "").trim());
    const sharedNonGenericTitle = sources.length > 1 && normalizedTitles.every(Boolean) && new Set(normalizedTitles).size === 1 && !isGenericXiaohongshuTitle(normalizedTitles[0]);
    const firstImages = new Set(Array.isArray((_a = sources[0]) == null ? void 0 : _a.imageUrls) ? sources[0].imageUrls : []);
    const sharedImage = sources.length > 1 && Array.from(firstImages).some((imageUrl) => sources.slice(1).every(
      (item) => Array.isArray(item.imageUrls) && item.imageUrls.includes(imageUrl)
    ));
    if (!sharedNonGenericTitle && !sharedImage) {
      return sources[0] || selectedPreferred || ordered[0];
    }
  }
  const isUsableTitle = /* @__PURE__ */ __name((value) => {
    const text = String(value || "").trim();
    return text && !/^(小红书笔记|小红书|发现精彩|登录后查看更多)$/i.test(text);
  }, "isUsableTitle");
  const descriptions = sources.map((item) => String(item.description || "").trim()).filter(Boolean);
  const title = String((sources.find((item) => isUsableTitle(item.title)) || {}).title || (selectedPreferred == null ? void 0 : selectedPreferred.title) || "小红书笔记").trim();
  const author = String((sources.find((item) => String(item.author || "").trim()) || {}).author || "").trim();
  const description = descriptions.sort((a, b) => b.length - a.length)[0] || String((selectedPreferred == null ? void 0 : selectedPreferred.description) || "").trim();
  const tags = [];
  const comments = [];
  const addUniqueText = /* @__PURE__ */ __name((target, value) => {
    const text = String(value || "").trim();
    if (text && !target.includes(text)) target.push(text);
  }, "addUniqueText");
  sources.forEach((item) => {
    (Array.isArray(item.tags) ? item.tags : []).forEach((tag) => addUniqueText(tags, tag));
    (Array.isArray(item.comments) ? item.comments : []).forEach((comment) => {
      const key = JSON.stringify(comment);
      if (!comments.some((existing) => JSON.stringify(existing) === key)) comments.push(comment);
    });
  });
  const preferredImageUrls = sources.includes(selectedPreferred) ? dedupeImageVariants(selectedPreferred.imageUrls || []) : [];
  let mergedImageUrls = preferredImageUrls;
  sources.forEach((item) => {
    const candidate = dedupeImageVariants(item.imageUrls || []);
    if (!candidate.length || candidate === mergedImageUrls) return;
    if (!mergedImageUrls.length) {
      mergedImageUrls = candidate;
      return;
    }
    const currentKeys = new Set(mergedImageUrls.map((imageUrl) => getImageVariantKey(imageUrl)));
    const sharesKnownImage = candidate.some(
      (imageUrl) => currentKeys.has(getImageVariantKey(imageUrl))
    );
    if (sharesKnownImage) {
      mergedImageUrls = dedupeImageVariants([...mergedImageUrls, ...candidate]);
    } else if (candidate.length > mergedImageUrls.length) {
      mergedImageUrls = candidate;
    }
  });
  const videoUrl = String((sources.find((item) => String(item.videoUrl || "").trim()) || {}).videoUrl || "").trim();
  const isVideoNote = sources.some((item) => item.isVideoNote === true);
  const socialMetrics = (sources.find((item) => hasSocialMetrics(item.socialMetrics)) || {}).socialMetrics || {};
  return {
    title,
    author,
    description,
    tags,
    imageUrls: mergedImageUrls,
    videoUrl,
    isVideoNote,
    comments,
    socialMetrics,
    xiaohongshuTargetNoteIdPresent: sources.some((item) => item.xiaohongshuTargetNoteIdPresent === true),
    xiaohongshuPrimaryNoteMatched: matchedPrimary.length > 0,
    xiaohongshuStructuredIdentityMismatch: matchedPrimary.length === 0 && sources.some((item) => item.xiaohongshuStructuredIdentityMismatch === true),
    markdown: buildXiaohongshuMarkdown({
      title,
      description,
      tags,
      imageUrls: mergedImageUrls,
      videoUrl,
      comments
    })
  };
}
__name(mergeXiaohongshuExtractions, "mergeXiaohongshuExtractions");
function normalizeOcrText(text) {
  return String(text || "").replace(/\r\n?/g, "\n").split("\n").map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n").trim();
}
__name(normalizeOcrText, "normalizeOcrText");
function countReadableOcrChars(text) {
  return (String(text || "").replace(/\s+/g, "").match(/[\u3400-\u9fffA-Za-z0-9]/g) || []).length;
}
__name(countReadableOcrChars, "countReadableOcrChars");
var XIAOHONGSHU_OCR_TEXT_DOMINANCE_THRESHOLDS = Object.freeze({
  trustedBoxConfidence: 0.55,
  averageConfidence: 0.65,
  longTextReadableChars: 80,
  longTextLines: 5,
  longTextVerticalSpanRatio: 0.35,
  longTextCoveredRowRatio: 0.12,
  largeCardReadableChars: 35,
  largeCardLines: 3,
  largeCardTextBoxAreaRatio: 0.12,
  largeCardVerticalSpanRatio: 0.25,
  geometryFallbackReadableChars: 160,
  geometryFallbackLines: 6,
  maxBoundaryOverlapLines: 8
});
var LOCAL_OCR_BATCH_RUNNER_SOURCE = String.raw`#!/usr/bin/env python3
import argparse
import json
import math
import re

SCHEMA_VERSION = 1
RUNNER_VERSION = ${JSON.stringify(LOCAL_OCR_BATCH_RUNNER_VERSION)}
TRUSTED_BOX_CONFIDENCE = ${XIAOHONGSHU_OCR_TEXT_DOMINANCE_THRESHOLDS.trustedBoxConfidence}
MAX_IMAGE_DIMENSION = 32768
MAX_IMAGE_PIXELS = 40000000
READABLE_CHARACTER_PATTERN = re.compile(r"[\u3400-\u9fffA-Za-z0-9]")
SAFE_ITEM_ID_PATTERN = re.compile(r"^[A-Za-z0-9_-]{1,80}$")


class ImageDimensionsExceededError(Exception):
    pass


def readable_character_count(value):
    return len(READABLE_CHARACTER_PATTERN.findall(str(value or "")))


def safe_item_id(value, fallback):
    candidate = str(value or "").strip()
    return candidate if SAFE_ITEM_ID_PATTERN.fullmatch(candidate) else fallback


def safe_positive_index(value, fallback):
    try:
        number = float(value)
        if not math.isfinite(number):
            return fallback
        integer = math.floor(number)
        return integer if integer > 0 else fallback
    except (TypeError, ValueError, OverflowError):
        return fallback


def validate_image_dimensions(width, height):
    width = int(width)
    height = int(height)
    if (
        width <= 0
        or height <= 0
        or width > MAX_IMAGE_DIMENSION
        or height > MAX_IMAGE_DIMENSION
        or (width * height) > MAX_IMAGE_PIXELS
    ):
        raise ImageDimensionsExceededError()
    return width, height


def to_plain_value(value):
    if hasattr(value, "tolist"):
        return value.tolist()
    return value


def is_ocr_row(value):
    value = to_plain_value(value)
    if not isinstance(value, (list, tuple)) or len(value) < 3:
        return False
    try:
        score = float(value[2])
    except (TypeError, ValueError, OverflowError):
        return False
    return math.isfinite(score) and not isinstance(value[1], (list, tuple, dict))


def is_ocr_row_collection(value):
    value = to_plain_value(value)
    return (
        isinstance(value, (list, tuple))
        and all(is_ocr_row(row) for row in value)
    )


def is_result_metadata(value):
    return value is None or isinstance(value, (int, float, list, tuple, dict))


def result_rows(raw_result):
    value = raw_result
    if (
        isinstance(value, (list, tuple))
        and len(value) == 2
        and is_ocr_row_collection(value[0])
        and is_result_metadata(value[1])
    ):
        value = value[0]
    if value is None:
        return []

    boxes = None
    texts = None
    scores = None
    if isinstance(value, dict):
        boxes = value.get("boxes")
        texts = value.get("txts")
        if texts is None:
            texts = value.get("texts")
        scores = value.get("scores")
    else:
        boxes = getattr(value, "boxes", None)
        texts = getattr(value, "txts", None)
        if texts is None:
            texts = getattr(value, "texts", None)
        scores = getattr(value, "scores", None)

    if boxes is not None and texts is not None and scores is not None:
        return list(zip(list(boxes), list(texts), list(scores)))
    if is_ocr_row(value):
        return [value]
    if is_ocr_row_collection(value):
        return list(value)
    return []


def clipped_box_geometry(box, image_width, image_height):
    value = to_plain_value(box)
    if not isinstance(value, (list, tuple)):
        return 0.0, None, []

    points = []
    if len(value) == 4 and all(isinstance(item, (int, float)) for item in value):
        left, top, right, bottom = [float(item) for item in value]
        points = [(left, top), (right, top), (right, bottom), (left, bottom)]
    else:
        for point in value:
            point = to_plain_value(point)
            if not isinstance(point, (list, tuple)) or len(point) < 2:
                continue
            try:
                x_value = float(point[0])
                y_value = float(point[1])
            except (TypeError, ValueError, OverflowError):
                continue
            if math.isfinite(x_value) and math.isfinite(y_value):
                points.append((x_value, y_value))

    if len(points) < 3:
        return 0.0, None, []

    clipped = [
        (
            min(float(image_width), max(0.0, x_value)),
            min(float(image_height), max(0.0, y_value)),
        )
        for x_value, y_value in points
    ]
    area_twice = 0.0
    for point_index, (x_value, y_value) in enumerate(clipped):
        next_x, next_y = clipped[(point_index + 1) % len(clipped)]
        area_twice += (x_value * next_y) - (next_x * y_value)
    area = abs(area_twice) / 2.0
    top = min(point[1] for point in clipped)
    bottom = max(point[1] for point in clipped)
    return area, (top, bottom), clipped


def merged_interval_length(intervals):
    if not intervals:
        return 0.0
    ordered = sorted(intervals, key=lambda interval: (interval[0], interval[1]))
    merged_length = 0.0
    current_start, current_end = ordered[0]
    for next_start, next_end in ordered[1:]:
        if next_start <= current_end:
            current_end = max(current_end, next_end)
            continue
        merged_length += max(0.0, current_end - current_start)
        current_start, current_end = next_start, next_end
    return merged_length + max(0.0, current_end - current_start)


def classify_item_error(error):
    error_name = type(error).__name__.lower()
    if isinstance(error, ImageDimensionsExceededError):
        return "image_dimensions_exceeded"
    if "unidentifiedimage" in error_name or "decompression" in error_name:
        return "image_decode_error"
    if isinstance(error, (FileNotFoundError, IsADirectoryError, PermissionError, OSError)):
        return "image_read_error"
    return "ocr_item_error"


def process_image(engine, image_module, item, source_order):
    fallback_id = "image-" + str(source_order + 1)
    item_id = safe_item_id(item.get("id"), fallback_id)
    item_index = safe_positive_index(item.get("index"), source_order + 1)
    try:
        image_path = item.get("input")
        if not isinstance(image_path, str) or not image_path:
            image_path = item.get("path")
        if not isinstance(image_path, str) or not image_path:
            raise ValueError("image_path_missing")
        with image_module.open(image_path) as image:
            image_width, image_height = image.size
        image_width, image_height = validate_image_dimensions(image_width, image_height)

        structured_lines = []
        trusted_scores = []
        trusted_area = 0.0
        vertical_intervals = []
        for row in result_rows(engine(image_path)):
            row = to_plain_value(row)
            if not isinstance(row, (list, tuple)) or len(row) < 3:
                continue
            box, text, raw_score = row[0], row[1], row[2]
            try:
                score = float(raw_score)
            except (TypeError, ValueError, OverflowError):
                continue
            normalized_text = re.sub(r"\s+", " ", str(text or "")).strip()
            if (
                not math.isfinite(score)
                or score < TRUSTED_BOX_CONFIDENCE
                or readable_character_count(normalized_text) < 2
            ):
                continue
            area, vertical_interval, clipped_box = clipped_box_geometry(
                box,
                image_width,
                image_height,
            )
            normalized_score = min(1.0, max(0.0, score))
            has_line_geometry = (
                vertical_interval is not None
                and len(clipped_box) >= 3
                and math.isfinite(area)
                and area > 0.0
                and vertical_interval[1] > vertical_interval[0]
            )
            structured_lines.append({
                "text": normalized_text,
                "score": normalized_score,
                "box": clipped_box if has_line_geometry else None,
            })
            trusted_scores.append(normalized_score)
            if has_line_geometry:
                trusted_area += max(0.0, area)
                vertical_intervals.append(vertical_interval)

        image_area = float(image_width * image_height)
        covered_height = merged_interval_length(vertical_intervals)
        vertical_span = (
            max(interval[1] for interval in vertical_intervals)
            - min(interval[0] for interval in vertical_intervals)
            if vertical_intervals
            else 0.0
        )
        line_texts = [line["text"] for line in structured_lines]
        geometry_available = bool(vertical_intervals)
        metrics = {
            "readableChars": sum(readable_character_count(line) for line in line_texts),
            "lineCount": len(structured_lines),
            "averageConfidence": (
                sum(trusted_scores) / len(trusted_scores) if trusted_scores else 0.0
            ),
            "textBoxAreaRatio": (
                min(1.0, max(0.0, trusted_area / image_area))
                if geometry_available else None
            ),
            "coveredRowRatio": (
                min(1.0, max(0.0, covered_height / float(image_height)))
                if geometry_available else None
            ),
            "verticalSpanRatio": (
                min(1.0, max(0.0, vertical_span / float(image_height)))
                if geometry_available else None
            ),
        }
        return {
            "id": item_id,
            "status": "ok",
            "index": item_index,
            "width": image_width,
            "height": image_height,
            "text": "\n".join(line_texts),
            "lines": structured_lines,
            "metrics": metrics,
        }
    except Exception as error:
        return {
            "id": item_id,
            "status": "error",
            "index": item_index,
            "errorType": classify_item_error(error),
        }


def read_manifest(manifest_path):
    with open(manifest_path, "r", encoding="utf-8") as manifest_file:
        manifest = json.load(manifest_file)
    if not isinstance(manifest, dict) or manifest.get("schemaVersion") != SCHEMA_VERSION:
        raise RuntimeError("batch_manifest_schema_invalid")
    items = manifest.get("items")
    if not isinstance(items, list):
        raise RuntimeError("batch_manifest_items_invalid")
    return items


def load_ocr_runtime():
    from PIL import Image
    try:
        from rapidocr_onnxruntime import RapidOCR
    except ImportError:
        from rapidocr import RapidOCR
    return Image, RapidOCR


def run_result_rows_self_test():
    box_one = [[0, 0], [100, 0], [100, 20], [0, 20]]
    box_two = [[0, 30], [100, 30], [100, 50], [0, 50]]
    rows = [
        [box_one, "真实元数据第一行", 0.98],
        [box_two, "真实元数据第二行", 0.97],
    ]
    parsed_rows = result_rows((rows, [["det", 0.01], ["rec", 0.02]]))
    single_row = (box_one, "单行元组不能误判", 0.96)
    parsed_single_row = result_rows(single_row)
    blank_tuple_rows = result_rows((None, ["metadata"]))
    empty_tuple_rows = result_rows(([], ["metadata"]))

    class ObjectResult:
        boxes = [box_one, box_two]
        txts = ["对象结果第一行", "对象结果第二行"]
        scores = [0.95, 0.94]

    object_rows = result_rows(ObjectResult())
    if (
        parsed_rows != rows
        or parsed_single_row != [single_row]
        or blank_tuple_rows
        or empty_tuple_rows
        or [row[1] for row in object_rows] != ObjectResult.txts
    ):
        raise RuntimeError("result_rows_self_test_failed")

    engine_calls = []

    class FakeImage:
        size = (MAX_IMAGE_DIMENSION + 1, 100)

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc_value, traceback):
            return False

    class FakeImageModule:
        @staticmethod
        def open(_image_path):
            return FakeImage()

    def fake_engine(_image_path):
        engine_calls.append(1)
        return rows

    oversized_result = process_image(
        fake_engine,
        FakeImageModule,
        {"id": "image-1", "index": 1, "input": "synthetic-image"},
        0,
    )
    if (
        oversized_result.get("errorType") != "image_dimensions_exceeded"
        or engine_calls
    ):
        raise RuntimeError("image_dimension_self_test_failed")

    print(json.dumps({
        "tupleTexts": [row[1] for row in parsed_rows],
        "singleTupleText": parsed_single_row[0][1],
        "blankTupleRows": len(blank_tuple_rows),
        "emptyTupleRows": len(empty_tuple_rows),
        "objectTexts": [row[1] for row in object_rows],
        "oversizedErrorType": oversized_result.get("errorType"),
        "oversizedEngineCalls": len(engine_calls),
    }))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--batch-manifest")
    parser.add_argument("--output")
    parser.add_argument("--self-test-result-rows", action="store_true")
    arguments = parser.parse_args()
    if arguments.self_test_result_rows:
        run_result_rows_self_test()
        return
    if not arguments.batch_manifest or not arguments.output:
        parser.error("--batch-manifest and --output are required")

    manifest_items = read_manifest(arguments.batch_manifest)
    try:
        image_module, rapid_ocr_class = load_ocr_runtime()
        engine = rapid_ocr_class()
    except Exception:
        raise RuntimeError("ocr_engine_init_failed") from None

    output_items = []
    for source_order, item in enumerate(manifest_items):
        if not isinstance(item, dict):
            output_items.append({
                "id": "image-" + str(source_order + 1),
                "status": "error",
                "index": source_order + 1,
                "errorType": "manifest_item_invalid",
            })
            continue
        output_items.append(process_image(engine, image_module, item, source_order))

    with open(arguments.output, "w", encoding="utf-8") as output_file:
        json.dump({
            "schemaVersion": SCHEMA_VERSION,
            "runnerVersion": RUNNER_VERSION,
            "processed": len(output_items),
            "items": output_items,
        }, output_file, ensure_ascii=False)


if __name__ == "__main__":
    main()
`;
function createLocalOcrBatchError(category = "process") {
  const messages = {
    not_ready: "本地 OCR 组件未就绪，请先在插件设置中修复本地转写组件。",
    timeout: "图片文字 OCR 批量识别超时，请稍后重试。",
    process: "图片文字 OCR 批量识别进程失败，请稍后重试。",
    schema: "图片文字 OCR 批量识别结果格式无效。",
    io: "图片文字 OCR 批量识别临时文件处理失败。"
  };
  const normalizedCategory = Object.prototype.hasOwnProperty.call(messages, category) ? category : "process";
  const error = new Error(messages[normalizedCategory]);
  error.code = `LOCAL_OCR_BATCH_${normalizedCategory.toUpperCase()}`;
  return error;
}
__name(createLocalOcrBatchError, "createLocalOcrBatchError");
function createLocalOcrBatchAllItemsFailedError(items = []) {
  const allowedErrorTypes = [
    "image_decode_error",
    "image_read_error",
    "image_dimensions_exceeded",
    "manifest_item_invalid",
    "ocr_item_error"
  ];
  const counts = Object.fromEntries(allowedErrorTypes.map((errorType) => [errorType, 0]));
  (Array.isArray(items) ? items : []).forEach((item) => {
    const errorType = String(item && item.errorType || "").trim().toLowerCase();
    const safeErrorType = allowedErrorTypes.includes(errorType) ? errorType : "ocr_item_error";
    counts[safeErrorType] += 1;
  });
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const summary = allowedErrorTypes.filter((errorType) => counts[errorType] > 0).map((errorType) => `${errorType}=${counts[errorType]}`).join("; ");
  const error = new Error(`所有图片识别均失败（total=${total}; ${summary}）`);
  error.code = "LOCAL_OCR_BATCH_ALL_ITEMS_FAILED";
  error.total = total;
  error.errorTypeCounts = Object.freeze(Object.fromEntries(
    allowedErrorTypes.filter((errorType) => counts[errorType] > 0).map((errorType) => [errorType, counts[errorType]])
  ));
  return error;
}
__name(createLocalOcrBatchAllItemsFailedError, "createLocalOcrBatchAllItemsFailedError");
function normalizeLocalOcrBatchResultItems(payload) {
  if (!payload || typeof payload !== "object" || payload.schemaVersion !== 1 || payload.runnerVersion !== LOCAL_OCR_BATCH_RUNNER_VERSION || !Array.isArray(payload.items) || !Number.isInteger(payload.processed) || payload.processed < 0 || payload.processed !== payload.items.length) {
    throw createLocalOcrBatchError("schema");
  }
  return payload.items.map((item) => {
    if (!item || typeof item !== "object" || !["ok", "error"].includes(item.status)) {
      throw createLocalOcrBatchError("schema");
    }
    const rawId = String(item.id || "").trim();
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(rawId) || !Number.isInteger(item.index) || item.index <= 0) {
      throw createLocalOcrBatchError("schema");
    }
    const id = rawId;
    const index = item.index;
    if (item.status === "error") {
      const rawErrorType = String(item.errorType || "ocr_item_error").trim().toLowerCase();
      return {
        id,
        index,
        status: "error",
        errorType: /^[a-z0-9_-]{1,80}$/.test(rawErrorType) ? rawErrorType : "ocr_item_error"
      };
    }
    if (!Number.isInteger(item.width) || item.width <= 0 || !Number.isInteger(item.height) || item.height <= 0 || typeof item.text !== "string" || !Array.isArray(item.lines) || !item.metrics || typeof item.metrics !== "object") {
      throw createLocalOcrBatchError("schema");
    }
    const lines = item.lines.map((line) => {
      if (!line || typeof line !== "object" || typeof line.text !== "string" || !line.text.trim() || line.text !== line.text.trim() || typeof line.score !== "number" || !Number.isFinite(line.score) || line.score < 0 || line.score > 1) {
        throw createLocalOcrBatchError("schema");
      }
      let box = null;
      if (line.box !== null) {
        if (!Array.isArray(line.box) || line.box.length < 3) {
          throw createLocalOcrBatchError("schema");
        }
        box = line.box.map((point) => {
          if (!Array.isArray(point) || point.length < 2 || typeof point[0] !== "number" || !Number.isFinite(point[0]) || typeof point[1] !== "number" || !Number.isFinite(point[1]) || point[0] < 0 || point[0] > item.width || point[1] < 0 || point[1] > item.height) {
            throw createLocalOcrBatchError("schema");
          }
          return [point[0], point[1]];
        });
      }
      return {
        text: line.text,
        score: line.score,
        box
      };
    });
    const text = lines.map((line) => line.text).join("\n");
    if (item.text !== text) throw createLocalOcrBatchError("schema");
    const readableChars = item.metrics.readableChars;
    const lineCount = item.metrics.lineCount;
    const averageConfidence = item.metrics.averageConfidence;
    if (!Number.isInteger(readableChars) || readableChars < 0 || !Number.isInteger(lineCount) || lineCount < 0 || lineCount !== lines.length || typeof averageConfidence !== "number" || !Number.isFinite(averageConfidence) || averageConfidence < 0 || averageConfidence > 1) {
      throw createLocalOcrBatchError("schema");
    }
    const geometryMetricKeys = [
      "textBoxAreaRatio",
      "coveredRowRatio",
      "verticalSpanRatio"
    ];
    const geometryMetrics = {};
    geometryMetricKeys.forEach((key) => {
      const value = item.metrics[key];
      if (value !== null && (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)) {
        throw createLocalOcrBatchError("schema");
      }
      geometryMetrics[key] = value;
    });
    const hasLineGeometry = lines.some((line) => line.box !== null);
    const geometryValueCount = geometryMetricKeys.filter((key) => geometryMetrics[key] !== null).length;
    if (hasLineGeometry && geometryValueCount !== geometryMetricKeys.length || !hasLineGeometry && geometryValueCount !== 0) {
      throw createLocalOcrBatchError("schema");
    }
    const metrics = {
      readableChars,
      lineCount,
      averageConfidence,
      ...geometryMetrics
    };
    return {
      id,
      index,
      status: "ok",
      width: item.width,
      height: item.height,
      text,
      lines,
      metrics
    };
  });
}
__name(normalizeLocalOcrBatchResultItems, "normalizeLocalOcrBatchResultItems");
function bindLocalOcrBatchResultItems(payload, manifestItems = []) {
  const items = normalizeLocalOcrBatchResultItems(payload);
  if (!Array.isArray(manifestItems) || items.length !== manifestItems.length) {
    throw createLocalOcrBatchError("schema");
  }
  const manifestIds = /* @__PURE__ */ new Set();
  const resultIds = /* @__PURE__ */ new Set();
  items.forEach((item, position) => {
    const manifestItem = manifestItems[position];
    if (!manifestItem || manifestIds.has(manifestItem.id) || resultIds.has(item.id) || item.id !== manifestItem.id || item.index !== manifestItem.index) {
      throw createLocalOcrBatchError("schema");
    }
    manifestIds.add(manifestItem.id);
    resultIds.add(item.id);
  });
  return items;
}
__name(bindLocalOcrBatchResultItems, "bindLocalOcrBatchResultItems");
function getSafeXiaohongshuOcrError(error) {
  const code = String(error && error.code || "");
  if (code === "LOCAL_OCR_BATCH_TIMEOUT") return "图片文字 OCR 批量识别超时，请稍后重试。";
  if (code === "LOCAL_OCR_BATCH_NOT_READY") return "图片文字 OCR 组件未就绪，请在插件设置中修复。";
  if (code === "LOCAL_OCR_BATCH_ALL_ITEMS_FAILED") {
    return "所有图片识别均失败，原始图文内容已保留。";
  }
  return "图片文字 OCR 批量识别失败，原始图文内容已保留。";
}
__name(getSafeXiaohongshuOcrError, "getSafeXiaohongshuOcrError");
function normalizeFiniteOcrMetric(value, fallback, {
  integer = false,
  ratio = false
} = {}) {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : Number.NaN;
  if (!Number.isFinite(number) || number < 0 || ratio && number > 1) return fallback;
  return integer ? Math.floor(number) : number;
}
__name(normalizeFiniteOcrMetric, "normalizeFiniteOcrMetric");
function splitNormalizedOcrLines(text) {
  const normalized = normalizeOcrText(text);
  return normalized ? normalized.split("\n") : [];
}
__name(splitNormalizedOcrLines, "splitNormalizedOcrLines");
function normalizeOptionalOcrRatio(value) {
  const missing = value === void 0 || value === null || typeof value === "string" && !value.trim();
  return missing ? null : normalizeFiniteOcrMetric(value, 0, { ratio: true });
}
__name(normalizeOptionalOcrRatio, "normalizeOptionalOcrRatio");
function normalizeXiaohongshuOcrMetrics(metrics = {}, text = "") {
  const source = metrics && typeof metrics === "object" ? metrics : {};
  const lines = splitNormalizedOcrLines(text);
  return {
    readableChars: normalizeFiniteOcrMetric(
      source.readableChars,
      countReadableOcrChars(text),
      { integer: true }
    ),
    lineCount: normalizeFiniteOcrMetric(source.lineCount, lines.length, { integer: true }),
    averageConfidence: normalizeOptionalOcrRatio(source.averageConfidence),
    textBoxAreaRatio: normalizeOptionalOcrRatio(source.textBoxAreaRatio),
    coveredRowRatio: normalizeOptionalOcrRatio(source.coveredRowRatio),
    verticalSpanRatio: normalizeOptionalOcrRatio(source.verticalSpanRatio)
  };
}
__name(normalizeXiaohongshuOcrMetrics, "normalizeXiaohongshuOcrMetrics");
function isXiaohongshuTextDominantOcrItem(item = {}) {
  if (!item || typeof item !== "object") return false;
  const text = normalizeOcrText(item.text || item.ocrText || item.value);
  if (!text) return false;
  const metrics = normalizeXiaohongshuOcrMetrics(item.metrics, text);
  const thresholds = XIAOHONGSHU_OCR_TEXT_DOMINANCE_THRESHOLDS;
  const geometry = [
    metrics.textBoxAreaRatio,
    metrics.coveredRowRatio,
    metrics.verticalSpanRatio
  ];
  const hasGeometry = geometry.some((value) => Number.isFinite(value));
  const hasTrustedAverageConfidence = Number.isFinite(metrics.averageConfidence) && metrics.averageConfidence >= thresholds.averageConfidence;
  if (!hasGeometry) {
    return (metrics.averageConfidence === null || hasTrustedAverageConfidence) && metrics.readableChars >= thresholds.geometryFallbackReadableChars && metrics.lineCount >= thresholds.geometryFallbackLines;
  }
  if (!hasTrustedAverageConfidence) return false;
  const isLongText = metrics.readableChars >= thresholds.longTextReadableChars && metrics.lineCount >= thresholds.longTextLines && metrics.verticalSpanRatio >= thresholds.longTextVerticalSpanRatio && metrics.coveredRowRatio >= thresholds.longTextCoveredRowRatio;
  const isLargeCard = metrics.readableChars >= thresholds.largeCardReadableChars && metrics.lineCount >= thresholds.largeCardLines && metrics.textBoxAreaRatio >= thresholds.largeCardTextBoxAreaRatio && metrics.verticalSpanRatio >= thresholds.largeCardVerticalSpanRatio;
  return isLongText || isLargeCard;
}
__name(isXiaohongshuTextDominantOcrItem, "isXiaohongshuTextDominantOcrItem");
function normalizeXiaohongshuOcrItems(items = []) {
  return (Array.isArray(items) ? items : []).map((item, sourceOrder) => {
    const text = normalizeOcrText(item && (item.text || item.ocrText || item.value));
    const metrics = normalizeXiaohongshuOcrMetrics(item && item.metrics, text);
    const rawIndex = Number(item && item.index);
    const integerIndex = Number.isFinite(rawIndex) ? Math.floor(rawIndex) : 0;
    const index = integerIndex > 0 ? integerIndex : sourceOrder + 1;
    return {
      imageUrl: String(item && (item.imageUrl || item.url) || "").trim(),
      text,
      index,
      readableChars: metrics.readableChars,
      substantial: metrics.readableChars >= XIAOHONGSHU_OCR_TEXT_DOMINANCE_THRESHOLDS.longTextReadableChars,
      metrics,
      sourceOrder
    };
  }).filter((item) => isXiaohongshuTextDominantOcrItem(item)).sort((left, right) => left.index - right.index || left.sourceOrder - right.sourceOrder).map(({ sourceOrder, ...item }) => item);
}
__name(normalizeXiaohongshuOcrItems, "normalizeXiaohongshuOcrItems");
function isLikelyImageTextNote(items = []) {
  return normalizeXiaohongshuOcrItems(items).length > 0;
}
__name(isLikelyImageTextNote, "isLikelyImageTextNote");
function getNormalizedOcrLineKey(line) {
  return String(line || "").replace(/\s+/g, " ").trim().toLowerCase();
}
__name(getNormalizedOcrLineKey, "getNormalizedOcrLineKey");
function getXiaohongshuOcrLineBoundarySeparator(previousText, nextLine) {
  const previous = String(previousText || "");
  const next = String(nextLine || "");
  if (!previous || !next || /\s$/.test(previous) || !/^[A-Za-z0-9]/.test(next)) {
    return "";
  }
  return /[A-Za-z0-9,.!?:;'"%)\]}]$/.test(previous) ? " " : "";
}
__name(getXiaohongshuOcrLineBoundarySeparator, "getXiaohongshuOcrLineBoundarySeparator");
function mergeXiaohongshuOcrText(items = [], maxOverlapLines = 8) {
  const normalized = normalizeXiaohongshuOcrItems(items);
  const configuredLimit = normalizeFiniteOcrMetric(maxOverlapLines, 8, { integer: true });
  const overlapLimit = Math.min(
    configuredLimit,
    XIAOHONGSHU_OCR_TEXT_DOMINANCE_THRESHOLDS.maxBoundaryOverlapLines
  );
  const mergedLines = [];
  normalized.forEach((item) => {
    const pageLines = splitNormalizedOcrLines(item.text);
    const maximumOverlap = Math.min(overlapLimit, mergedLines.length, pageLines.length);
    let overlap = 0;
    for (let length = maximumOverlap; length > 0; length -= 1) {
      const previousKeys = mergedLines.slice(-length).map(getNormalizedOcrLineKey);
      const nextKeys = pageLines.slice(0, length).map(getNormalizedOcrLineKey);
      if (previousKeys.every((key, index) => key && key === nextKeys[index])) {
        overlap = length;
        break;
      }
    }
    mergedLines.push(...pageLines.slice(overlap));
  });
  return mergedLines.reduce((text, line) => {
    if (!text) return line;
    return `${text}${getXiaohongshuOcrLineBoundarySeparator(text, line)}${line}`;
  }, "");
}
__name(mergeXiaohongshuOcrText, "mergeXiaohongshuOcrText");
function buildXiaohongshuOcrMarkdown(items = []) {
  const text = mergeXiaohongshuOcrText(items);
  return text ? `## 图片文字

${text}` : "";
}
__name(buildXiaohongshuOcrMarkdown, "buildXiaohongshuOcrMarkdown");
function appendXiaohongshuOcrMarkdown(markdown, items = []) {
  const ocrMarkdown = buildXiaohongshuOcrMarkdown(items);
  if (!ocrMarkdown) return String(markdown || "").trim();
  const source = String(markdown || "").trim();
  return `${source}

${ocrMarkdown}`.trim();
}
__name(appendXiaohongshuOcrMarkdown, "appendXiaohongshuOcrMarkdown");
function extractSocialVideoMarkdownFromHtml(html, url, platform = "视频") {
  url = cleanDisplayUrl(url);
  const source = String(html || "");
  const title = extractMetaContent(source, ["og:title", "twitter:title"]) || extractHtmlTitle(source) || `${platform}视频`;
  const description = cleanSocialDescription(
    extractMetaContent(source, ["description", "og:description", "twitter:description"]) || stripHtmlTags(selectReadableHtml(source))
  );
  const tags = extractTagsFromText(description, source);
  const videoUrl = extractVideoUrlFromHtml(source);
  const lines = [
    "## 标题",
    "",
    title,
    "",
    "## 视频文案",
    "",
    description || "页面未直接暴露视频文案，原始链接已写入笔记属性。",
    ""
  ];
  if (tags.length) {
    lines.push("## 标签", "", ...tags.map((tag) => `- ${tag}`), "");
  }
  if (videoUrl) {
    lines.push("## 视频源", "", `[视频文件](${videoUrl})`, "");
  }
  return {
    title,
    description,
    tags,
    platform,
    markdown: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    videoUrl
  };
}
__name(extractSocialVideoMarkdownFromHtml, "extractSocialVideoMarkdownFromHtml");
var WECHAT_CHANNELS_MEDIA_URL_KEYS = [
  "videoUrl",
  "video_url",
  "mediaUrl",
  "media_url",
  "downloadUrl",
  "download_url",
  "fileUrl",
  "file_url",
  "url"
];
var WECHAT_CHANNELS_MEDIA_URL_TOKEN_KEYS = [
  "urlToken",
  "url_token",
  "token"
];
var WECHAT_CHANNELS_DECODE_KEY_KEYS = [
  "decodeKey",
  "decode_key",
  "decodekey",
  "decryptKey",
  "decrypt_key",
  "decryptkey"
];
var WECHAT_CHANNELS_COVER_URL_KEYS = [
  "coverUrl",
  "cover_url",
  "thumbUrl",
  "thumb_url",
  "fullThumbUrl",
  "full_thumb_url",
  "poster",
  "posterUrl"
];
var WECHAT_CHANNELS_MEDIA_CONTAINER_KEYS = [
  "object",
  "object_desc",
  "objectDesc",
  "objectList",
  "object_list",
  "media",
  "mediaList",
  "media_list",
  "h264VideoInfo",
  "h264_video_info",
  "h265VideoInfo",
  "h265_video_info",
  "videoInfo",
  "video_info",
  "objectDesc",
  "object_desc",
  "feedInfo",
  "feed_info",
  "data"
];
function isWechatChannelsPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}
__name(isWechatChannelsPlainObject, "isWechatChannelsPlainObject");
function readWechatChannelsString(object, keys) {
  if (!isWechatChannelsPlainObject(object)) return "";
  for (const key of keys) {
    const value = object[key];
    if (value !== void 0 && value !== null && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}
__name(readWechatChannelsString, "readWechatChannelsString");
function isWechatChannelsImageUrl(url) {
  return /\.(?:jpg|jpeg|png|webp|gif|svg)(?:[?#]|$)/i.test(String(url || ""));
}
__name(isWechatChannelsImageUrl, "isWechatChannelsImageUrl");
function isLikelyWechatChannelsMediaUrl(url) {
  const value = normalizeExtractedUrl(url);
  if (!/^https?:\/\//i.test(value) || isWechatChannelsImageUrl(value)) return false;
  return /finder\.video\.qq\.com|mpvideo|video|media|\.mp4|\.m4s|\.m3u8|mime_type=video/i.test(value);
}
__name(isLikelyWechatChannelsMediaUrl, "isLikelyWechatChannelsMediaUrl");
function appendWechatChannelsUrlToken(url, token) {
  const baseUrl = normalizeExtractedUrl(url);
  const normalizedToken = decodeHtmlEntities(String(token || "").trim());
  if (!baseUrl || !normalizedToken) return baseUrl;
  if (/^https?:\/\//i.test(normalizedToken)) return normalizeExtractedUrl(normalizedToken);
  if (baseUrl.includes(normalizedToken)) return baseUrl;
  if (/^[?&]/.test(normalizedToken)) return `${baseUrl}${normalizedToken}`;
  return `${baseUrl}${baseUrl.includes("?") ? "&" : "?"}${normalizedToken.replace(/^[?&]/, "")}`;
}
__name(appendWechatChannelsUrlToken, "appendWechatChannelsUrlToken");
function pushWechatChannelsMediaCandidate(candidates, object, forceMediaObject = false) {
  if (!isWechatChannelsPlainObject(object)) return;
  const url = appendWechatChannelsUrlToken(
    readWechatChannelsString(object, WECHAT_CHANNELS_MEDIA_URL_KEYS),
    readWechatChannelsString(object, WECHAT_CHANNELS_MEDIA_URL_TOKEN_KEYS)
  );
  if (!/^https?:\/\//i.test(url) || isWechatChannelsImageUrl(url)) return;
  if (!forceMediaObject && !isLikelyWechatChannelsMediaUrl(url)) return;
  const decodeKey = readWechatChannelsString(object, WECHAT_CHANNELS_DECODE_KEY_KEYS);
  const coverUrl = normalizeExtractedUrl(readWechatChannelsString(object, WECHAT_CHANNELS_COVER_URL_KEYS));
  const durationValue = Number(object.videoPlayLen || object.duration || object.durationSeconds || object.duration_seconds || 0);
  const fileSizeValue = Number(object.fileSize || object.file_size || object.size || 0);
  const resolution = readWechatChannelsString(object, ["videoResolution", "video_resolution", "resolution"]);
  if (!candidates.some((candidate) => candidate.url === url)) {
    candidates.push({
      url,
      decodeKey,
      decryptKey: decodeKey,
      coverUrl,
      durationSeconds: Number.isFinite(durationValue) && durationValue > 0 ? durationValue : 0,
      fileSize: Number.isFinite(fileSizeValue) && fileSizeValue > 0 ? fileSizeValue : 0,
      resolution
    });
  }
}
__name(pushWechatChannelsMediaCandidate, "pushWechatChannelsMediaCandidate");
function collectWechatChannelsMediaCandidates(value, candidates = [], seen = /* @__PURE__ */ new Set(), forceMediaObject = false) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectWechatChannelsMediaCandidates(item, candidates, seen, forceMediaObject));
    return candidates;
  }
  if (!isWechatChannelsPlainObject(value) || seen.has(value)) return candidates;
  seen.add(value);
  pushWechatChannelsMediaCandidate(candidates, value, forceMediaObject);
  for (const key of WECHAT_CHANNELS_MEDIA_CONTAINER_KEYS) {
    if (value[key] !== void 0 && value[key] !== null) {
      const childIsMediaObject = forceMediaObject || key.toLowerCase().includes("media") || key.toLowerCase().includes("video");
      collectWechatChannelsMediaCandidates(value[key], candidates, seen, childIsMediaObject);
    }
  }
  return candidates;
}
__name(collectWechatChannelsMediaCandidates, "collectWechatChannelsMediaCandidates");
function getWechatChannelsMediaCandidates(feedInfo) {
  return collectWechatChannelsMediaCandidates(feedInfo);
}
__name(getWechatChannelsMediaCandidates, "getWechatChannelsMediaCandidates");
function getWechatChannelsVideoUrl(feedInfo) {
  const firstMedia = getWechatChannelsMediaCandidates(feedInfo)[0] || {};
  return firstMedia.url || "";
}
__name(getWechatChannelsVideoUrl, "getWechatChannelsVideoUrl");
function buildWechatChannelsTitle(description, fallback = "视频号文案") {
  const firstLine = String(description || "").replace(/#[\p{L}\p{N}_-]{1,32}/gu, "").split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";
  return sanitizeNoteTitlePart(truncateByChars(firstLine, 32), fallback);
}
__name(buildWechatChannelsTitle, "buildWechatChannelsTitle");
function normalizeWechatChannelsFeedPayload(payload) {
  const root = payload && typeof payload === "object" ? payload : {};
  const data = root.data && typeof root.data === "object" ? root.data : {};
  const objectInfo = data.object && typeof data.object === "object" ? data.object : data.object_info && typeof data.object_info === "object" ? data.object_info : {};
  const feedInfo = data.feedInfo && typeof data.feedInfo === "object" ? data.feedInfo : data.feed_info && typeof data.feed_info === "object" ? data.feed_info : {};
  const objectDesc = data.object_desc && typeof data.object_desc === "object" ? data.object_desc : data.objectDesc && typeof data.objectDesc === "object" ? data.objectDesc : objectInfo.object_desc && typeof objectInfo.object_desc === "object" ? objectInfo.object_desc : objectInfo.objectDesc && typeof objectInfo.objectDesc === "object" ? objectInfo.objectDesc : feedInfo.object_desc && typeof feedInfo.object_desc === "object" ? feedInfo.object_desc : feedInfo.objectDesc && typeof feedInfo.objectDesc === "object" ? feedInfo.objectDesc : {};
  const authorInfo = data.authorInfo && typeof data.authorInfo === "object" ? data.authorInfo : data.author_info && typeof data.author_info === "object" ? data.author_info : objectInfo.contact && typeof objectInfo.contact === "object" ? objectInfo.contact : objectInfo.authorInfo && typeof objectInfo.authorInfo === "object" ? objectInfo.authorInfo : {};
  const sceneInfo = data.sceneInfo && typeof data.sceneInfo === "object" ? data.sceneInfo : data.scene_info && typeof data.scene_info === "object" ? data.scene_info : {};
  const errMsg = data.errMsg && typeof data.errMsg === "object" ? data.errMsg : {};
  const description = cleanSocialDescription(
    feedInfo.description || feedInfo.desc || objectDesc.description || objectDesc.desc || data.description || data.desc || ""
  );
  const mediaCandidates = getWechatChannelsMediaCandidates(root);
  const mediaUrls = mediaCandidates.map((candidate) => candidate.url);
  const firstMedia = mediaCandidates[0] || {};
  const decodeKey = firstMedia.decodeKey || (mediaCandidates.find((candidate) => candidate.decodeKey) || {}).decodeKey || "";
  const videoUrl = firstMedia.url || getWechatChannelsVideoUrl(feedInfo);
  const coverUrl = normalizeExtractedUrl(
    firstMedia.coverUrl || feedInfo.coverUrl || feedInfo.cover_url || objectDesc.coverUrl || objectDesc.cover_url || objectDesc.thumbUrl || objectDesc.thumb_url || data.coverUrl || data.cover_url || ""
  );
  return {
    title: buildWechatChannelsTitle(description),
    author: cleanSocialDescription(authorInfo.nickname || authorInfo.nickName || ""),
    description,
    tags: extractTagsFromText(description),
    coverUrl,
    videoUrl,
    mediaUrls,
    mediaItems: mediaCandidates,
    decodeKey,
    dynamicExportId: String(sceneInfo.dynamicExportId || sceneInfo.dynamic_export_id || objectInfo.id || objectInfo.exportId || ""),
    errMsg: String(errMsg.title || errMsg.content || root.errMsg || "").trim()
  };
}
__name(normalizeWechatChannelsFeedPayload, "normalizeWechatChannelsFeedPayload");
function pushWechatChannelsProfile(profiles, profile, sourceUrl = "") {
  if (!profile || typeof profile !== "object") return;
  const mediaItems = Array.isArray(profile.mediaItems) ? profile.mediaItems : [];
  if (!mediaItems.length && !profile.videoUrl) return;
  const normalizedProfile = {
    ...profile,
    sourceUrl: sourceUrl || profile.sourceUrl || "",
    mediaItems,
    mediaUrls: Array.isArray(profile.mediaUrls) ? profile.mediaUrls : mediaItems.map((item) => item.url).filter(Boolean),
    videoUrl: profile.videoUrl || mediaItems[0] && mediaItems[0].url || ""
  };
  const key = [
    normalizedProfile.videoUrl,
    ...normalizedProfile.mediaItems.map((item) => item && item.url).filter(Boolean)
  ].join("|");
  if (!key || profiles.some((item) => [
    item.videoUrl,
    ...(item.mediaItems || []).map((media) => media && media.url).filter(Boolean)
  ].join("|") === key)) return;
  profiles.push(normalizedProfile);
}
__name(pushWechatChannelsProfile, "pushWechatChannelsProfile");
function collectWechatChannelsProfiles(value, profiles = [], seen = /* @__PURE__ */ new Set(), sourceUrl = "") {
  if (Array.isArray(value)) {
    value.forEach((item) => collectWechatChannelsProfiles(item, profiles, seen, sourceUrl));
    return profiles;
  }
  if (!value || typeof value !== "object" || seen.has(value)) return profiles;
  seen.add(value);
  [
    normalizeWechatChannelsFeedPayload(value),
    normalizeWechatChannelsFeedPayload({ data: value }),
    normalizeWechatChannelsFeedPayload({ data: { object: value } })
  ].forEach((profile) => pushWechatChannelsProfile(profiles, profile, sourceUrl));
  Object.keys(value).forEach((key) => {
    if (/data|object|feed|media|video|desc|list|item|response/i.test(key)) {
      collectWechatChannelsProfiles(value[key], profiles, seen, sourceUrl);
    }
  });
  return profiles;
}
__name(collectWechatChannelsProfiles, "collectWechatChannelsProfiles");
function extractWechatChannelsProfilesFromText(text, sourceUrl = "") {
  const source = typeof text === "string" ? text : JSON.stringify(text || {});
  const parsed = typeof text === "string" ? tryParseJson(source) : text;
  const profiles = [];
  if (parsed && typeof parsed === "object") {
    collectWechatChannelsProfiles(parsed, profiles, /* @__PURE__ */ new Set(), sourceUrl);
  }
  return profiles;
}
__name(extractWechatChannelsProfilesFromText, "extractWechatChannelsProfilesFromText");
function buildWechatChannelsPreviewUrl(url) {
  const payload = extractWechatChannelsRequestPayload(url);
  if (payload.shortUri) {
    return `https://channels.weixin.qq.com/finder-preview/pages/sph?id=${encodeURIComponent(payload.shortUri)}`;
  }
  if (payload.exportId) {
    return `https://channels.weixin.qq.com/web/pages/feed?eid=${encodeURIComponent(payload.exportId)}`;
  }
  return String(url || "");
}
__name(buildWechatChannelsPreviewUrl, "buildWechatChannelsPreviewUrl");
function buildWechatChannelsUnavailableMarkdown(url, feed = {}, reason = "") {
  const lines = [
    "原始链接：" + cleanDisplayUrl(url),
    "",
    "## 视频号口播文案",
    "",
    "未能提取视频号口播文案。",
    "",
    reason || "视频号网页端未返回可转写的视频资源。",
    "",
    "这通常表示当前分享链接在网页端只公开了发布简介、封面等信息，未公开真实视频播放地址。可以尝试重新从微信内分享链接；如果仍失败，请把视频保存到相册或导出为 MP4/音频后，通过小程序上传素材，插件会按原视频文件自动转写。"
  ];
  if (feed.description) {
    lines.push("", "## 发布简介（仅供定位，不作为口播转写）", "", feed.description);
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
__name(buildWechatChannelsUnavailableMarkdown, "buildWechatChannelsUnavailableMarkdown");
function decodeHtmlEntities(text) {
  return String(text || "").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}
__name(decodeHtmlEntities, "decodeHtmlEntities");
function cleanHtmlCodeText(html) {
  return decodeHtmlEntities(String(html || "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(?:p|div|li|tr)>/gi, "\n").replace(/<[^>]+>/g, "")).replace(/\r\n/g, "\n").replace(/\u00a0/g, " ").replace(/^\n+|\n+$/g, "");
}
__name(cleanHtmlCodeText, "cleanHtmlCodeText");
function htmlCodeBlockToMarkdown(html) {
  const code = cleanHtmlCodeText(html);
  if (!code.trim()) return "";
  return `

\`\`\`
${code}
\`\`\`

`;
}
__name(htmlCodeBlockToMarkdown, "htmlCodeBlockToMarkdown");
function stripHtmlTags(html) {
  return decodeHtmlEntities(String(html || "").replace(/<[^>]+>/g, "")).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}
__name(stripHtmlTags, "stripHtmlTags");
function extractHtmlTextByClass(html, classPattern) {
  var _a;
  const pattern = /<([a-z][\w:-]*)\b[^>]*class=["']([^"']*)["'][^>]*>([\s\S]*?)<\/\1>/gi;
  const candidates = [];
  let match;
  while (match = pattern.exec(String(html || ""))) {
    if (classPattern.test(match[2] || "")) {
      const text = stripHtmlTags(match[3]);
      if (text) candidates.push({ className: match[2] || "", text });
    }
  }
  candidates.sort((a, b) => {
    const aExact = /(^|\s)(comment[_-]?content|js_comment_content|discuss_message_content)(\s|$)/i.test(a.className) ? 1 : 0;
    const bExact = /(^|\s)(comment[_-]?content|js_comment_content|discuss_message_content)(\s|$)/i.test(b.className) ? 1 : 0;
    return bExact - aExact || a.text.length - b.text.length;
  });
  return ((_a = candidates[0]) == null ? void 0 : _a.text) || "";
}
__name(extractHtmlTextByClass, "extractHtmlTextByClass");
function normalizeSocialComment(comment, depth = 0) {
  const author = String(comment.author || "").replace(/^[:：]+|[:：]+$/g, "").trim();
  const content = String(comment.content || "").replace(/\s+/g, " ").trim();
  if (!content || content.length < 2) return null;
  if (isNoisySocialCommentContent(content, author)) return null;
  const normalized = {
    author,
    content,
    time: String(comment.time || "").trim(),
    likes: String(comment.likes || "").trim()
  };
  const id = getSocialCommentId(comment);
  if (id) normalized.id = id;
  const domRole = String(comment.domRole || "").trim().toLowerCase();
  if (["root", "reply", "unknown"].includes(domRole)) normalized.domRole = domRole;
  const parentCommentId = String(comment.parentCommentId || comment.parent_comment_id || "").trim();
  const parentAuthor = String(comment.parentAuthor || "").trim();
  if (parentCommentId) normalized.parentCommentId = parentCommentId;
  if (parentAuthor) normalized.parentAuthor = parentAuthor;
  if (depth < 4 && Array.isArray(comment.replies)) {
    const replySeen = /* @__PURE__ */ new Set();
    const replies = comment.replies.map((reply) => normalizeSocialComment(reply, depth + 1)).filter((reply) => {
      if (!reply) return false;
      const key = getSocialCommentIdentity(reply);
      if (replySeen.has(key)) return false;
      replySeen.add(key);
      return true;
    }).slice(0, XIAOHONGSHU_REPLY_COMMENT_LIMIT);
    if (replies.length) normalized.replies = replies;
  }
  return normalized;
}
__name(normalizeSocialComment, "normalizeSocialComment");
function isNoisySocialCommentContent(content, author = "") {
  const text = String(content || "").replace(/\s+/g, " ").trim();
  const byAuthor = String(author || "").trim();
  if (!text) return true;
  if (/^\d+$/.test(text)) return true;
  if (/^(?:回复|评论|点赞|分享|收藏|展开|收起|查看|更多|写评论|发布|发送)$/.test(text)) return true;
  if (/^共\s*\d+\s*(?:条|則|个)?\s*(?:评论|回复)/.test(text)) return true;
  if (/(?:共\s*\d+\s*(?:条|个)?\s*评论).*(?:回复|展开|查看)/.test(text)) return true;
  if (/问一问.{0,30}(?:总结|都在问什么|为你)/.test(text) || /^问一问$/.test(byAuthor)) return true;
  if (byAuthor && getSocialCommentCanonicalText(text) === getSocialCommentCanonicalText(byAuthor)) return true;
  if (!byAuthor && text.length <= 4 && /^[\d\s赞回复评论]+$/.test(text)) return true;
  return false;
}
__name(isNoisySocialCommentContent, "isNoisySocialCommentContent");
function getSocialCommentCanonicalText(value) {
  return String(value || "").normalize("NFKC").replace(/^回复\s+[^:：]{1,80}\s*[:：]\s*/u, "").replace(/\[[^\]\r\n]{1,16}\]/gu, "").replace(/(?:\.{3,}|…{2,})?\s*(?:展开|收起|查看全部)\s*$/u, "").toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, "").trim();
}
__name(getSocialCommentCanonicalText, "getSocialCommentCanonicalText");
function getSocialCommentId(comment) {
  if (!comment || typeof comment !== "object") return "";
  return String(comment.id || comment.comment_id || comment.commentId || "").trim();
}
__name(getSocialCommentId, "getSocialCommentId");
function getSocialCommentIdentity(comment) {
  const id = getSocialCommentId(comment);
  if (id) return `id:${id}`;
  return `text:${String(comment && comment.author || "").trim()}|${String(comment && comment.content || "").trim()}|${String(comment && comment.time || "").trim()}`;
}
__name(getSocialCommentIdentity, "getSocialCommentIdentity");
function getSocialCommentFallbackIdentity(comment) {
  const rawAuthor = String(comment && comment.author || "").replace(/^[:：]+|[:：]+$/g, "").normalize("NFKC").replace(/\s+/g, "").toLowerCase();
  const author = getSocialCommentCanonicalText(rawAuthor) || rawAuthor;
  const content = getSocialCommentCanonicalText(comment && comment.content);
  return author && content ? `${author}|${content}` : "";
}
__name(getSocialCommentFallbackIdentity, "getSocialCommentFallbackIdentity");
function collectSocialCommentFallbackIdentities(comments = [], target = /* @__PURE__ */ new Set()) {
  (Array.isArray(comments) ? comments : []).forEach((comment) => {
    const key = getSocialCommentFallbackIdentity(comment);
    if (key) target.add(key);
    collectSocialCommentFallbackIdentities(comment && comment.replies, target);
  });
  return target;
}
__name(collectSocialCommentFallbackIdentities, "collectSocialCommentFallbackIdentities");
function getSocialCommentAuthorKey(author) {
  return String(author || "").replace(/^[:：]+|[:：]+$/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}
__name(getSocialCommentAuthorKey, "getSocialCommentAuthorKey");
function parseXiaohongshuDomReply(comment) {
  const content = String(comment && comment.content || "").trim();
  if (String(comment && comment.domRole || "").toLowerCase() === "reply") {
    return {
      parentCommentId: String(comment && comment.parentCommentId || "").trim(),
      targetAuthorKey: getSocialCommentAuthorKey(comment && comment.parentAuthor),
      content
    };
  }
  const match = content.match(/^回复\s+(.{1,80}?)\s*[:：]\s*(.+)$/u);
  if (!match || !match[1] || !match[2]) return null;
  return {
    targetAuthorKey: getSocialCommentAuthorKey(match[1]),
    content: match[2].trim()
  };
}
__name(parseXiaohongshuDomReply, "parseXiaohongshuDomReply");
function pushSocialComment(comments, seen, comment) {
  const normalized = normalizeSocialComment(comment || {});
  if (!normalized) return;
  const key = getSocialCommentIdentity(normalized);
  if (seen.has(key)) return;
  seen.add(key);
  comments.push(normalized);
  const markRepliesSeen = /* @__PURE__ */ __name((replies = []) => {
    (Array.isArray(replies) ? replies : []).forEach((reply) => {
      const replyKey = getSocialCommentIdentity(reply);
      seen.add(replyKey);
      markRepliesSeen(reply.replies);
    });
  }, "markRepliesSeen");
  markRepliesSeen(normalized.replies);
}
__name(pushSocialComment, "pushSocialComment");
function getSocialCommentReplyValues(value) {
  if (!value || typeof value !== "object") return [];
  const replies = [];
  [
    "replies",
    "replyList",
    "reply_list",
    "subComments",
    "sub_comments",
    "subCommentList",
    "sub_comment_list",
    "children"
  ].forEach((key) => {
    if (Array.isArray(value[key])) replies.push(...value[key]);
  });
  return replies;
}
__name(getSocialCommentReplyValues, "getSocialCommentReplyValues");
function mergeXiaohongshuNetworkCommentVariants(current, incoming) {
  const primary = normalizeSocialComment(current);
  const secondary = normalizeSocialComment(incoming);
  if (!primary) return secondary;
  if (!secondary) return primary;
  const replies = mergeXiaohongshuNetworkComments([
    Array.isArray(primary.replies) ? primary.replies : [],
    Array.isArray(secondary.replies) ? secondary.replies : []
  ], XIAOHONGSHU_REPLY_COMMENT_LIMIT);
  const chooseRicher = /* @__PURE__ */ __name((first, second) => {
    const a = String(first || "").trim();
    const b = String(second || "").trim();
    return b.length > a.length ? b : a;
  }, "chooseRicher");
  const merged = {
    author: chooseRicher(primary.author, secondary.author),
    content: chooseRicher(primary.content, secondary.content),
    time: primary.time || secondary.time,
    likes: primary.likes || secondary.likes
  };
  const id = getSocialCommentId(primary) || getSocialCommentId(secondary);
  if (id) merged.id = id;
  if (replies.length) merged.replies = replies;
  return merged;
}
__name(mergeXiaohongshuNetworkCommentVariants, "mergeXiaohongshuNetworkCommentVariants");
function mergeXiaohongshuNetworkComments(groups = [], limit = XIAOHONGSHU_ROOT_COMMENT_LIMIT) {
  const max = Math.max(1, Number(limit) || XIAOHONGSHU_ROOT_COMMENT_LIMIT);
  const comments = [];
  const indexes = /* @__PURE__ */ new Map();
  (Array.isArray(groups) ? groups : []).forEach((group) => {
    (Array.isArray(group) ? group : []).forEach((comment) => {
      const normalized = normalizeSocialComment(comment);
      if (!normalized) return;
      const key = getSocialCommentIdentity(normalized);
      if (indexes.has(key)) {
        const index = indexes.get(key);
        comments[index] = mergeXiaohongshuNetworkCommentVariants(comments[index], normalized);
        return;
      }
      if (comments.length >= max) return;
      indexes.set(key, comments.length);
      comments.push(normalized);
    });
  });
  return comments.slice(0, max);
}
__name(mergeXiaohongshuNetworkComments, "mergeXiaohongshuNetworkComments");
function preserveXiaohongshuPrimaryCommentTree(primaryComments = [], candidateComments = [], limit = XIAOHONGSHU_ROOT_COMMENT_LIMIT) {
  return mergeXiaohongshuNetworkComments([
    Array.isArray(primaryComments) ? primaryComments : [],
    Array.isArray(candidateComments) ? candidateComments : []
  ], limit);
}
__name(preserveXiaohongshuPrimaryCommentTree, "preserveXiaohongshuPrimaryCommentTree");
function mergeXiaohongshuCommentSources({
  networkComments = [],
  deferredReplyGroups = [],
  fallbackGroups = [],
  limit = XIAOHONGSHU_ROOT_COMMENT_LIMIT
} = {}) {
  const max = Math.max(1, Math.min(Number(limit) || XIAOHONGSHU_ROOT_COMMENT_LIMIT, XIAOHONGSHU_ROOT_COMMENT_LIMIT));
  let comments = mergeXiaohongshuNetworkComments([networkComments], max);
  const networkStats = getSocialCommentTreeStats(comments);
  const canonicalKeys = collectSocialCommentFallbackIdentities(comments);
  let dedupedFallbackCount = 0;
  let fallbackAddedCount = 0;
  let fallbackReplyAddedCount = 0;
  let unmatchedFallbackReplyCount = 0;
  let droppedFallbackCount = 0;
  let restoredReplyCount = 0;
  let unmatchedDeferredReplyCount = 0;
  const hasNetworkRoots = comments.length > 0;
  (Array.isArray(fallbackGroups) ? fallbackGroups : []).forEach((group) => {
    (Array.isArray(group) ? group : []).forEach((comment) => {
      const normalized = normalizeSocialComment(comment);
      if (!normalized) {
        droppedFallbackCount += 1;
        return;
      }
      const key = getSocialCommentFallbackIdentity(normalized);
      if (key && canonicalKeys.has(key)) {
        dedupedFallbackCount += 1;
        return;
      }
      const domReply = parseXiaohongshuDomReply(normalized);
      if (domReply) {
        let matchingRootIndexes = [];
        if (domReply.parentCommentId) {
          matchingRootIndexes = comments.map((root2, index) => getSocialCommentId(root2) === domReply.parentCommentId ? index : -1).filter((index) => index >= 0);
        }
        if (!matchingRootIndexes.length && domReply.targetAuthorKey) {
          matchingRootIndexes = comments.map((root2, index) => getSocialCommentAuthorKey(root2 && root2.author) === domReply.targetAuthorKey ? index : -1).filter((index) => index >= 0);
        }
        if (matchingRootIndexes.length !== 1) {
          unmatchedFallbackReplyCount += 1;
          return;
        }
        const rootIndex = matchingRootIndexes[0];
        const root = comments[rootIndex];
        const reply = normalizeSocialComment({
          ...normalized,
          content: domReply.content
        });
        if (!reply) {
          unmatchedFallbackReplyCount += 1;
          return;
        }
        const existingReplies = Array.isArray(root.replies) ? root.replies : [];
        const mergedReplies = mergeXiaohongshuNetworkComments([
          existingReplies,
          [reply]
        ], XIAOHONGSHU_REPLY_COMMENT_LIMIT);
        if (mergedReplies.length === existingReplies.length) {
          dedupedFallbackCount += 1;
          return;
        }
        comments[rootIndex] = { ...root, replies: mergedReplies };
        const replyKey = getSocialCommentFallbackIdentity(reply);
        if (replyKey) canonicalKeys.add(replyKey);
        fallbackAddedCount += 1;
        fallbackReplyAddedCount += 1;
        return;
      }
      if (hasNetworkRoots && normalized.domRole !== "root") {
        droppedFallbackCount += 1;
        return;
      }
      if (comments.length >= max) return;
      comments.push(normalized);
      if (key) canonicalKeys.add(key);
      collectSocialCommentFallbackIdentities(normalized.replies, canonicalKeys);
      fallbackAddedCount += 1;
    });
  });
  (Array.isArray(deferredReplyGroups) ? deferredReplyGroups : []).forEach((group) => {
    const rootCommentId = String(group && group.rootCommentId || "").trim();
    const payloads = Array.isArray(group && group.payloads) ? group.payloads : [];
    const hasMatchingRoot = Boolean(rootCommentId) && comments.some((comment) => getSocialCommentId(comment) === rootCommentId);
    if (!hasMatchingRoot) {
      payloads.forEach((payload) => {
        unmatchedDeferredReplyCount += getXiaohongshuCommentPageItems(payload).length;
      });
      return;
    }
    const beforeReplyCount = countSocialCommentReplies(comments);
    comments = mergeXiaohongshuReplyPages(comments, rootCommentId, payloads);
    restoredReplyCount += Math.max(0, countSocialCommentReplies(comments) - beforeReplyCount);
  });
  const finalStats = getSocialCommentTreeStats(comments);
  return {
    comments: comments.slice(0, max),
    networkRootCount: networkStats.rootCount,
    networkReplyCount: networkStats.replyCount,
    restoredRootCount: 0,
    restoredReplyCount,
    lostRootCount: Math.max(0, networkStats.rootCount - finalStats.rootCount),
    lostReplyCount: Math.max(0, networkStats.replyCount - finalStats.replyCount),
    dedupedFallbackCount,
    fallbackAddedCount,
    fallbackReplyAddedCount,
    unmatchedFallbackReplyCount,
    unmatchedDeferredReplyCount,
    droppedFallbackCount
  };
}
__name(mergeXiaohongshuCommentSources, "mergeXiaohongshuCommentSources");
function readCommentField(item, keys) {
  for (const key of keys) {
    if (item && Object.prototype.hasOwnProperty.call(item, key) && item[key] !== void 0 && item[key] !== null) {
      const value = item[key];
      if (typeof value === "object") {
        const nested = readCommentField(value, ["text", "content", "contentText", "commentText", "value", "nickname", "nickName", "name"]);
        if (nested) return nested;
      } else {
        const text = String(value).trim();
        if (text) return text;
      }
    }
  }
  return "";
}
__name(readCommentField, "readCommentField");
function extractCommentsFromObject(value, comments, seen, limit = 20, depth = 0) {
  if (!value || depth > 8 || comments.length >= limit) return;
  if (Array.isArray(value)) {
    value.forEach((item) => extractCommentsFromObject(item, comments, seen, limit, depth + 1));
    return;
  }
  if (typeof value !== "object") return;
  const content = readCommentField(value, [
    "content",
    "contentText",
    "content_text",
    "text",
    "commentText",
    "comment_text",
    "commentContent",
    "comment_content",
    "noteText",
    "note_text",
    "desc",
    "message"
  ]);
  if (content) {
    const author = readCommentField(value, [
      "nick_name",
      "nickname",
      "nickName",
      "userNickname",
      "user_nickname",
      "userName",
      "name",
      "author"
    ]) || readCommentField(value.user || value.userInfo || value.user_info || value.authorInfo || value.author_info || {}, [
      "nick_name",
      "nickname",
      "nickName",
      "userName",
      "user_name",
      "name"
    ]);
    const time = readCommentField(value, ["create_time", "createTime", "time", "date"]);
    const likes = readCommentField(value, ["like_num", "likeNum", "likeCount", "likedCount", "liked_count", "like_count", "likes"]);
    const id = getSocialCommentId(value);
    const replies = [];
    const replySeen = /* @__PURE__ */ new Set();
    getSocialCommentReplyValues(value).forEach((reply) => {
      if (replies.length >= 20) return;
      extractCommentsFromObject(reply, replies, replySeen, 20, depth + 1);
    });
    pushSocialComment(comments, seen, {
      author,
      content,
      time,
      likes,
      id,
      replies
    });
    return;
  }
  Object.keys(value).forEach((key) => {
    if (comments.length >= limit) return;
    const child = value[key];
    if (/comment|cmt|reply|discuss/i.test(key) || Array.isArray(child) && /^(?:list|items|entries|data)$/i.test(key)) {
      extractCommentsFromObject(child, comments, seen, limit, depth + 1);
    }
  });
}
__name(extractCommentsFromObject, "extractCommentsFromObject");
function collectJsonObjectCandidates(source) {
  const candidates = [];
  const text = String(source || "");
  const starts = [];
  const objectPattern = /(?:__INITIAL_STATE__|INITIAL_STATE|elected_comment|comment(?:List|_list|s)?|comments|cmt_list|reply_list|discussion)\s*[:=]\s*([\[{])/gi;
  let match;
  while (match = objectPattern.exec(text)) {
    starts.push(objectPattern.lastIndex - 1);
  }
  starts.forEach((start) => {
    const open = text[start];
    const close = open === "[" ? "]" : "}";
    let depth = 0;
    let quote = "";
    let escaped = false;
    for (let index = start; index < text.length; index += 1) {
      const char = text[index];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (quote) {
        if (char === quote) quote = "";
        continue;
      }
      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }
      if (char === open) depth += 1;
      if (char === close) depth -= 1;
      if (depth === 0) {
        candidates.push(text.slice(start, index + 1));
        break;
      }
    }
  });
  return candidates;
}
__name(collectJsonObjectCandidates, "collectJsonObjectCandidates");
function parseLooseJsonCandidate(text) {
  const source = String(text || "").trim();
  return tryParseJson(source) || tryParseJson(source.replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":').replace(/'/g, '"'));
}
__name(parseLooseJsonCandidate, "parseLooseJsonCandidate");
function extractSocialCommentsFromHtml(html, limit = 20) {
  const source = String(html || "");
  const comments = [];
  const seen = /* @__PURE__ */ new Set();
  const itemPattern = /<((?:li|div|section|article))\b[^>]*(?:class|id)=["'][^"']*(?:comment|cmt|reply|discuss)[^"']*["'][^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  while (match = itemPattern.exec(source)) {
    const item = match[2] || "";
    const content = extractHtmlTextByClass(item, /(?:comment[_-]?content|content|message|text|desc)/i) || stripHtmlTags(item);
    const author = extractHtmlTextByClass(item, /(?:nickname|nick[_-]?name|user[_-]?name|user-name|author|name)/i);
    const time = extractHtmlTextByClass(item, /(?:time|date)/i);
    const likes = extractHtmlTextByClass(item, /(?:like|liked|praise|赞)/i);
    pushSocialComment(comments, seen, { author, content, time, likes });
    if (comments.length >= limit) return comments;
  }
  collectJsonObjectCandidates(source).forEach((candidate) => {
    extractCommentsFromObject(parseLooseJsonCandidate(candidate), comments, seen, limit);
  });
  return comments.slice(0, limit);
}
__name(extractSocialCommentsFromHtml, "extractSocialCommentsFromHtml");
var buildSocialCommentsMarkdown = createSocialCommentsMarkdownBuilder({
  normalizeComment: normalizeSocialComment,
  formatTime: formatSocialCommentTime,
  formatLikes: formatSocialCommentLikes
});
var socialCommentSectionHelpers = createSocialCommentSectionHelpers({
  buildCommentsMarkdown: buildSocialCommentsMarkdown
});
var xiaohongshuCommentMarkdownHelpers = createXiaohongshuCommentMarkdownHelpers({
  buildCommentsMarkdown: buildSocialCommentsMarkdown
});
function formatSocialCommentTime(value) {
  const text = String(value || "").trim();
  if (!/^\d{10,13}$/.test(text)) return text;
  const timestamp = Number(text) * (text.length === 10 ? 1e3 : 1);
  if (!Number.isFinite(timestamp)) return text;
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? text : date.toISOString().slice(0, 10);
}
__name(formatSocialCommentTime, "formatSocialCommentTime");
function formatSocialCommentLikes(value) {
  const text = String(value || "").replace(/\s+/g, "").trim();
  if (!text) return "";
  if (/^(?:赞|点赞)$/.test(text)) return "赞";
  const count = text.match(/^(\d+(?:\.\d+)?(?:万|w)?)(?:赞|点赞)?$/i);
  return count ? `${count[1]} 赞` : text.replace(/(?:赞\s*){2,}$/u, "赞");
}
__name(formatSocialCommentLikes, "formatSocialCommentLikes");
function getSocialCommentMarkdownStats(markdown = "") {
  return socialCommentSectionHelpers.getStats(markdown);
}
__name(getSocialCommentMarkdownStats, "getSocialCommentMarkdownStats");
function appendSocialCommentsToMarkdown(markdown, comments = []) {
  return socialCommentSectionHelpers.appendComments(markdown, comments);
}
__name(appendSocialCommentsToMarkdown, "appendSocialCommentsToMarkdown");
function splitSocialCommentsMarkdown(markdown = "") {
  return socialCommentSectionHelpers.splitComments(markdown);
}
__name(splitSocialCommentsMarkdown, "splitSocialCommentsMarkdown");
function isXiaohongshuCommentApiUrl(url) {
  try {
    const parsed = new URL(String(url || "").trim());
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && (!parsed.port || parsed.port === "443") && isHostnameWithinDomain(parsed.hostname, "xiaohongshu.com") && /^\/api\/sns\/web\/v\d+\/comment\/(?:sub\/)?page\/?$/.test(parsed.pathname);
  } catch (error) {
    return false;
  }
}
__name(isXiaohongshuCommentApiUrl, "isXiaohongshuCommentApiUrl");
function getXiaohongshuCommentPageData(payload) {
  if (!payload || typeof payload !== "object") return {};
  const candidate = payload.data || payload.result || payload;
  return candidate && typeof candidate === "object" ? candidate : {};
}
__name(getXiaohongshuCommentPageData, "getXiaohongshuCommentPageData");
function getXiaohongshuCommentPageItems(payload) {
  const data = getXiaohongshuCommentPageData(payload);
  const items = data.comments || data.comment_list || data.list || data.items || [];
  return Array.isArray(items) ? items : [];
}
__name(getXiaohongshuCommentPageItems, "getXiaohongshuCommentPageItems");
function collectXiaohongshuCommentPages(payloads = [], limit = XIAOHONGSHU_ROOT_COMMENT_LIMIT) {
  const comments = [];
  const seen = /* @__PURE__ */ new Set();
  const max = Math.max(1, Math.min(Number(limit) || XIAOHONGSHU_ROOT_COMMENT_LIMIT, XIAOHONGSHU_ROOT_COMMENT_LIMIT));
  let pageCount = 0;
  let stopReason = "source_exhausted";
  let previousCursor = "";
  const pages = Array.isArray(payloads) ? payloads : [];
  for (let index = 0; index < pages.length && comments.length < max; index += 1) {
    const payload = pages[index];
    const data = getXiaohongshuCommentPageData(payload);
    const pageComments = [];
    extractCommentsFromObject(getXiaohongshuCommentPageItems(payload), pageComments, /* @__PURE__ */ new Set(), max - comments.length);
    pageComments.forEach((comment) => pushSocialComment(comments, seen, comment));
    pageCount += 1;
    const hasMore = data.has_more === true || data.has_more === 1 || data.hasMore === true || data.hasMore === 1;
    const cursor = String(data.cursor || data.next_cursor || data.nextCursor || "").trim();
    if (!hasMore) {
      stopReason = "exhausted";
      break;
    }
    if (comments.length >= max) {
      stopReason = "limit_reached";
      break;
    }
    if (!cursor || cursor === previousCursor) {
      stopReason = "cursor_missing";
      break;
    }
    previousCursor = cursor;
  }
  return { comments: comments.slice(0, max), pageCount, stopReason };
}
__name(collectXiaohongshuCommentPages, "collectXiaohongshuCommentPages");
function mergeXiaohongshuReplyPages(rootComments = [], rootCommentId = "", payloads = [], limit = XIAOHONGSHU_REPLY_COMMENT_LIMIT) {
  const targetId = String(rootCommentId || "").trim();
  const replyLimit = Math.max(1, Math.min(Number(limit) || XIAOHONGSHU_REPLY_COMMENT_LIMIT, XIAOHONGSHU_REPLY_COMMENT_LIMIT));
  return (Array.isArray(rootComments) ? rootComments : []).map((comment) => normalizeSocialComment(comment)).filter(Boolean).map((comment) => {
    if (!targetId || getSocialCommentId(comment) !== targetId) return comment;
    const replies = [];
    const seen = /* @__PURE__ */ new Set();
    (Array.isArray(comment.replies) ? comment.replies : []).forEach((reply) => pushSocialComment(replies, seen, reply));
    (Array.isArray(payloads) ? payloads : []).forEach((payload) => {
      if (replies.length >= replyLimit) return;
      const pageReplies = [];
      extractCommentsFromObject(getXiaohongshuCommentPageItems(payload), pageReplies, /* @__PURE__ */ new Set(), replyLimit - replies.length);
      pageReplies.forEach((reply) => {
        if (getSocialCommentId(reply) === targetId) return;
        if (replies.length < replyLimit) pushSocialComment(replies, seen, reply);
      });
    });
    return replies.length ? { ...comment, replies } : comment;
  });
}
__name(mergeXiaohongshuReplyPages, "mergeXiaohongshuReplyPages");
function isXiaohongshuSubCommentApiUrl(url) {
  try {
    const parsed = new URL(String(url || "").trim());
    return parsed.protocol === "https:" && !parsed.username && !parsed.password && (!parsed.port || parsed.port === "443") && isHostnameWithinDomain(parsed.hostname, "xiaohongshu.com") && /^\/api\/sns\/web\/v\d+\/comment\/sub\/page\/?$/.test(parsed.pathname);
  } catch (error) {
    return false;
  }
}
__name(isXiaohongshuSubCommentApiUrl, "isXiaohongshuSubCommentApiUrl");
function getXiaohongshuCapturedRootCommentId(entry = {}) {
  const url = String(entry && entry.url || "").trim();
  try {
    const parsed = new URL(url);
    for (const key of ["root_comment_id", "rootCommentId", "comment_id", "commentId"]) {
      const value = String(parsed.searchParams.get(key) || "").trim();
      if (value) return value;
    }
  } catch (error) {
  }
  const body = String(entry && entry.body || "");
  try {
    const params = new URLSearchParams(body);
    for (const key of ["root_comment_id", "rootCommentId", "comment_id", "commentId"]) {
      const value = String(params.get(key) || "").trim();
      if (value) return value;
    }
  } catch (error) {
  }
  const match = body.match(/(?:^|[?&])(?:root_comment_id|rootCommentId|comment_id|commentId)=([^&]+)/i);
  return match && match[1] ? decodeURIComponent(match[1]).trim() : "";
}
__name(getXiaohongshuCapturedRootCommentId, "getXiaohongshuCapturedRootCommentId");
function getXiaohongshuCapturedPayloads(entry = {}) {
  if (entry && entry.payload && typeof entry.payload === "object") return [entry.payload];
  const text = String(entry && entry.text || "").trim();
  if (!text || text.length > XIAOHONGSHU_COMMENT_RESPONSE_MAX_BODY_CHARACTERS) return [];
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object") return [parsed];
  } catch (error) {
  }
  return collectJsonObjectCandidates(text).map((candidate) => parseLooseJsonCandidate(candidate)).filter((payload) => payload && typeof payload === "object");
}
__name(getXiaohongshuCapturedPayloads, "getXiaohongshuCapturedPayloads");
function isRejectedXiaohongshuCommentPayload(payload) {
  if (!payload || typeof payload !== "object") return true;
  const data = getXiaohongshuCommentPageData(payload);
  const success = payload.success !== void 0 ? payload.success : data.success;
  const code = payload.code !== void 0 ? payload.code : payload.error_code !== void 0 ? payload.error_code : data.code !== void 0 ? data.code : data.error_code;
  if (success === false || success === 0 || success === "false") return true;
  return code !== void 0 && code !== null && String(code) !== "" && String(code) !== "0";
}
__name(isRejectedXiaohongshuCommentPayload, "isRejectedXiaohongshuCommentPayload");
function countSocialCommentReplies(comments = []) {
  let count = 0;
  const visit = /* @__PURE__ */ __name((items) => {
    (Array.isArray(items) ? items : []).forEach((item) => {
      const replies = Array.isArray(item && item.replies) ? item.replies : [];
      count += replies.length;
      visit(replies);
    });
  }, "visit");
  visit(comments);
  return count;
}
__name(countSocialCommentReplies, "countSocialCommentReplies");
function getSocialCommentTreeStats(comments = []) {
  const roots = (Array.isArray(comments) ? comments : []).map((comment) => normalizeSocialComment(comment)).filter(Boolean);
  return {
    rootCount: roots.length,
    replyCount: countSocialCommentReplies(roots)
  };
}
__name(getSocialCommentTreeStats, "getSocialCommentTreeStats");
function limitSocialCommentTreeTotal(comments = [], limit = XIAOHONGSHU_TOTAL_COMMENT_LIMIT) {
  const max = Math.max(1, Math.min(
    Number(limit) || XIAOHONGSHU_TOTAL_COMMENT_LIMIT,
    XIAOHONGSHU_TOTAL_COMMENT_LIMIT
  ));
  let remaining = max;
  const takeComment = /* @__PURE__ */ __name((comment) => {
    if (remaining <= 0) return null;
    const normalized = normalizeSocialComment(comment);
    if (!normalized) return null;
    remaining -= 1;
    const limited = { ...normalized };
    const replies = Array.isArray(normalized.replies) ? normalized.replies : [];
    delete limited.replies;
    if (remaining > 0 && replies.length) {
      const limitedReplies = [];
      for (const reply of replies) {
        const limitedReply = takeComment(reply);
        if (limitedReply) limitedReplies.push(limitedReply);
        if (remaining <= 0) break;
      }
      if (limitedReplies.length) limited.replies = limitedReplies;
    }
    return limited;
  }, "takeComment");
  const limitedComments = [];
  for (const comment of Array.isArray(comments) ? comments : []) {
    const limited = takeComment(comment);
    if (limited) limitedComments.push(limited);
    if (remaining <= 0) break;
  }
  return limitedComments;
}
__name(limitSocialCommentTreeTotal, "limitSocialCommentTreeTotal");
function mergeXiaohongshuCapturedCommentPayloads(entries = [], limit = XIAOHONGSHU_ROOT_COMMENT_LIMIT, options = {}) {
  const rootPayloads = [];
  const replyPayloadGroups = /* @__PURE__ */ new Map();
  const orphanReplyPayloads = [];
  let rootPayloadCount = 0;
  let replyPayloadCount = 0;
  let invalidPayloadCount = 0;
  const expectedNoteId = String(options && options.expectedNoteId || "").trim();
  const orderedEntries = (Array.isArray(entries) ? entries : []).map((entry, index) => ({
    entry,
    index,
    sequence: Number.isFinite(Number(entry && entry.sequence)) ? Number(entry.sequence) : index
  })).sort((a, b) => a.sequence - b.sequence || a.index - b.index).map((item) => item.entry);
  orderedEntries.forEach((entry) => {
    const url = String(entry && entry.url || "").trim();
    if (!isXiaohongshuCommentApiUrl(url)) return;
    const requestIdentity = {
      url,
      body: String(entry && (entry.body || entry.postData) || "")
    };
    if (expectedNoteId && classifyXiaohongshuCommentRequestIdentity(requestIdentity, expectedNoteId) !== "matched") return;
    const payloads = getXiaohongshuCapturedPayloads(entry);
    if (!payloads.length) return;
    const isReply = isXiaohongshuSubCommentApiUrl(url);
    if (!isReply) {
      payloads.forEach((payload) => {
        if (expectedNoteId && classifyXiaohongshuCommentRequestIdentity({
          ...requestIdentity,
          payload
        }, expectedNoteId) !== "matched") {
          invalidPayloadCount += 1;
          return;
        }
        if (isRejectedXiaohongshuCommentPayload(payload)) {
          invalidPayloadCount += 1;
          return;
        }
        rootPayloads.push(payload);
        rootPayloadCount += 1;
      });
      return;
    }
    const rootCommentId = getXiaohongshuCapturedRootCommentId(entry);
    payloads.forEach((payload) => {
      if (expectedNoteId && classifyXiaohongshuCommentRequestIdentity({
        ...requestIdentity,
        payload
      }, expectedNoteId) !== "matched") {
        invalidPayloadCount += 1;
        return;
      }
      if (isRejectedXiaohongshuCommentPayload(payload)) {
        invalidPayloadCount += 1;
        return;
      }
      replyPayloadCount += 1;
      const payloadRootId = rootCommentId || getXiaohongshuCommentPageItems(payload).map((item) => String(item && (item.root_comment_id || item.rootCommentId) || "").trim()).find(Boolean) || "";
      if (!payloadRootId) {
        orphanReplyPayloads.push(payload);
        return;
      }
      if (!replyPayloadGroups.has(payloadRootId)) replyPayloadGroups.set(payloadRootId, []);
      replyPayloadGroups.get(payloadRootId).push(payload);
    });
  });
  const rootResult = collectXiaohongshuCommentPages(rootPayloads, limit);
  let comments = rootResult.comments;
  const deferredReplyGroups = [];
  let unmatchedReplyCount = 0;
  let unmatchedReplyPayloadCount = 0;
  replyPayloadGroups.forEach((payloads, rootCommentId) => {
    const hasMatchingRoot = comments.some((comment) => getSocialCommentId(comment) === rootCommentId);
    if (!hasMatchingRoot) {
      deferredReplyGroups.push({ rootCommentId, payloads: [...payloads] });
      unmatchedReplyPayloadCount += payloads.length;
      payloads.forEach((payload) => {
        unmatchedReplyCount += getXiaohongshuCommentPageItems(payload).length;
      });
      return;
    }
    comments = mergeXiaohongshuReplyPages(comments, rootCommentId, payloads);
  });
  if (orphanReplyPayloads.length) {
    deferredReplyGroups.push({ rootCommentId: "", payloads: [...orphanReplyPayloads] });
    orphanReplyPayloads.forEach((payload) => {
      unmatchedReplyCount += getXiaohongshuCommentPageItems(payload).length;
    });
    unmatchedReplyPayloadCount += orphanReplyPayloads.length;
  }
  return {
    comments: comments.slice(0, limit),
    rootPayloadCount,
    replyPayloadCount,
    invalidPayloadCount,
    orphanReplyPayloadCount: orphanReplyPayloads.length,
    unmatchedReplyCount,
    unmatchedReplyPayloadCount,
    deferredReplyGroups,
    rootCount: rootResult.comments.length,
    replyCount: countSocialCommentReplies(comments),
    rootPageCount: rootResult.pageCount,
    replyPageCount: replyPayloadCount,
    pageCount: rootResult.pageCount + replyPayloadCount,
    stopReason: rootPayloadCount ? rootResult.stopReason : "root_unavailable",
    source: rootPayloadCount || replyPayloadCount ? "browser-network" : "page-api"
  };
}
__name(mergeXiaohongshuCapturedCommentPayloads, "mergeXiaohongshuCapturedCommentPayloads");
function buildXiaohongshuCommentDiagnostic(details = {}) {
  return xiaohongshuCommentMarkdownHelpers.buildCommentDiagnostic(details);
}
__name(buildXiaohongshuCommentDiagnostic, "buildXiaohongshuCommentDiagnostic");
function appendXiaohongshuCommentDiagnostic(markdown, details = {}) {
  return xiaohongshuCommentMarkdownHelpers.appendCommentDiagnostic(markdown, details);
}
__name(appendXiaohongshuCommentDiagnostic, "appendXiaohongshuCommentDiagnostic");
function replaceSocialCommentsInMarkdown(markdown, comments = []) {
  return xiaohongshuCommentMarkdownHelpers.replaceComments(markdown, comments);
}
__name(replaceSocialCommentsInMarkdown, "replaceSocialCommentsInMarkdown");
function isPartialXiaohongshuCommentResult(details = {}) {
  if (details.partial) return true;
  if (Number(details.lostRootCount || 0) > 0 || Number(details.lostReplyCount || 0) > 0) return true;
  if (Number(details.unmatchedReplyCount || 0) > 0) return true;
  const stopReason = String(details.stopReason || "").toLowerCase();
  return /(?:idle|unavailable|missing|failed|rejected|captcha|timeout|time_budget_exceeded|limit_reached|max_rounds|source_exhausted)/.test(stopReason);
}
__name(isPartialXiaohongshuCommentResult, "isPartialXiaohongshuCommentResult");
function finalizeXiaohongshuComments({
  baseMarkdown = "",
  renderedComments = [],
  staticComments = [],
  diagnosticDetails = {},
  limit = XIAOHONGSHU_ROOT_COMMENT_LIMIT
} = {}) {
  const max = Math.max(1, Math.min(Number(limit) || XIAOHONGSHU_ROOT_COMMENT_LIMIT, XIAOHONGSHU_ROOT_COMMENT_LIMIT));
  const renderedTree = mergeXiaohongshuNetworkComments([renderedComments], max);
  const hasRenderedTree = renderedTree.length > 0;
  const fallbackMerge = hasRenderedTree ? null : mergeXiaohongshuCommentSources({
    networkComments: [],
    fallbackGroups: [staticComments],
    limit: max
  });
  const comments = limitSocialCommentTreeTotal(
    hasRenderedTree ? renderedTree : fallbackMerge.comments,
    XIAOHONGSHU_TOTAL_COMMENT_LIMIT
  );
  const stats = getSocialCommentTreeStats(comments);
  const inputStats = getSocialCommentTreeStats(renderedComments);
  const markdownWithoutDiagnostic = replaceSocialCommentsInMarkdown(baseMarkdown, comments);
  const markdownStats = getSocialCommentMarkdownStats(markdownWithoutDiagnostic);
  const mergedRootCount = Math.max(
    Number(diagnosticDetails.mergedRootCount || 0),
    inputStats.rootCount
  );
  const mergedReplyCount = Math.max(
    Number(diagnosticDetails.mergedReplyCount || 0),
    inputStats.replyCount
  );
  const finalDiagnosticDetails = {
    ...diagnosticDetails,
    mergedRootCount,
    mergedReplyCount,
    finalRootCount: markdownStats.rootCount,
    finalReplyCount: markdownStats.replyCount,
    lostRootCount: Math.max(
      Number(diagnosticDetails.lostRootCount || 0),
      Math.max(0, mergedRootCount - markdownStats.rootCount)
    ),
    lostReplyCount: Math.max(
      Number(diagnosticDetails.lostReplyCount || 0),
      Math.max(0, mergedReplyCount - markdownStats.replyCount)
    ),
    fallbackAddedCount: Number(diagnosticDetails.fallbackAddedCount || 0) + Number(fallbackMerge && fallbackMerge.fallbackAddedCount || 0),
    dedupedFallbackCount: Number(diagnosticDetails.dedupedFallbackCount || 0) + Number(fallbackMerge && fallbackMerge.dedupedFallbackCount || 0),
    droppedFallbackCount: Number(diagnosticDetails.droppedFallbackCount || 0) + Number(fallbackMerge && fallbackMerge.droppedFallbackCount || 0),
    unmatchedReplyCount: Number(diagnosticDetails.unmatchedReplyCount || 0) + Number(fallbackMerge && fallbackMerge.unmatchedFallbackReplyCount || 0)
  };
  finalDiagnosticDetails.partial = isPartialXiaohongshuCommentResult(finalDiagnosticDetails);
  const shouldAppendDiagnostic = Object.keys(diagnosticDetails || {}).length > 0;
  return {
    comments,
    markdown: shouldAppendDiagnostic ? appendXiaohongshuCommentDiagnostic(markdownWithoutDiagnostic, finalDiagnosticDetails) : markdownWithoutDiagnostic,
    stats,
    markdownStats,
    diagnosticDetails: finalDiagnosticDetails,
    usedStaticFallback: !hasRenderedTree && comments.length > 0
  };
}
__name(finalizeXiaohongshuComments, "finalizeXiaohongshuComments");
function didXiaohongshuRootCollectionProgress(previous = {}, current = {}) {
  const previousRootCommentCount = Number(previous && previous.rootCommentCount) || 0;
  const previousRootRequestCount = Number(previous && previous.rootRequestCount) || 0;
  const previousScrollTop = Number(previous && previous.scrollTop) || 0;
  const previousScrollHeight = Number(previous && previous.scrollHeight) || 0;
  const currentRootCommentCount = Number(current && current.rootCommentCount) || 0;
  const currentRootRequestCount = Number(current && current.rootRequestCount) || 0;
  const currentScrollTop = Number(current && current.scrollTop) || 0;
  const currentScrollHeight = Number(current && current.scrollHeight) || 0;
  return currentRootCommentCount > previousRootCommentCount || currentRootRequestCount > previousRootRequestCount || currentScrollTop > previousScrollTop + 1 || currentScrollHeight > previousScrollHeight + 1;
}
__name(didXiaohongshuRootCollectionProgress, "didXiaohongshuRootCollectionProgress");
function getXiaohongshuCommentBudgetState({
  deadlineAt = 0,
  now = Date.now(),
  totalCount = 0,
  limit = XIAOHONGSHU_TOTAL_COMMENT_LIMIT
} = {}) {
  const currentTime = Number(now) || 0;
  const deadline = Number(deadlineAt) || currentTime;
  const max = Math.max(1, Math.min(
    Number(limit) || XIAOHONGSHU_TOTAL_COMMENT_LIMIT,
    XIAOHONGSHU_TOTAL_COMMENT_LIMIT
  ));
  const remainingMs = Math.max(0, deadline - currentTime);
  if (Math.max(0, Number(totalCount) || 0) >= max) {
    return { shouldStop: true, stopReason: "total_limit_reached", remainingMs };
  }
  if (remainingMs <= 0) {
    return { shouldStop: true, stopReason: "time_budget_exceeded", remainingMs: 0 };
  }
  return { shouldStop: false, stopReason: "", remainingMs };
}
__name(getXiaohongshuCommentBudgetState, "getXiaohongshuCommentBudgetState");
function getXiaohongshuCommentPaginationScript(url = "", options = {}) {
  const requestedDeadlineAt = Number(options && options.deadlineAt);
  const deadlineAt = Number.isFinite(requestedDeadlineAt) && requestedDeadlineAt > 0 ? Math.floor(requestedDeadlineAt) : Date.now() + XIAOHONGSHU_COMMENT_TIMEOUT_MS;
  const requestedTotalLimit = Number(options && options.totalLimit);
  const totalLimit = Math.max(1, Math.min(
    Number.isFinite(requestedTotalLimit) ? requestedTotalLimit : XIAOHONGSHU_TOTAL_COMMENT_LIMIT,
    XIAOHONGSHU_TOTAL_COMMENT_LIMIT
  ));
  return `
    (async () => {
      const XIAOHONGSHU_ROOT_COMMENT_LIMIT = ${XIAOHONGSHU_ROOT_COMMENT_LIMIT};
      const XIAOHONGSHU_REPLY_COMMENT_LIMIT = ${XIAOHONGSHU_REPLY_COMMENT_LIMIT};
      const XIAOHONGSHU_TOTAL_COMMENT_LIMIT = ${totalLimit};
      const XIAOHONGSHU_ROOT_COMMENT_PAGE_LIMIT = ${XIAOHONGSHU_ROOT_COMMENT_PAGE_LIMIT};
      const deadlineAt = ${deadlineAt};
      const requestTimeoutMs = ${XIAOHONGSHU_COMMENT_REQUEST_TIMEOUT_MS};
      const inputUrl = ${JSON.stringify(cleanDisplayUrl(url))};
      const getBudgetStopReason = (totalCount) => {
        if (Number(totalCount || 0) >= XIAOHONGSHU_TOTAL_COMMENT_LIMIT) return 'total_limit_reached';
        if (Date.now() >= deadlineAt) return 'time_budget_exceeded';
        return '';
      };
      const safeUrl = (value) => { try { return new URL(value || location.href, location.href); } catch (error) { return null; } };
      const readField = (value, keys) => {
        for (const key of keys) {
          if (value && Object.prototype.hasOwnProperty.call(value, key) && value[key] !== undefined && value[key] !== null) return value[key];
        }
        return undefined;
      };
      const getData = (payload) => payload && (payload.data || payload.result || payload) || {};
      const getItems = (payload) => {
        const items = readField(getData(payload), ['comments', 'comment_list', 'list', 'items']);
        return Array.isArray(items) ? items : [];
      };
      const getCursor = (payload) => String(readField(getData(payload), ['cursor', 'next_cursor', 'nextCursor']) || '').trim();
      const hasMore = (payload) => {
        const value = readField(getData(payload), ['has_more', 'hasMore', 'has_next', 'hasNext']);
        return value === true || value === 1 || value === 'true' || value === '1';
      };
      const getId = (comment) => String(readField(comment, ['id', 'comment_id', 'commentId']) || '').trim();
      const pageSource = () => {
        try { return JSON.stringify(window.__INITIAL_STATE__ || {}) + '\\n' + JSON.stringify(window.__APOLLO_STATE__ || {}); } catch (error) { return ''; }
      };
      const noteId = (() => {
        for (const parsed of [safeUrl(inputUrl)].filter(Boolean)) {
          const match = parsed.pathname.match(/\\/(?:explore|discovery\\/item|item)\\/([0-9a-zA-Z]+)/i);
          if (match && match[1]) return match[1];
          const value = parsed.searchParams.get('note_id') || parsed.searchParams.get('noteId');
          if (value) return value;
        }
        return '';
      })();
      const xsecToken = (() => {
        for (const parsed of [safeUrl(location.href), safeUrl(inputUrl)].filter(Boolean)) {
          const value = parsed.searchParams.get('xsec_token') || parsed.searchParams.get('xsecToken');
          if (value) return value;
        }
        const match = pageSource().match(/["']xsec_token["']\\s*:\\s*["']([^"']+)["']/i)
          || pageSource().match(/["']xsecToken["']\\s*:\\s*["']([^"']+)["']/i);
        return match && match[1] ? String(match[1]).trim() : '';
      })();
      const requestJson = async (path, params) => {
        const remainingMs = Math.max(0, deadlineAt - Date.now());
        if (remainingMs <= 0) throw new Error('time_budget_exceeded');
        const query = new URLSearchParams();
        Object.entries(params || {}).forEach(([key, value]) => {
          if (value !== undefined && value !== null && String(value) !== '') query.set(key, String(value));
        });
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), Math.max(1, Math.min(requestTimeoutMs, remainingMs)));
        try {
          const response = await fetch(path + '?' + query.toString(), {
            method: 'GET',
            credentials: 'include',
            signal: controller.signal,
            headers: { Accept: 'application/json, text/plain, */*', 'X-Requested-With': 'XMLHttpRequest' },
          });
          if (!response.ok) throw new Error('http_' + response.status);
          return JSON.parse(await response.text());
        } finally {
          clearTimeout(timer);
        }
      };
      const diagnostic = { source: 'page-api', rootCount: 0, replyCount: 0, pageCount: 0, stopReason: 'unknown' };
      const rootPayloads = [];
      const replyPayloadGroups = [];
      if (!noteId) {
        diagnostic.stopReason = 'note_id_missing';
        return { rootPayloads, replyPayloadGroups, diagnostic, identityNoteId: '' };
      }
      const baseParams = { note_id: noteId, xsec_token: xsecToken, image_scenes: 'FD_WM_WEBP,CRD_WM_WEBP', image_formats: 'jpg,webp,avif' };
      const roots = [];
      let cursor = '';
      for (let page = 0; page < XIAOHONGSHU_ROOT_COMMENT_PAGE_LIMIT && roots.length < XIAOHONGSHU_ROOT_COMMENT_LIMIT; page += 1) {
        const budgetStopReason = getBudgetStopReason(roots.length + diagnostic.replyCount);
        if (budgetStopReason) {
          diagnostic.stopReason = budgetStopReason;
          break;
        }
        let payload;
        try {
          payload = await requestJson('/api/sns/web/v2/comment/page', { ...baseParams, cursor, top_comment_id: '' });
        } catch (error) {
          diagnostic.stopReason = getBudgetStopReason(roots.length + diagnostic.replyCount)
            || (roots.length ? 'root_request_failed' : 'root_unavailable');
          break;
        }
        rootPayloads.push(payload);
        diagnostic.pageCount += 1;
        getItems(payload).forEach((comment) => {
          if (roots.length < XIAOHONGSHU_ROOT_COMMENT_LIMIT) roots.push(comment);
        });
        if (!hasMore(payload)) {
          diagnostic.stopReason = 'exhausted';
          break;
        }
        const nextCursor = getCursor(payload);
        if (!nextCursor || nextCursor === cursor) {
          diagnostic.stopReason = 'root_cursor_missing';
          break;
        }
        cursor = nextCursor;
        if (roots.length >= XIAOHONGSHU_ROOT_COMMENT_LIMIT) diagnostic.stopReason = 'limit_reached';
      }
      diagnostic.rootCount = roots.length;
      for (const root of roots) {
        const rootBudgetStopReason = getBudgetStopReason(roots.length + diagnostic.replyCount);
        if (rootBudgetStopReason) {
          diagnostic.stopReason = rootBudgetStopReason;
          break;
        }
        const rootCommentId = getId(root);
        if (!rootCommentId) continue;
        const inlineReplies = readField(root, ['sub_comments', 'subComments', 'reply_list', 'replyList']);
        const inlineCount = Array.isArray(inlineReplies) ? inlineReplies.length : 0;
        const declaredCount = Number(readField(root, ['sub_comment_count', 'subCommentCount', 'sub_comment_num', 'reply_count', 'replyCount']) || 0);
        const hasHiddenReplies = declaredCount > inlineCount || readField(root, ['sub_comment_cursor', 'subCommentCursor', 'sub_comment_has_more', 'subCommentHasMore']) !== undefined;
        diagnostic.replyCount += Math.min(
          inlineCount,
          Math.max(0, XIAOHONGSHU_TOTAL_COMMENT_LIMIT - roots.length - diagnostic.replyCount),
        );
        if (!hasHiddenReplies) continue;
        const payloads = [];
        let replyCursor = '';
        let replyTotal = inlineCount;
        for (let page = 0; page < 10 && replyTotal < XIAOHONGSHU_REPLY_COMMENT_LIMIT; page += 1) {
          const replyBudgetStopReason = getBudgetStopReason(roots.length + diagnostic.replyCount);
          if (replyBudgetStopReason) {
            diagnostic.stopReason = replyBudgetStopReason;
            break;
          }
          let payload;
          try {
            payload = await requestJson('/api/sns/web/v2/comment/sub/page', { ...baseParams, root_comment_id: rootCommentId, cursor: replyCursor, num: 20 });
          } catch (error) {
            diagnostic.stopReason = getBudgetStopReason(roots.length + diagnostic.replyCount)
              || 'reply_request_failed';
            break;
          }
          payloads.push(payload);
          diagnostic.pageCount += 1;
          const replies = getItems(payload).filter((reply) => getId(reply) !== rootCommentId);
          replyTotal += replies.length;
          diagnostic.replyCount += Math.min(
            replies.length,
            Math.max(0, XIAOHONGSHU_TOTAL_COMMENT_LIMIT - roots.length - diagnostic.replyCount),
          );
          if (!hasMore(payload)) break;
          const nextCursor = getCursor(payload);
          if (!nextCursor || nextCursor === replyCursor) {
            if (diagnostic.stopReason === 'exhausted') diagnostic.stopReason = 'reply_cursor_missing';
            break;
          }
          replyCursor = nextCursor;
          if (replyTotal >= XIAOHONGSHU_REPLY_COMMENT_LIMIT && diagnostic.stopReason === 'exhausted') diagnostic.stopReason = 'reply_limit_reached';
        }
        if (payloads.length) replyPayloadGroups.push({ rootCommentId, payloads });
      }
      const finalBudgetStopReason = getBudgetStopReason(roots.length + diagnostic.replyCount);
      if (finalBudgetStopReason) diagnostic.stopReason = finalBudgetStopReason;
      if (diagnostic.stopReason === 'unknown') diagnostic.stopReason = roots.length >= XIAOHONGSHU_ROOT_COMMENT_LIMIT ? 'total_limit_reached' : 'source_exhausted';
      return { rootPayloads, replyPayloadGroups, diagnostic, identityNoteId: noteId };
    })()
  `;
}
__name(getXiaohongshuCommentPaginationScript, "getXiaohongshuCommentPaginationScript");
function sanitizeXiaohongshuCapturedHeaders(headers = {}, cookieHeader = "") {
  const result = {};
  Object.entries(headers || {}).forEach(([key, value]) => {
    const name = String(key || "").trim();
    if (!name || /^(?:host|content-length|connection|accept-encoding)$/i.test(name)) return;
    if (typeof value === "undefined" || value === null) return;
    result[name] = value;
  });
  if (cookieHeader && !Object.keys(result).some((key) => /^cookie$/i.test(key))) {
    result.Cookie = cookieHeader;
  }
  if (!Object.keys(result).some((key) => /^referer$/i.test(key))) {
    result.Referer = "https://www.xiaohongshu.com/";
  }
  if (!Object.keys(result).some((key) => /^user-agent$/i.test(key))) {
    result["User-Agent"] = "Mozilla/5.0 WeChat-Inbox-Sync";
  }
  return result;
}
__name(sanitizeXiaohongshuCapturedHeaders, "sanitizeXiaohongshuCapturedHeaders");
function getXiaohongshuCapturedRequestBody(details = {}) {
  const parts = [];
  let totalBytes = 0;
  for (const item of Array.isArray(details.uploadData) ? details.uploadData : []) {
    if (!item || !item.bytes) continue;
    try {
      const byteLength = Number(item.bytes.byteLength ?? item.bytes.length);
      if (!Number.isFinite(byteLength) || byteLength < 0 || totalBytes + byteLength > XIAOHONGSHU_COMMENT_IDENTITY_MAX_BODY_CHARACTERS) {
        return XIAOHONGSHU_COMMENT_TRUNCATED_BODY_MARKER;
      }
      const buffer = Buffer.from(item.bytes);
      totalBytes += buffer.length;
      if (totalBytes > XIAOHONGSHU_COMMENT_IDENTITY_MAX_BODY_CHARACTERS) {
        return XIAOHONGSHU_COMMENT_TRUNCATED_BODY_MARKER;
      }
      const text = buffer.toString("utf8");
      if (text) parts.push(text);
    } catch (error) {
    }
  }
  const body = parts.join("&");
  return body.length > XIAOHONGSHU_COMMENT_IDENTITY_MAX_BODY_CHARACTERS ? XIAOHONGSHU_COMMENT_TRUNCATED_BODY_MARKER : body;
}
__name(getXiaohongshuCapturedRequestBody, "getXiaohongshuCapturedRequestBody");
function getXiaohongshuCapturedResponseText(bodyResult = {}) {
  const body = String(bodyResult && bodyResult.body || "");
  if (!body) return "";
  if (bodyResult && bodyResult.base64Encoded) {
    const maxEncodedLength = Math.ceil(XIAOHONGSHU_COMMENT_RESPONSE_MAX_BODY_CHARACTERS / 3) * 4 + 8;
    if (body.length > maxEncodedLength) return "";
    try {
      const decoded = Buffer.from(body, "base64");
      if (decoded.length > XIAOHONGSHU_COMMENT_RESPONSE_MAX_BODY_CHARACTERS) return "";
      return decoded.toString("utf8");
    } catch (error) {
      return "";
    }
  }
  return body.length <= XIAOHONGSHU_COMMENT_RESPONSE_MAX_BODY_CHARACTERS ? body : "";
}
__name(getXiaohongshuCapturedResponseText, "getXiaohongshuCapturedResponseText");
function collectXiaohongshuCommentNoteIdsFromValue(payload, ids, state = null, depth = 0) {
  const traversal = state && state.seen instanceof Set ? state : {
    seen: state instanceof Set ? state : /* @__PURE__ */ new Set(),
    visitedEntries: 0,
    truncated: false
  };
  if (!payload || typeof payload !== "object") return traversal;
  if (depth > 8 || traversal.seen.size >= XIAOHONGSHU_COMMENT_IDENTITY_MAX_NODES) {
    traversal.truncated = true;
    return traversal;
  }
  if (traversal.seen.has(payload)) return traversal;
  traversal.seen.add(payload);
  for (const key in payload) {
    if (!Object.prototype.hasOwnProperty.call(payload, key)) continue;
    traversal.visitedEntries += 1;
    if (traversal.visitedEntries > XIAOHONGSHU_COMMENT_IDENTITY_MAX_NODES) {
      traversal.truncated = true;
      break;
    }
    const child = payload[key];
    if (/^(?:note_id|noteId|item_id|itemId)$/.test(key)) {
      const rawId = String(child || "").trim();
      if (rawId.length > 256) {
        traversal.truncated = true;
        break;
      }
      const id = rawId.toLowerCase();
      if (/^[0-9a-z_-]{6,}$/i.test(id) && !ids.includes(id)) ids.push(id);
    } else if (child && typeof child === "object") {
      collectXiaohongshuCommentNoteIdsFromValue(child, ids, traversal, depth + 1);
      if (traversal.truncated) break;
    }
  }
  return traversal;
}
__name(collectXiaohongshuCommentNoteIdsFromValue, "collectXiaohongshuCommentNoteIdsFromValue");
function collectXiaohongshuCommentRequestNoteIds(request = {}, includePayload = false) {
  const ids = [];
  let truncated = false;
  const add = /* @__PURE__ */ __name((value) => {
    const id = String(value || "").trim().toLowerCase();
    if (/^[0-9a-z_-]{6,}$/i.test(id) && !ids.includes(id)) ids.push(id);
  }, "add");
  const readParams = /* @__PURE__ */ __name((params) => {
    ["note_id", "noteId", "item_id", "itemId"].forEach((key) => {
      const values = typeof params.getAll === "function" ? params.getAll(key) : [params.get(key)];
      values.forEach(add);
    });
  }, "readParams");
  try {
    readParams(new URL(String(request.url || "")).searchParams);
  } catch (error) {
  }
  const body = String(request.body || "").trim();
  if (body) {
    if (body === XIAOHONGSHU_COMMENT_TRUNCATED_BODY_MARKER || body.length > XIAOHONGSHU_COMMENT_IDENTITY_MAX_BODY_CHARACTERS) {
      truncated = true;
    } else {
      try {
        readParams(new URLSearchParams(body));
      } catch (error) {
      }
      try {
        const payload = JSON.parse(body);
        const bodyIds = [];
        const bodyState = collectXiaohongshuCommentNoteIdsFromValue(payload, bodyIds);
        truncated = truncated || Boolean(bodyState && bodyState.truncated);
        bodyIds.forEach(add);
      } catch (error) {
      }
    }
  }
  if (includePayload && request.payload && typeof request.payload === "object") {
    const payloadIds = [];
    const payloadState = collectXiaohongshuCommentNoteIdsFromValue(request.payload, payloadIds);
    truncated = truncated || Boolean(payloadState && payloadState.truncated);
    payloadIds.forEach(add);
  }
  return { ids, truncated };
}
__name(collectXiaohongshuCommentRequestNoteIds, "collectXiaohongshuCommentRequestNoteIds");
function classifyXiaohongshuCommentRequestIdentity(request = {}, expectedNoteId = "") {
  const expected = String(expectedNoteId || "").trim().toLowerCase();
  if (!expected) return "unbound";
  const requestUrl2 = String(request && request.url || "").trim();
  if (requestUrl2 && !isXiaohongshuCommentApiUrl(requestUrl2)) return "mismatched";
  const requestIdentity = collectXiaohongshuCommentRequestNoteIds(request, false);
  if (requestIdentity.truncated) return "mismatched";
  const requestIds = requestIdentity.ids;
  if (!requestIds.length) return "unidentified";
  if (!requestIds.every((id) => id === expected)) return "mismatched";
  const payloadIds = [];
  const payloadState = collectXiaohongshuCommentNoteIdsFromValue(request.payload, payloadIds);
  if (payloadState && payloadState.truncated) return "mismatched";
  if (payloadIds.length && !payloadIds.every((id) => id === expected)) return "mismatched";
  return "matched";
}
__name(classifyXiaohongshuCommentRequestIdentity, "classifyXiaohongshuCommentRequestIdentity");
async function fetchXiaohongshuCommentsFromCapturedRequests(commentApiRequests = [], limit = XIAOHONGSHU_ROOT_COMMENT_LIMIT, options = {}) {
  throwIfAborted(options.signal);
  const comments = [];
  const seen = /* @__PURE__ */ new Set();
  const deadlineAt = Number(options && options.deadlineAt) || Date.now() + XIAOHONGSHU_COMMENT_TIMEOUT_MS;
  const totalLimit = Math.max(1, Math.min(
    Number(options && options.totalLimit) || XIAOHONGSHU_TOTAL_COMMENT_LIMIT,
    XIAOHONGSHU_TOTAL_COMMENT_LIMIT
  ));
  const expectedNoteId = String(options && options.expectedNoteId || "").trim();
  if (!expectedNoteId) return [];
  const cookieHeader = await getXiaohongshuCookieHeader();
  throwIfAborted(options.signal);
  const uniqueRequests = [];
  const seenRequests = /* @__PURE__ */ new Set();
  (commentApiRequests || []).forEach((request) => {
    const url = String(request && request.url || "").trim();
    const method = String(request && request.method || "GET").toUpperCase();
    const body = String(request && request.body || "");
    const key = `${method}|${url}|${body}`;
    if (!isXiaohongshuCommentApiUrl(url) || classifyXiaohongshuCommentRequestIdentity({ url, body }, expectedNoteId) !== "matched" || seenRequests.has(key)) return;
    seenRequests.add(key);
    uniqueRequests.push(request);
  });
  for (const request of uniqueRequests.slice(-8)) {
    throwIfAborted(options.signal);
    const budget = getXiaohongshuCommentBudgetState({
      deadlineAt,
      totalCount: comments.length,
      limit: totalLimit
    });
    if (comments.length >= limit || budget.shouldStop) break;
    try {
      const response = await requestJsonViaNode({
        url: request.url,
        method: String(request.method || "GET").toUpperCase(),
        body: String(request.method || "GET").toUpperCase() === "GET" ? "" : String(request.body || ""),
        headers: sanitizeXiaohongshuCapturedHeaders(request.requestHeaders || {}, cookieHeader),
        timeout: Math.max(1, Math.min(XIAOHONGSHU_COMMENT_REQUEST_TIMEOUT_MS, budget.remainingMs)),
        maxBytes: XIAOHONGSHU_COMMENT_RESPONSE_MAX_BODY_CHARACTERS,
        signal: options.signal
      });
      throwIfAborted(options.signal);
      if (!response || response.status < 200 || response.status >= 300) continue;
      if (response.json) {
        if (classifyXiaohongshuCommentRequestIdentity({
          url: request.url,
          body: request.body,
          payload: response.json
        }, expectedNoteId) !== "matched") continue;
        extractCommentsFromObject(response.json, comments, seen, limit);
      } else if (response.text) {
        collectJsonObjectCandidates(response.text).forEach((candidate) => {
          const payload = parseLooseJsonCandidate(candidate);
          if (classifyXiaohongshuCommentRequestIdentity({
            url: request.url,
            body: request.body,
            payload
          }, expectedNoteId) === "matched") {
            extractCommentsFromObject(payload, comments, seen, limit);
          }
        });
      }
    } catch (error) {
      if (isAbortError(error) || options.signal && options.signal.aborted) {
        throw createAbortError();
      }
    }
  }
  throwIfAborted(options.signal);
  return comments.slice(0, limit);
}
__name(fetchXiaohongshuCommentsFromCapturedRequests, "fetchXiaohongshuCommentsFromCapturedRequests");
function extractHtmlTitle(html) {
  const ogTitle = String(html || "").match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (ogTitle && ogTitle[1]) {
    return decodeHtmlEntities(ogTitle[1]).trim();
  }
  const title = String(html || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return title && title[1] ? stripHtmlTags(title[1]) : "";
}
__name(extractHtmlTitle, "extractHtmlTitle");
function selectReadableHtml(html) {
  const source = String(html || "");
  const wechatContent = source.match(/<div[^>]+id=["']js_content["'][^>]*>([\s\S]*?)<\/div>\s*<script/i);
  if (wechatContent && wechatContent[1]) return wechatContent[1];
  const article = source.match(/<article[^>]*>([\s\S]*?)<\/article>/i);
  if (article && article[1]) return article[1];
  const main = source.match(/<main[^>]*>([\s\S]*?)<\/main>/i);
  if (main && main[1]) return main[1];
  const body = source.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return body && body[1] ? body[1] : source;
}
__name(selectReadableHtml, "selectReadableHtml");
function isWechatCaptchaHtml(html) {
  const text = stripHtmlTags(String(html || ""));
  return /环境异常/.test(text) && /完成验证后即可继续访问|去验证/.test(text);
}
__name(isWechatCaptchaHtml, "isWechatCaptchaHtml");
function buildWechatCaptchaMarkdown(url, html = "") {
  const targetUrl = cleanDisplayUrl(extractWechatCaptchaTargetUrl(url));
  const lines = [
    "公众号文章触发了微信安全验证。",
    "",
    "这不是插件解析失败，而是微信返回了验证页；插件不能自动绕过这个验证。",
    "",
    "建议处理方式：",
    "",
    "- 在微信内打开原文，完成验证后再复制正文保存。",
    "- 或从公众号文章页使用“选择小程序工具”打开本小程序保存。",
    ""
  ];
  if (targetUrl) {
    lines.push(`原始文章链接：${targetUrl}`, "");
  }
  lines.push(`验证页链接：${url || ""}`, "");
  const title = extractHtmlTitle(html);
  if (title && !/wappoc_appmsgcaptcha/i.test(title)) {
    lines.unshift(title, "");
  }
  return lines.join("\n").trim();
}
__name(buildWechatCaptchaMarkdown, "buildWechatCaptchaMarkdown");
function buildXiaohongshuFallbackMarkdown(url, reason = "") {
  return [
    "小红书链接已保存。",
    "",
    `原始链接：${url || ""}`,
    "",
    reason ? `> 小红书视频转写失败：${reason}` : "",
    "> 如果这是视频笔记且需要口播/音频文案，请从手机相册或文件导入视频；如果只是图文笔记，正文会在页面公开内容可访问时自动保存。"
  ].filter((line) => line !== "").join("\n");
}
__name(buildXiaohongshuFallbackMarkdown, "buildXiaohongshuFallbackMarkdown");
function buildDouyinFallbackMarkdown(url, reason = "") {
  return [
    "抖音链接已保存。",
    "",
    `原始链接：${url || ""}`,
    "",
    reason ? `> 抖音视频转写失败：${reason}` : "",
    "> 插件没有把该作品误认成其他平台；可以稍后重试，或从手机相册/文件导入视频继续转写。"
  ].filter((line) => line !== "").join("\n");
}
__name(buildDouyinFallbackMarkdown, "buildDouyinFallbackMarkdown");
function imageTagToMarkdown(tag) {
  const sourceMatch = String(tag || "").match(/\s(?:data-src|src)=["']([^"']+)["']/i);
  if (!sourceMatch || !sourceMatch[1]) return "";
  const altMatch = String(tag || "").match(/\salt=["']([^"']*)["']/i);
  const alt = altMatch && altMatch[1] ? stripHtmlTags(altMatch[1]) : "图片";
  return `

![${alt}](${decodeHtmlEntities(sourceMatch[1])})

`;
}
__name(imageTagToMarkdown, "imageTagToMarkdown");
function escapeMarkdownTableCell(value) {
  return decodeHtmlEntities(stripHtmlTags(value)).replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
}
__name(escapeMarkdownTableCell, "escapeMarkdownTableCell");
function htmlTableToMarkdown(tableHtml) {
  const rows = [];
  const rowPattern = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while (rowMatch = rowPattern.exec(String(tableHtml || ""))) {
    const cells = [];
    const cellPattern = /<(?:th|td)\b[^>]*>([\s\S]*?)<\/(?:th|td)>/gi;
    let cellMatch;
    while (cellMatch = cellPattern.exec(rowMatch[1] || "")) {
      cells.push(escapeMarkdownTableCell(cellMatch[1] || ""));
    }
    if (cells.some(Boolean)) rows.push(cells);
  }
  if (!rows.length) return stripHtmlTags(tableHtml);
  const columnCount = Math.max(...rows.map((row) => row.length));
  const normalizedRows = rows.map((row) => {
    const next = row.slice(0, columnCount);
    while (next.length < columnCount) next.push("");
    return next;
  });
  const header = normalizedRows[0];
  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...normalizedRows.slice(1).map((row) => `| ${row.join(" | ")} |`)
  ];
  return `

${lines.join("\n")}

`;
}
__name(htmlTableToMarkdown, "htmlTableToMarkdown");
function isBlankMarkdownLine(line) {
  return !String(line || "").trim();
}
__name(isBlankMarkdownLine, "isBlankMarkdownLine");
function findNextNonBlankLine(lines, startIndex) {
  for (let index = startIndex; index < lines.length; index += 1) {
    if (!isBlankMarkdownLine(lines[index])) return index;
  }
  return -1;
}
__name(findNextNonBlankLine, "findNextNonBlankLine");
function buildMarkdownTableFromRows(headers, rows) {
  return [
    `| ${headers.join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.join(" | ")} |`)
  ];
}
__name(buildMarkdownTableFromRows, "buildMarkdownTableFromRows");
function restoreFlattenedSarBandTables(lines) {
  const headers = ["频段", "频率", "波长", "应用方向"];
  const firstColumnPattern = /^(?:Ka|K|Ku|X|C|S|L|P)$/i;
  const out = [];
  for (let index = 0; index < lines.length; ) {
    const firstHeaderIndex = findNextNonBlankLine(lines, index);
    if (firstHeaderIndex !== index || lines[index] !== headers[0]) {
      out.push(lines[index]);
      index += 1;
      continue;
    }
    let cursor = index;
    let matchedHeaders = true;
    for (const header of headers) {
      const nextIndex = findNextNonBlankLine(lines, cursor);
      if (nextIndex < 0 || lines[nextIndex] !== header) {
        matchedHeaders = false;
        break;
      }
      cursor = nextIndex + 1;
    }
    if (!matchedHeaders) {
      out.push(lines[index]);
      index += 1;
      continue;
    }
    const rows = [];
    let rowCursor = cursor;
    while (rowCursor < lines.length) {
      const row = [];
      const indexes = [];
      let cellCursor = rowCursor;
      for (let cellIndex = 0; cellIndex < headers.length; cellIndex += 1) {
        const nextIndex = findNextNonBlankLine(lines, cellCursor);
        if (nextIndex < 0) break;
        row.push(String(lines[nextIndex] || "").trim());
        indexes.push(nextIndex);
        cellCursor = nextIndex + 1;
      }
      if (row.length !== headers.length || !firstColumnPattern.test(row[0])) break;
      rows.push(row);
      rowCursor = indexes[indexes.length - 1] + 1;
    }
    if (rows.length < 2) {
      out.push(lines[index]);
      index += 1;
      continue;
    }
    if (out.length && !isBlankMarkdownLine(out[out.length - 1])) out.push("");
    out.push(...buildMarkdownTableFromRows(headers, rows));
    out.push("");
    index = rowCursor;
  }
  return out;
}
__name(restoreFlattenedSarBandTables, "restoreFlattenedSarBandTables");
function htmlToMarkdown(html) {
  const sourceHtml = String(html || "");
  let readable = selectReadableHtml(sourceHtml).replace(/<[^>]+id=["']js_cmt_area["'][^>]*>[\s\S]*?(?=<script\b|<\/body>|$)/gi, "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<noscript[\s\S]*?<\/noscript>/gi, "").replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, (_, code) => htmlCodeBlockToMarkdown(code)).replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (table) => htmlTableToMarkdown(table)).replace(/<img\b[^>]*>/gi, imageTagToMarkdown).replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n").replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n").replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<\/div>/gi, "\n").replace(/<li[^>]*>/gi, "\n- ").replace(/<\/li>/gi, "").replace(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => {
    const text = stripHtmlTags(label);
    return text ? `[${text}](${decodeHtmlEntities(href)})` : decodeHtmlEntities(href);
  });
  readable = cleanMarkdownForStorage(stripHtmlTags(readable));
  if (readable.length < 20) {
    throw new Error("网页正文太短，无法转为 Markdown");
  }
  return readable;
}
__name(htmlToMarkdown, "htmlToMarkdown");
function getElectronBrowserWindow() {
  try {
    const electron = require("electron");
    return electron.remote && electron.remote.BrowserWindow || electron.BrowserWindow || null;
  } catch (error) {
    return null;
  }
}
__name(getElectronBrowserWindow, "getElectronBrowserWindow");
function getElectronRemote() {
  try {
    const electron = require("electron");
    return electron.remote || null;
  } catch (error) {
    return null;
  }
}
__name(getElectronRemote, "getElectronRemote");
function getWechatSession() {
  const remote = getElectronRemote();
  if (!remote) return null;
  try {
    return remote.session.fromPartition(WECHAT_SESSION_PARTITION);
  } catch (error) {
    return null;
  }
}
__name(getWechatSession, "getWechatSession");
async function readSessionFetchText(session, url, headers, timeoutMs = 12e3) {
  if (!session || typeof session.fetch !== "function" || !/^https?:\/\//i.test(String(url || ""))) return "";
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  let timer = null;
  const requestTask = (async () => {
    const response = await session.fetch(url, {
      method: "GET",
      headers,
      credentials: "include",
      redirect: "follow",
      ...controller ? { signal: controller.signal } : {}
    });
    return response && typeof response.text === "function" ? await response.text() : "";
  })();
  const timeoutTask = new Promise((_, reject) => {
    timer = setTimeout(() => {
      if (controller) controller.abort();
      reject(new Error(`Electron Session request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([requestTask, timeoutTask]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
__name(readSessionFetchText, "readSessionFetchText");
async function downloadArrayBufferViaElectronSession(url, headers = {}, options = {}, session = getWechatSession()) {
  if (!session || typeof session.fetch !== "function") {
    throw new Error("当前环境无法使用浏览器会话下载媒体");
  }
  throwIfAborted(options.signal);
  const timeoutMs = Math.max(100, Number(options.timeout) || 3e4);
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  const abortSessionRequest = /* @__PURE__ */ __name(() => {
    if (controller) controller.abort();
  }, "abortSessionRequest");
  if (options.signal && typeof options.signal.addEventListener === "function") {
    options.signal.addEventListener("abort", abortSessionRequest, { once: true });
  }
  let timer = null;
  const requestTask = (async () => {
    const response = await session.fetch(url, {
      method: "GET",
      headers,
      credentials: "include",
      redirect: "follow",
      ...controller ? { signal: controller.signal } : {}
    });
    if (!response || !response.ok) {
      throw new Error(`媒体下载失败：HTTP ${response ? response.status : 0}`);
    }
    return response.arrayBuffer();
  })();
  const timeoutTask = new Promise((_, reject) => {
    timer = setTimeout(() => {
      abortSessionRequest();
      reject(new Error(`浏览器会话媒体下载超时（${timeoutMs}ms）`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([requestTask, timeoutTask]);
  } finally {
    if (timer) clearTimeout(timer);
    if (options.signal && typeof options.signal.removeEventListener === "function") {
      options.signal.removeEventListener("abort", abortSessionRequest);
    }
    throwIfAborted(options.signal);
  }
}
__name(downloadArrayBufferViaElectronSession, "downloadArrayBufferViaElectronSession");
function isMediaAuthorizationError(error) {
  return /媒体下载失败：HTTP\s*(?:401|403)\b|\bHTTP\s*(?:401|403)\b/i.test(
    String(error && error.message || error || "")
  );
}
__name(isMediaAuthorizationError, "isMediaAuthorizationError");
function isMediaDownloadTimeoutError(error) {
  return /\bMEDIA_DOWNLOAD_TIMEOUT\b|media download (?:hard )?timeout|media download timeout/i.test(
    String(error && error.message || error || "")
  );
}
__name(isMediaDownloadTimeoutError, "isMediaDownloadTimeoutError");
function isRecoverableDouyinMediaDownloadError(error) {
  return isMediaAuthorizationError(error) || isMediaDownloadTimeoutError(error);
}
__name(isRecoverableDouyinMediaDownloadError, "isRecoverableDouyinMediaDownloadError");
function mergeDouyinDetailCandidates(current, incoming) {
  const previous = current && typeof current === "object" ? current : null;
  const next = incoming && typeof incoming === "object" ? incoming : null;
  if (!previous) return next;
  if (!next) return previous;
  const merged = { ...previous, ...next };
  const preferText = /* @__PURE__ */ __name((left, right) => {
    const first = String(left || "").trim();
    const second = String(right || "").trim();
    return second.length >= first.length ? second : first;
  }, "preferText");
  merged.desc = preferText(previous.desc || previous.description, next.desc || next.description);
  merged.title = preferText(previous.title, next.title);
  merged.video = {
    ...previous.video && typeof previous.video === "object" ? previous.video : {},
    ...next.video && typeof next.video === "object" ? next.video : {}
  };
  merged.statistics = {
    ...previous.statistics && typeof previous.statistics === "object" ? previous.statistics : {},
    ...next.statistics && typeof next.statistics === "object" ? next.statistics : {}
  };
  for (const key of ["text_extra", "cha_list"]) {
    const previousList = Array.isArray(previous[key]) ? previous[key] : [];
    const nextList = Array.isArray(next[key]) ? next[key] : [];
    const seen = /* @__PURE__ */ new Set();
    merged[key] = [...previousList, ...nextList].filter((item) => {
      const identity = String(
        item && (item.hashtag_name || item.hashtagName || item.cha_name || item.chaName || item.cid || item.id) || ""
      ).trim().toLowerCase() || JSON.stringify(item);
      if (seen.has(identity)) return false;
      seen.add(identity);
      return true;
    });
  }
  return merged;
}
__name(mergeDouyinDetailCandidates, "mergeDouyinDetailCandidates");
async function fetchDouyinMediaResolutionWithSession({
  pageUrl,
  awemeId,
  session = getWechatSession(),
  requestTimeoutMs = 12e3
}) {
  const target = normalizeDouyinTargetUrl(pageUrl, pageUrl);
  const id = String(awemeId || target.awemeId || "").trim();
  if (!session || typeof session.fetch !== "function" || !id || !target.url) {
    return { mediaUrls: [], detail: null };
  }
  try {
    await readSessionFetchText(session, target.url, getSocialRequestHeaders(target.url), requestTimeoutMs);
  } catch (error) {
  }
  let mediaUrls = [];
  let detail = null;
  for (const detailUrl of getDouyinAwemeDetailUrls(id)) {
    try {
      const text = await readSessionFetchText(session, detailUrl, getSocialRequestHeaders(detailUrl), requestTimeoutMs);
      const payload = JSON.parse(text || "{}");
      if (getDouyinDetailAwemeId(payload) !== id) continue;
      const urls = extractDouyinMediaUrlsFromDetailPayload(payload).filter((url) => /^https?:\/\//i.test(url));
      const nextDetail = findDouyinDetailForAweme(payload, id) || payload.aweme_detail || payload.awemeDetail || (Array.isArray(payload.item_list) ? payload.item_list[0] : null);
      mediaUrls = sortMediaUrlsForTranscription([...mediaUrls, ...urls]);
      detail = mergeDouyinDetailCandidates(detail, nextDetail);
    } catch (error) {
    }
  }
  return { mediaUrls, detail };
}
__name(fetchDouyinMediaResolutionWithSession, "fetchDouyinMediaResolutionWithSession");
async function fetchDouyinMediaUrlsWithSession(options = {}) {
  const resolution = await fetchDouyinMediaResolutionWithSession(options);
  return resolution.mediaUrls;
}
__name(fetchDouyinMediaUrlsWithSession, "fetchDouyinMediaUrlsWithSession");
function getXiaohongshuSession() {
  const remote = getElectronRemote();
  if (!remote) return null;
  try {
    return remote.session.fromPartition(XIAOHONGSHU_SESSION_PARTITION);
  } catch (error) {
    return null;
  }
}
__name(getXiaohongshuSession, "getXiaohongshuSession");
async function checkWechatLoginStatus() {
  const session = getWechatSession();
  if (!session) return false;
  try {
    const cookies = await session.cookies.get({ domain: "mp.weixin.qq.com" });
    return cookies.some((cookie) => cookie.name === "wap_sid2" || cookie.name === "wxuin");
  } catch (error) {
    return false;
  }
}
__name(checkWechatLoginStatus, "checkWechatLoginStatus");
async function checkFeishuLoginStatus() {
  const session = getWechatSession();
  if (!session) return false;
  try {
    const cookies = await session.cookies.get({ domain: ".feishu.cn" });
    return cookies.some((cookie) => cookie.name === "session" || cookie.name === "passport_web_did");
  } catch (error) {
    return false;
  }
}
__name(checkFeishuLoginStatus, "checkFeishuLoginStatus");
async function getXiaohongshuCookies() {
  const session = getXiaohongshuSession();
  if (!session) return [];
  try {
    const groups = await Promise.all([
      session.cookies.get({ domain: ".xiaohongshu.com" }),
      session.cookies.get({ domain: "www.xiaohongshu.com" })
    ]);
    const seen = /* @__PURE__ */ new Set();
    return groups.flat().filter((cookie) => cookie && cookie.name && !seen.has(cookie.name) && seen.add(cookie.name));
  } catch (error) {
    return [];
  }
}
__name(getXiaohongshuCookies, "getXiaohongshuCookies");
function hasXiaohongshuLoginCookies(cookies = []) {
  return (cookies || []).some((cookie) => {
    const name = String(cookie && cookie.name || "").trim();
    const value = String(cookie && cookie.value || "").trim();
    if (name !== "web_session") return false;
    if (!value || /^(?:null|undefined|deleted|expired)$/i.test(value)) return false;
    return value.length >= 8;
  });
}
__name(hasXiaohongshuLoginCookies, "hasXiaohongshuLoginCookies");
async function checkXiaohongshuLoginStatus() {
  const cookies = await getXiaohongshuCookies();
  return hasXiaohongshuLoginCookies(cookies);
}
__name(checkXiaohongshuLoginStatus, "checkXiaohongshuLoginStatus");
async function probeXiaohongshuLoginStatus(targetUrl = "", options = {}) {
  throwIfAborted(options.signal);
  const BrowserWindow = getElectronBrowserWindow();
  if (!BrowserWindow) {
    return await checkXiaohongshuLoginStatus();
  }
  const session = getXiaohongshuSession();
  if (!session) return false;
  const win = new BrowserWindow({
    width: 980,
    height: 820,
    show: false,
    webPreferences: {
      session,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  trackXiaohongshuBrowserWindow(win);
  installXiaohongshuNavigationGuards(win.webContents);
  const cleanupAbort = bindBrowserWindowToAbortSignal(win, options.signal);
  try {
    throwIfAborted(options.signal);
    const url = targetUrl || "https://www.xiaohongshu.com/";
    const loaded = waitForWebContents(win.webContents, 15e3);
    if (!beginBestEffortBrowserLoad(win, url)) return false;
    await loaded;
    throwIfAborted(options.signal);
    await new Promise((resolve) => setTimeout(resolve, 1200));
    throwIfAborted(options.signal);
    const state = await runBrowserTaskWithTimeout(
      win.webContents.executeJavaScript(`
      (async () => {
        const text = String(document.body && (document.body.innerText || document.body.textContent) || '').replace(/\\s+/g, ' ').trim();
        const hasLoginWall = /登录后|请登录|登录小红书|手机号登录|验证码登录|扫码登录|未登录/.test(text);
        const hasUserSignal = Boolean(document.querySelector('[href*="/user/profile"], [class*="avatar"], [class*="user-info"], [class*="userInfo"]'));
        let hasAccountApiSignal = false;
        try {
          const response = await fetch('https://edith.xiaohongshu.com/api/sns/web/v1/user/selfinfo', {
            credentials: 'include',
            headers: { accept: 'application/json, text/plain, */*' },
          });
          const payload = await response.clone().json().catch(async () => ({ text: await response.text().catch(() => '') }));
          const payloadText = JSON.stringify(payload || {});
          hasAccountApiSignal = response.ok && /user_?id|nickname|red_?id|avatar/i.test(payloadText) && !/login|登录|unauthorized|forbidden/i.test(payloadText);
        } catch (error) {}
        return { hasLoginWall, hasUserSignal, hasAccountApiSignal, text: text.slice(0, 500) };
      })()
      `),
      XIAOHONGSHU_BROWSER_SCRIPT_TIMEOUT_MS,
      "xiaohongshu-login-probe"
    );
    if (state && state.hasLoginWall) return false;
    const hasCookie = await checkXiaohongshuLoginStatus();
    return Boolean(hasCookie && state && (state.hasAccountApiSignal || state.hasUserSignal));
  } catch (error) {
    if (isAbortError(error)) throw error;
    return false;
  } finally {
    cleanupAbort();
    if (win && typeof win.destroy === "function") {
      win.destroy();
    }
  }
}
__name(probeXiaohongshuLoginStatus, "probeXiaohongshuLoginStatus");
async function getXiaohongshuCookieHeader() {
  const cookies = await getXiaohongshuCookies();
  return cookies.filter((cookie) => cookie && cookie.name && typeof cookie.value !== "undefined").map((cookie) => `${cookie.name}=${cookie.value}`).join("; ");
}
__name(getXiaohongshuCookieHeader, "getXiaohongshuCookieHeader");
async function getXiaohongshuRequestHeaders(url) {
  const headers = getSocialRequestHeaders(url);
  if (isTrustedXiaohongshuCookieUrl(url)) {
    const cookieHeader = await getXiaohongshuCookieHeader();
    if (cookieHeader) headers.Cookie = cookieHeader;
  }
  return headers;
}
__name(getXiaohongshuRequestHeaders, "getXiaohongshuRequestHeaders");
async function loginWechatWeb(articleUrl) {
  const BrowserWindow = getElectronBrowserWindow();
  if (!BrowserWindow) {
    throw new Error("当前 Obsidian 环境不支持浏览器窗口");
  }
  const session = getWechatSession();
  if (!session) {
    throw new Error("无法创建微信登录会话");
  }
  const loginUrl = articleUrl || "https://mp.weixin.qq.com/";
  return new Promise((resolve, reject) => {
    let settled = false;
    const win = new BrowserWindow({
      width: 820,
      height: 900,
      show: true,
      title: "微信扫码登录 — 登录后关闭窗口即可",
      webPreferences: {
        session,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    const finish = /* @__PURE__ */ __name(async (error) => {
      if (settled) return;
      settled = true;
      try {
        if (win && !win.isDestroyed()) {
          win.destroy();
        }
      } catch (destroyError) {
      }
      if (error) {
        reject(error);
        return;
      }
      const loggedIn = await checkWechatLoginStatus();
      resolve(loggedIn);
    }, "finish");
    win.on("closed", () => finish());
    win.webContents.on("did-finish-load", async () => {
      const loggedIn = await checkWechatLoginStatus();
      if (loggedIn) {
        finish();
      }
    });
    win.loadURL(loginUrl).catch((error) => {
      finish(new Error(`打开微信登录页面失败：${error.message || error}`));
    });
    setTimeout(() => {
      finish(new Error("微信登录超时（5分钟），请重试"));
    }, 5 * 60 * 1e3);
  });
}
__name(loginWechatWeb, "loginWechatWeb");
async function loginFeishuWeb(targetUrl) {
  const BrowserWindow = getElectronBrowserWindow();
  if (!BrowserWindow) {
    throw new Error("当前 Obsidian 环境不支持浏览器窗口");
  }
  const session = getWechatSession();
  if (!session) {
    throw new Error("无法创建飞书登录会话");
  }
  const loginUrl = targetUrl || "https://my.feishu.cn/";
  return new Promise((resolve, reject) => {
    let settled = false;
    const win = new BrowserWindow({
      width: 1040,
      height: 860,
      show: true,
      title: "飞书网页登录 - 登录后关闭窗口即可",
      webPreferences: {
        session,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    const finish = /* @__PURE__ */ __name(async (error) => {
      if (settled) return;
      settled = true;
      try {
        const destroyed = typeof win.isDestroyed === "function" ? win.isDestroyed() : false;
        if (win && typeof win.destroy === "function" && !destroyed) {
          win.destroy();
        }
      } catch (destroyError) {
      }
      if (error) {
        reject(error);
        return;
      }
      resolve(await checkFeishuLoginStatus());
    }, "finish");
    const timer = setInterval(async () => {
      try {
        await checkFeishuLoginStatus();
      } catch (error) {
      }
    }, 1500);
    win.on("closed", async () => {
      clearInterval(timer);
      finish();
    });
    win.loadURL(loginUrl).catch((error) => {
      clearInterval(timer);
      finish(error);
    });
  });
}
__name(loginFeishuWeb, "loginFeishuWeb");
function buildXiaohongshuLoginPageConfig(targetUrl = "") {
  const loginUrl = String(targetUrl || "https://www.xiaohongshu.com/").trim();
  const userAgent = String(getSocialRequestHeaders(loginUrl)["User-Agent"] || "").trim();
  return { loginUrl, userAgent };
}
__name(buildXiaohongshuLoginPageConfig, "buildXiaohongshuLoginPageConfig");
function isAbortedBrowserNavigationError(error) {
  const code = error && error.code;
  const errno = error && error.errno;
  if (Number(code) === -3 || Number(errno) === -3) return true;
  const message = String(error && (error.message || error) || "");
  return /ERR_ABORTED/i.test(`${String(code || "")} ${message}`);
}
__name(isAbortedBrowserNavigationError, "isAbortedBrowserNavigationError");
async function loginXiaohongshuWeb(targetUrl) {
  if (activeXiaohongshuLoginPromise) {
    return await activeXiaohongshuLoginPromise;
  }
  const BrowserWindow = getElectronBrowserWindow();
  if (!BrowserWindow) {
    throw new Error("当前 Obsidian 环境不支持浏览器窗口");
  }
  const session = getXiaohongshuSession();
  if (!session) {
    throw new Error("无法创建小红书登录会话");
  }
  const { loginUrl, userAgent } = buildXiaohongshuLoginPageConfig(targetUrl);
  const loginPromise = new Promise((resolve, reject) => {
    let settled = false;
    const win = new BrowserWindow({
      width: 1040,
      height: 860,
      show: true,
      title: "小红书网页登录 - 登录后关闭窗口即可",
      webPreferences: {
        session,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    trackXiaohongshuBrowserWindow(win);
    installXiaohongshuLoginWindowGuards(win.webContents);
    const finish = /* @__PURE__ */ __name(async (error) => {
      if (settled) return;
      settled = true;
      try {
        const destroyed = typeof win.isDestroyed === "function" ? win.isDestroyed() : false;
        if (win && typeof win.destroy === "function" && !destroyed) {
          win.destroy();
        }
      } catch (destroyError) {
      }
      if (error) {
        reject(error);
        return;
      }
      resolve(await probeXiaohongshuLoginStatus(loginUrl));
    }, "finish");
    if (win.webContents && typeof win.webContents.setUserAgent === "function" && userAgent) {
      win.webContents.setUserAgent(userAgent);
    }
    win.on("closed", async () => {
      finish();
    });
    win.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
      if (isMainFrame === false || isAbortedBrowserNavigationError({ code: errorCode, message: errorDescription })) return;
      finish(new Error(`打开小红书登录页面失败（${errorCode}）：${errorDescription || "未知错误"}`));
    });
    win.loadURL(loginUrl, { userAgent }).catch((error) => {
      if (isAbortedBrowserNavigationError(error)) return;
      finish(new Error(`打开小红书登录页面失败：${error.message || error}`));
    });
  });
  activeXiaohongshuLoginPromise = loginPromise;
  try {
    return await loginPromise;
  } finally {
    if (activeXiaohongshuLoginPromise === loginPromise) {
      activeXiaohongshuLoginPromise = null;
    }
  }
}
__name(loginXiaohongshuWeb, "loginXiaohongshuWeb");
function getElectronShell() {
  const candidates = [];
  if (typeof require === "function") candidates.push(require);
  if (typeof window !== "undefined" && typeof window.require === "function") candidates.push(window.require.bind(window));
  if (typeof globalThis !== "undefined" && typeof globalThis.require === "function") candidates.push(globalThis.require.bind(globalThis));
  for (const load of candidates) {
    try {
      const electron = load("electron");
      const shell = electron && (electron.remote && electron.remote.shell || electron.shell);
      if (shell && typeof shell.openExternal === "function") {
        return shell;
      }
    } catch (error) {
    }
  }
  return null;
}
__name(getElectronShell, "getElectronShell");
async function openExternalUrl(url) {
  const shell = getElectronShell();
  if (shell) {
    try {
      await shell.openExternal(url);
      return true;
    } catch (error) {
    }
  }
  try {
    if (typeof window !== "undefined" && window.open) {
      const opened = window.open(url, "_blank", "noopener");
      if (opened) {
        return true;
      }
    }
  } catch (error) {
  }
  try {
    if (typeof window !== "undefined" && window.location && typeof window.location.assign === "function") {
      window.location.assign(url);
      return true;
    }
  } catch (error) {
  }
  return false;
}
__name(openExternalUrl, "openExternalUrl");
function waitForWebContents(webContents, timeoutMs = 15e3) {
  return new Promise((resolve) => {
    let done = false;
    const finish = /* @__PURE__ */ __name(() => {
      if (done) return;
      done = true;
      resolve();
    }, "finish");
    const timer = window.setTimeout(finish, timeoutMs);
    webContents.once("did-finish-load", () => {
      window.clearTimeout(timer);
      window.setTimeout(finish, 2500);
    });
    webContents.once("did-fail-load", () => {
      window.clearTimeout(timer);
      finish();
    });
  });
}
__name(waitForWebContents, "waitForWebContents");
async function renderUrlToMarkdownWithElectron(url) {
  const BrowserWindow = getElectronBrowserWindow();
  if (!BrowserWindow) {
    throw new Error("当前 Obsidian 环境不支持隐藏浏览器渲染");
  }
  const wechatSession = isXiaohongshuUrl(url) ? getXiaohongshuSession() : getWechatSession();
  const win = new BrowserWindow({
    width: 1280,
    height: 1600,
    show: false,
    webPreferences: {
      session: wechatSession || void 0,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  if (isXiaohongshuUrl(url)) {
    trackXiaohongshuBrowserWindow(win);
  }
  try {
    const loaded = waitForWebContents(win.webContents);
    await win.loadURL(url);
    await loaded;
    const result = await win.webContents.executeJavaScript(`
      (async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const clean = (text) => String(text || '').replace(/\\u00a0/g, ' ').replace(/[ \\t]+\\n/g, '\\n').replace(/\\n{3,}/g, '\\n\\n').trim();
        const isLoginPage = () => /accounts\\/(?:page\\/login|trap)|login\\.feishu\\.cn/i.test(location.href)
          || /扫码登录|登录飞书|Login Required/i.test(clean(document.body ? document.body.innerText || document.body.textContent || '' : ''));
        const getPathToken = () => {
          const match = String(location.pathname || '').match(/\\/(?:docx|wiki)\\/([^/?#]+)/i);
          return match ? decodeURIComponent(match[1]) : '';
        };
        const getFeishuClientVars = async () => {
          const token = getPathToken();
          const candidates = [
            window.DATA && window.DATA.clientVars && window.DATA.clientVars.data,
            window.DATA && token && window.DATA[token] && window.DATA[token].CLIENT_VARS && window.DATA[token].CLIENT_VARS.data,
            window.SERVER_DATA && window.SERVER_DATA.clientVars && window.SERVER_DATA.clientVars.data,
            window.SERVER_RUNTIME_DATA && window.SERVER_RUNTIME_DATA.clientVars && window.SERVER_RUNTIME_DATA.clientVars.data,
          ].filter(Boolean);
          const existing = candidates.find((item) => item && (item.block_map || item.blockMap));
          if (existing) return existing;
          if (!token || isLoginPage()) return null;
          try {
            const response = await fetch('/space/api/docx/pages/client_vars?id=' + encodeURIComponent(token), {
              credentials: 'include',
              headers: { accept: 'application/json, text/plain, */*' },
            });
            const json = await response.json();
            if (json && json.code && json.code !== 0) return null;
            return json && json.data ? json.data : json;
          } catch (error) {
            return null;
          }
        };
        const imageAssets = [];
        const imageToMarkdown = (img) => {
          const src = img.currentSrc || img.src || img.getAttribute('data-src') || '';
          if (!src) return '';
          const width = Number(img.naturalWidth || img.width || 0);
          const height = Number(img.naturalHeight || img.height || 0);
          const className = String(img.className || '');
          if ((width && height && (width < 80 || height < 80)) || /avatar|portrait|icon|logo/i.test(className)) return '';
          const alt = img.alt || '图片';
          imageAssets.push({ src, alt, width, height });
          return '\\n\\n![' + alt + '](' + src + ')\\n\\n';
        };
        const mediaToMarkdown = (node) => {
          const tag = String(node && node.tagName || '').toLowerCase();
          const label = tag === 'audio' ? '音频文件' : '视频文件';
          const urls = [];
          const push = (value) => {
            const src = String(value || '').trim();
            if (!src || /^blob:/i.test(src) || urls.includes(src)) return;
            urls.push(src);
          };
          push(node.currentSrc || node.src || node.getAttribute('src') || node.getAttribute('data-src') || '');
          if (node.querySelectorAll) {
            node.querySelectorAll('source').forEach((source) => push(source.src || source.getAttribute('src') || ''));
          }
          return urls.map((src, index) => '\\n\\n[' + label + (urls.length > 1 ? ' ' + (index + 1) : '') + '](' + src + ')\\n\\n').join('');
        };
        const tableToMarkdown = (table) => {
          const rows = Array.from(table.querySelectorAll('tr')).map((row) => {
            return Array.from(row.children)
              .filter((cell) => ['th', 'td'].includes(String(cell.tagName || '').toLowerCase()))
              .map((cell) => clean(cell.innerText || cell.textContent || '').replace(/\\|/g, '\\\\|'));
          }).filter((row) => row.some(Boolean));
          if (!rows.length) return '';
          const columnCount = Math.max(...rows.map((row) => row.length));
          const normalizedRows = rows.map((row) => {
            const next = row.slice(0, columnCount);
            while (next.length < columnCount) next.push('');
            return next;
          });
          const header = normalizedRows[0];
          return '\\n\\n| ' + header.join(' | ') + ' |\\n'
            + '| ' + header.map(() => '---').join(' | ') + ' |\\n'
            + normalizedRows.slice(1).map((row) => '| ' + row.join(' | ') + ' |').join('\\n')
            + '\\n\\n';
        };
        const blockToMarkdown = (node) => {
          if (!node) return '';
          if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
          if (node.nodeType !== Node.ELEMENT_NODE) return '';
          if (node.closest && node.closest('#js_cmt_area')) return '';
          const tag = node.tagName.toLowerCase();
          if (tag === 'script' || tag === 'style' || tag === 'noscript') return '';
          if (tag === 'img') return imageToMarkdown(node);
          if (tag === 'video' || tag === 'audio' || tag === 'source') return mediaToMarkdown(node);
          if (tag === 'table') return tableToMarkdown(node);
          if (tag === 'pre' || tag === 'code') {
            const code = String(node.innerText || node.textContent || '').replace(/\\u00a0/g, ' ').replace(/^\\n+|\\n+$/g, '');
            const fence = String.fromCharCode(96, 96, 96);
            return code.trim() ? '\\n\\n' + fence + '\\n' + code + '\\n' + fence + '\\n\\n' : '';
          }
          const childText = Array.from(node.childNodes).map(blockToMarkdown).join('');
          if (/^h[1-6]$/.test(tag)) return '\\n' + '#'.repeat(Number(tag[1])) + ' ' + clean(childText) + '\\n';
          if (tag === 'li') return '\\n- ' + clean(childText);
          if (['p', 'div', 'section', 'article', 'main', 'blockquote', 'tr'].includes(tag)) return '\\n' + childText + '\\n';
          if (tag === 'br') return '\\n';
          return childText;
        };
        const seen = new Set();
        const collected = [];
        const collectVisibleBlocks = () => {
          const blocks = [];
          const candidates = Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,table,video,audio,source,[data-block-id],[data-block-type],[class*="block"],[class*="paragraph"],[class*="docx"],[class*="text"]'));
          candidates.forEach((node) => {
            const text = clean(node.innerText || node.textContent || '');
            if (!text || text.length < 2 || seen.has(text)) return;
            seen.add(text);
            const markdown = clean(blockToMarkdown(node));
            if (markdown) {
              blocks.push(markdown);
              collected.push(markdown);
            }
          });
          return clean(blocks.join('\\n\\n'));
        };
        const scrollables = () => Array.from(document.querySelectorAll('[class*="scroll"], [class*="container"], [class*="content"], [class*="doc"], main, body, html'))
          .filter((node) => {
            try { return node && node.scrollHeight > node.clientHeight + 20; } catch (error) { return false; }
          });
        collectVisibleBlocks();
        for (let index = 0; index < 36; index += 1) {
          const before = Math.max(
            document.documentElement ? document.documentElement.scrollHeight : 0,
            document.body ? document.body.scrollHeight : 0
          );
          window.scrollBy(0, Math.max(500, Math.floor(window.innerHeight * 0.85)));
          scrollables().forEach((node) => {
            try { node.scrollTop = Math.min(node.scrollTop + Math.max(500, Math.floor(node.clientHeight * 0.85)), node.scrollHeight); } catch (error) {}
          });
          await sleep(500);
          collectVisibleBlocks();
          const after = Math.max(
            document.documentElement ? document.documentElement.scrollHeight : 0,
            document.body ? document.body.scrollHeight : 0
          );
          const atDocumentBottom = window.innerHeight + window.scrollY >= after - 8;
          const atScrollableBottom = scrollables().every((node) => {
            try { return node.scrollTop + node.clientHeight >= node.scrollHeight - 8; } catch (error) { return true; }
          });
          if (atDocumentBottom && atScrollableBottom && Math.abs(after - before) < 20) break;
        }
        const selectors = [
          '[data-testid*="doc"]',
          '[data-docx-has-block-data]',
          '[data-page-id]',
          '[data-block-id]',
          '[class*="docx"]',
          '[class*="suite"]',
          '[class*="wiki"]',
          '[class*="editor"]',
          'article',
          'main',
          'body'
        ];
        const candidates = selectors.map((selector) => document.querySelector(selector)).filter(Boolean);
        const root = candidates.sort((a, b) => (b.innerText || '').length - (a.innerText || '').length)[0] || document.body;
        const byBlocks = clean(collected.join('\\n\\n'));
        const byRoot = clean(blockToMarkdown(root));
        const markdown = byBlocks.length > byRoot.length * 0.6 ? byBlocks : byRoot;
        const toDataUrl = (blob) => new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(reader.error || new Error('image read failed'));
          reader.readAsDataURL(blob);
        });
        const uniqueAssets = [];
        const seenAssets = new Set();
        for (const asset of imageAssets) {
          if (!asset.src || seenAssets.has(asset.src)) continue;
          seenAssets.add(asset.src);
          const next = { src: asset.src, alt: asset.alt || '图片' };
          if (asset.src.startsWith('blob:')) {
            try {
              const blob = await fetch(asset.src).then((response) => response.blob());
              next.dataUrl = await toDataUrl(blob);
            } catch (error) {}
          } else if (asset.src.startsWith('data:')) {
            next.dataUrl = asset.src;
          } else if (/feishu.cn|feishu.net|internal-api-drive-stream/i.test(asset.src)) {
            try {
              const blob = await fetch(asset.src, { credentials: 'include' }).then((response) => response.blob());
              if (blob && blob.size && /^image//i.test(blob.type || '')) {
                next.dataUrl = await toDataUrl(blob);
              }
            } catch (error) {}
          }
          uniqueAssets.push(next);
        }
        return {
          title: document.title || '',
          markdown,
          needsLogin: isLoginPage(),
          clientVars: await getFeishuClientVars(),
          assets: uniqueAssets,
        };
      })()
    `);
    if (result && result.needsLogin) {
      throw new Error("飞书页面需要授权后才能完整提取。请在插件设置中点击“连接飞书官方 API”，授权后再同步。");
    }
    let __feishuDiag = "no-clientVars";
    if (result && result.clientVars) {
      try {
        const cv = result.clientVars;
        const bm = cv.block_map || cv.blockMap || {};
        const cvBlockCount = Object.keys(bm).length;
        const seqLen = Array.isArray(cv.block_sequence) ? cv.block_sequence.length : -1;
        const clientVarsMarkdown = extractFeishuMarkdownFromClientVars(cv);
        const renderedLen = String(result.markdown || "").length;
        result.markdown = mergeFeishuRenderedAndClientVarsMarkdown(result.markdown, clientVarsMarkdown);
        __feishuDiag = `cv:ok bm=${cvBlockCount} seq=${seqLen} rendered=${renderedLen} structured=${clientVarsMarkdown.length} merged=${result.markdown.length}`;
      } catch (error) {
        __feishuDiag = `cv:fail ${error.message}`;
      }
    }
    result.__feishuDiag = __feishuDiag;
    if (!result || !result.markdown || result.markdown.length < 20) {
      throw new Error("隐藏浏览器未读取到足够正文");
    }
    return result;
  } finally {
    if (win && typeof win.destroy === "function") {
      win.destroy();
    }
  }
}
__name(renderUrlToMarkdownWithElectron, "renderUrlToMarkdownWithElectron");
async function renderFeishuUrlToSimpleMarkdownWithElectron(url) {
  const BrowserWindow = getElectronBrowserWindow();
  if (!BrowserWindow) {
    throw new Error("当前 Obsidian 环境不支持隐藏浏览器渲染");
  }
  const wechatSession = getWechatSession();
  const win = new BrowserWindow({
    width: 1280,
    height: 1600,
    show: false,
    webPreferences: {
      session: wechatSession || void 0,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  try {
    const loaded = waitForWebContents(win.webContents);
    await win.loadURL(url);
    await loaded;
    const result = await win.webContents.executeJavaScript(`
      (async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const clean = (text) => String(text || '')
          .replace(/\\u00a0/g, ' ')
          .replace(/[ \\t]+/g, ' ')
          .trim();
        const isLoginPage = () => /accounts\\/(?:page\\/login|trap)|login\\.feishu\\.cn/i.test(location.href)
          || /扫码登录|登录飞书|Login Required/i.test(document.body ? String(document.body.innerText || document.body.textContent || '') : '');
        const getPathToken = () => {
          const match = String(location.pathname || '').match(/\\/(?:docx|wiki)\\/([^/?#]+)/i);
          return match ? decodeURIComponent(match[1]) : '';
        };
        const getFeishuClientVars = async () => {
          const token = getPathToken();
          const candidates = [
            window.DATA && window.DATA.clientVars && window.DATA.clientVars.data,
            window.DATA && token && window.DATA[token] && window.DATA[token].CLIENT_VARS && window.DATA[token].CLIENT_VARS.data,
            window.SERVER_DATA && window.SERVER_DATA.clientVars && window.SERVER_DATA.clientVars.data,
            window.SERVER_RUNTIME_DATA && window.SERVER_RUNTIME_DATA.clientVars && window.SERVER_RUNTIME_DATA.clientVars.data,
          ].filter(Boolean);
          const existing = candidates.find((item) => item && (item.block_map || item.blockMap));
          if (existing) return existing;
          if (!token || isLoginPage()) return null;
          try {
            const response = await fetch('/space/api/docx/pages/client_vars?id=' + encodeURIComponent(token), {
              credentials: 'include',
              headers: { accept: 'application/json, text/plain, */*' },
            });
            const json = await response.json();
            if (json && json.code && json.code !== 0) return null;
            return json && json.data ? json.data : json;
          } catch (error) {
            return null;
          }
        };
        const lines = [];
        const seenLines = new Set();
        const imageAssets = [];
        const seenImages = new Set();
        const pushLine = (value) => {
          const text = clean(value);
          if (!text || text.length < 2 || seenLines.has(text)) return;
          seenLines.add(text);
          lines.push(text);
        };
        const pushImage = (img) => {
          try {
            const src = img.currentSrc || img.src || img.getAttribute('data-src') || '';
            if (!src || seenImages.has(src)) return;
            const width = Number(img.naturalWidth || img.width || 0);
            const height = Number(img.naturalHeight || img.height || 0);
            const className = String(img.className || '');
            if ((width && height && (width < 80 || height < 80)) || /avatar|portrait|icon|logo/i.test(className)) return;
            seenImages.add(src);
            const alt = clean(img.alt || '图片') || '图片';
            imageAssets.push({ src, alt, width, height });
            lines.push('![' + alt + '](' + src + ')');
          } catch (error) {}
        };
        const feishuTableSeen = new Set();
        const collectFeishuTables = () => {
          // 飞书 docx 表格在 DOM 里是 <table>，innerText 会把单元格打散成散落文本。
          // 先从 DOM 提取 <table> 转 markdown 表格，标记已处理的表格节点，避免重复。
          document.querySelectorAll('table').forEach((tableEl) => {
            if (feishuTableSeen.has(tableEl)) return;
            feishuTableSeen.add(tableEl);
            const tableHtml = tableEl.outerHTML || '';
            if (!tableHtml) return;
            // 复用公众号路径的 htmlTableToMarkdown 逻辑（正则解析 tr/td/th）
            const md = (function (html) {
              const rows = [];
              const rowPattern = /<tr\\b[^>]*>([\\s\\S]*?)<\\/tr>/gi;
              let rowMatch;
              while ((rowMatch = rowPattern.exec(html))) {
                const cells = [];
                const cellPattern = /<(?:th|td)\\b[^>]*>([\\s\\S]*?)<\\/(?:th|td)>/gi;
                let cellMatch;
                while ((cellMatch = cellPattern.exec(rowMatch[1] || ''))) {
                  const cellText = String(cellMatch[1] || '').replace(/<[^>]+>/g, '').replace(/\\s+/g, ' ').trim().replace(/\\|/g, '\\\\|');
                  cells.push(cellText);
                }
                if (cells.some(Boolean)) rows.push(cells);
              }
              if (!rows.length) return '';
              const colCount = Math.max.apply(null, rows.map(function (r) { return r.length; }));
              const norm = rows.map(function (r) { var n = r.slice(0, colCount); while (n.length < colCount) n.push(''); return n; });
              var header = norm[0];
              var lines = ['| ' + header.join(' | ') + ' |', '| ' + header.map(function () { return '---'; }).join(' | ') + ' |'];
              for (var i = 1; i < norm.length; i++) lines.push('| ' + norm[i].join(' | ') + ' |');
              return lines.join('\\n');
            })(tableHtml);
            if (md) lines.push(md);
          });
        };
        const collect = () => {
          // 先提取表格（结构化），再提取纯文本和图片
          collectFeishuTables();
          const bodyText = document.body ? String(document.body.innerText || document.body.textContent || '') : '';
          bodyText.split(/\\n+/).forEach(pushLine);
          document.querySelectorAll('img').forEach(pushImage);
        };
        const getMainScrollTarget = () => {
          const selectors = [
            '[class*="scroll"]',
            '[class*="container"]',
            '[class*="content"]',
            '[class*="doc"]',
            '[class*="Doc"]',
            '[class*="editor"]',
            '[data-docx-has-block-data]',
            '[data-page-id]',
            'main',
            'article',
            'body',
            'html',
          ];
          const candidates = [];
          selectors.forEach((selector) => {
            try {
              document.querySelectorAll(selector).forEach((node) => {
                if (!node || candidates.includes(node)) return;
                const scrollRange = Number(node.scrollHeight || 0) - Number(node.clientHeight || 0);
                if (scrollRange <= 20) return;
                const textLength = String(node.innerText || node.textContent || '').length;
                candidates.push({ node, scrollRange, textLength });
              });
            } catch (error) {}
          });
          candidates.sort((a, b) => {
            const aScore = a.scrollRange + Math.min(a.textLength, 20000);
            const bScore = b.scrollRange + Math.min(b.textLength, 20000);
            return bScore - aScore;
          });
          return candidates.length ? candidates[0].node : (document.scrollingElement || document.documentElement || document.body);
        };
        collect();
        let stableRounds = 0;
        let lastSignature = '';
        for (let index = 0; index < 300; index += 1) {
          const beforeCount = lines.length;
          const target = getMainScrollTarget();
          const beforeTop = target ? Number(target.scrollTop || 0) : Number(window.scrollY || 0);
          const step = Math.max(480, Math.floor((target && target.clientHeight ? target.clientHeight : window.innerHeight || 900) * 0.72));
          try {
            if (target && target !== document.body && target !== document.documentElement && target !== document.scrollingElement) {
              target.scrollTop = Math.min(Number(target.scrollTop || 0) + step, Number(target.scrollHeight || 0));
            } else {
              window.scrollBy(0, step);
            }
          } catch (error) {
            window.scrollBy(0, step);
          }
          await sleep(index < 12 ? 700 : 380);
          collect();
          const afterTop = target ? Number(target.scrollTop || 0) : Number(window.scrollY || 0);
          const atBottom = target
            ? afterTop + Number(target.clientHeight || window.innerHeight || 0) >= Number(target.scrollHeight || 0) - 12
            : true;
          const tail = lines.slice(-24).join('\\n');
          const signature = String(lines.length) + ':' + tail;
          if (signature === lastSignature || (lines.length === beforeCount && Math.abs(afterTop - beforeTop) < 8 && atBottom)) stableRounds += 1;
          else stableRounds = 0;
          lastSignature = signature;
          if (stableRounds >= 20) break;
        }
        const toDataUrl = (blob) => new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ''));
          reader.onerror = () => reject(reader.error || new Error('image read failed'));
          reader.readAsDataURL(blob);
        });
        const uniqueAssets = [];
        for (const asset of imageAssets) {
          const next = { src: asset.src, alt: asset.alt || '图片' };
          if (asset.src.startsWith('data:')) {
            next.dataUrl = asset.src;
          } else if (/feishu\\.cn|feishu\\.net|internal-api-drive-stream/i.test(asset.src)) {
            try {
              const blob = await fetch(asset.src, { credentials: 'include' }).then((response) => response.blob());
              if (blob && blob.size && /^image\\//i.test(blob.type || '')) {
                next.dataUrl = await toDataUrl(blob);
              }
            } catch (error) {}
          }
          uniqueAssets.push(next);
        }
        return {
          title: document.title || '',
          markdown: lines.join('\\n'),
          needsLogin: isLoginPage(),
          clientVars: await getFeishuClientVars(),
          assets: uniqueAssets,
        };
      })()
    `);
    if (result && result.needsLogin) {
      throw new Error("飞书页面需要授权后才能完整提取。请在插件设置中点击“连接飞书官方 API”，授权后再同步。");
    }
    let __feishuDiag = "no-clientVars";
    if (result && result.clientVars) {
      try {
        const cv = result.clientVars;
        const bm = cv.block_map || cv.blockMap || {};
        const cvBlockCount = Object.keys(bm).length;
        const seqLen = Array.isArray(cv.block_sequence) ? cv.block_sequence.length : -1;
        const clientVarsMarkdown = extractFeishuMarkdownFromClientVars(cv);
        const renderedLen = String(result.markdown || "").length;
        result.markdown = mergeFeishuRenderedAndClientVarsMarkdown(result.markdown, clientVarsMarkdown);
        __feishuDiag = `cv:ok bm=${cvBlockCount} seq=${seqLen} rendered=${renderedLen} structured=${clientVarsMarkdown.length} merged=${result.markdown.length}`;
      } catch (error) {
        __feishuDiag = `cv:fail ${error.message}`;
      }
    }
    result.__feishuDiag = __feishuDiag;
    if (!result || !result.markdown || result.markdown.length < 20) {
      throw new Error("隐藏浏览器未读取到足够正文");
    }
    return result;
  } finally {
    if (win && typeof win.destroy === "function") {
      win.destroy();
    }
  }
}
__name(renderFeishuUrlToSimpleMarkdownWithElectron, "renderFeishuUrlToSimpleMarkdownWithElectron");
async function renderSocialMediaUrlsWithElectron(url, options = {}) {
  throwIfAborted(options.signal);
  if (isXiaohongshuUrl(url) && options.__xiaohongshuSessionLockHeld !== true) {
    return await runWithXiaohongshuBrowserSessionLock(() => renderSocialMediaUrlsWithElectron(url, {
      ...options,
      __xiaohongshuSessionLockHeld: true
    }), options.signal);
  }
  const BrowserWindow = getElectronBrowserWindow();
  if (!BrowserWindow) {
    throw new Error("Current Obsidian environment does not support hidden browser rendering");
  }
  const wechatSession = isXiaohongshuUrl(url) ? getXiaohongshuSession() : getWechatSession();
  if (isDouyinUrl(url)) {
    await installDouyinExternalProtocolHandlers(wechatSession);
  }
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    webPreferences: {
      session: wechatSession || void 0,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  if (isXiaohongshuUrl(url)) {
    trackXiaohongshuBrowserWindow(win);
  }
  const cleanupAbort = isXiaohongshuUrl(url) ? bindBrowserWindowToAbortSignal(win, options.signal) : () => {
  };
  const capturedRequests = [];
  const targetDouyinAwemeId = isDouyinUrl(url) ? extractDouyinAwemeId(url) : "";
  const blockXiaohongshuCommentRequests = isXiaohongshuUrl(url) && options.includeComments === false;
  const browserSession = win.webContents && win.webContents.session || wechatSession;
  const installedWebRequestHandlers = [];
  const debuggerApi = targetDouyinAwemeId && win.webContents && win.webContents.debugger;
  const debuggerResponseRequests = /* @__PURE__ */ new Map();
  const debuggerBodyTasks = [];
  const debuggerMediaUrls = [];
  let debuggerAttached = false;
  let debuggerMessageHandler = null;
  const captureWebRequestDetails = /* @__PURE__ */ __name((details) => {
    if (capturedRequests.length >= BROWSER_MEDIA_CAPTURE_MAX_REQUESTS) return;
    capturedRequests.push({
      url: details && details.url,
      redirectURL: details && (details.redirectURL || details.redirectUrl),
      resourceType: details && details.resourceType
    });
  }, "captureWebRequestDetails");
  const installWebRequestHandler = /* @__PURE__ */ __name((method, listener) => {
    try {
      if (!browserSession || !browserSession.webRequest || typeof browserSession.webRequest[method] !== "function") return;
      browserSession.webRequest[method]({ urls: ["<all_urls>"] }, listener);
      installedWebRequestHandlers.push(method);
    } catch (error) {
    }
  }, "installWebRequestHandler");
  installWebRequestHandler("onBeforeRequest", (details, callback) => {
    captureWebRequestDetails(details);
    if (typeof callback === "function") {
      callback(
        isXiaohongshuUrl(url) && shouldBlockXiaohongshuBrowserNavigationRequest(details) || blockXiaohongshuCommentRequests && isXiaohongshuCommentApiUrl(details && details.url) || shouldBlockExternalAppUrl(details && details.url) ? { cancel: true } : {}
      );
    }
  });
  installWebRequestHandler("onBeforeRedirect", captureWebRequestDetails);
  installWebRequestHandler("onCompleted", captureWebRequestDetails);
  if (isXiaohongshuUrl(url)) {
    installXiaohongshuNavigationGuards(win.webContents);
  } else {
    installExternalAppNavigationGuards(win.webContents);
  }
  if (debuggerApi && typeof debuggerApi.attach === "function" && typeof debuggerApi.sendCommand === "function") {
    try {
      if (!debuggerApi.isAttached || !debuggerApi.isAttached()) {
        debuggerApi.attach("1.3");
        debuggerAttached = true;
      }
      enableDebuggerNetworkCapture(debuggerApi);
      debuggerMessageHandler = /* @__PURE__ */ __name((_event, method, params = {}) => {
        try {
          if (method === "Network.responseReceived") {
            const response = params.response || {};
            const responseUrl = String(response.url || "").trim();
            const responseType = String(params.type || "").toLowerCase();
            const mimeType = String(response.mimeType || "").toLowerCase();
            const isJsonCandidate = responseType === "xhr" || responseType === "fetch" || mimeType.includes("json") || /\/aweme\/|\/feed(?:[/?]|$)|\/detail(?:[/?]|$)/i.test(responseUrl);
            if (params.requestId && isDouyinUrl(responseUrl) && isJsonCandidate && debuggerResponseRequests.size < 120) {
              debuggerResponseRequests.set(params.requestId, responseUrl);
            }
          }
          if (method === "Network.loadingFinished" && debuggerResponseRequests.has(params.requestId)) {
            const requestId = params.requestId;
            debuggerResponseRequests.delete(requestId);
            debuggerBodyTasks.push((async () => {
              try {
                const body = await debuggerApi.sendCommand("Network.getResponseBody", { requestId });
                const text = body && body.base64Encoded ? Buffer.from(String(body.body || ""), "base64").toString("utf8") : String(body && body.body || "");
                extractDouyinMediaUrlsForAweme(text, targetDouyinAwemeId).forEach((mediaUrl) => pushUniqueMediaUrl(debuggerMediaUrls, mediaUrl));
              } catch (error) {
              }
            })());
          }
        } catch (error) {
        }
      }, "debuggerMessageHandler");
      debuggerApi.on("message", debuggerMessageHandler);
    } catch (error) {
      debuggerMessageHandler = null;
    }
  }
  try {
    throwIfAborted(options.signal);
    const loaded = waitForWebContents(win.webContents, 18e3);
    if (!beginBestEffortBrowserLoad(win, url)) {
      throw new Error("隐藏浏览器未能开始加载抖音页面");
    }
    await loaded;
    throwIfAborted(options.signal);
    const payload = await win.webContents.executeJavaScript(`
      (async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const urls = [];
        const seen = new Set();
        const maxUrls = ${BROWSER_MEDIA_CAPTURE_MAX_URLS};
        let resourceCursor = 0;
        const add = (value, resourceType = '') => {
          if (urls.length >= maxUrls) return;
          const url = String(value || '').trim();
          if (!url) return;
          if (seen.has(url)) return;
          seen.add(url);
          urls.push({ url, resourceType });
        };
        const collect = () => {
          document.querySelectorAll('video, audio, source').forEach((node) => {
            if (urls.length >= maxUrls) return;
            add(node.currentSrc, 'media');
            add(node.src, 'media');
            add(node.getAttribute('src'), 'media');
          });
          try {
            const entries = performance.getEntriesByType('resource');
            for (let index = resourceCursor; index < entries.length && urls.length < maxUrls; index += 1) {
              const entry = entries[index];
              add(entry.name, entry.initiatorType || '');
            }
            resourceCursor = entries.length;
          } catch (error) {}
        };
        for (let index = 0; index < 24; index += 1) {
          collect();
          if (urls.length >= maxUrls) break;
          await sleep(500);
        }
        collect();
        ${buildDouyinDomIdentityExtractorScript()}
        const mediaElements = Array.from(document.querySelectorAll('video, audio'));
        const domMediaCandidates = mediaElements.map((node, index) => {
          let rect = { width: 0, height: 0, top: 0, left: 0, bottom: 0, right: 0 };
          try {
            rect = node.getBoundingClientRect();
          } catch (error) {}
          const style = (() => {
            try { return window.getComputedStyle(node); } catch (error) { return null; }
          })();
          const visible = !style || (style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity || 1) > 0);
          const intersectsViewport = rect.bottom > 0
            && rect.right > 0
            && rect.top < window.innerHeight
            && rect.left < window.innerWidth;
          const area = Math.max(0, Number(rect.width || 0)) * Math.max(0, Number(rect.height || 0));
          const mediaUrls = [];
          const seenMediaUrls = new Set();
          const addMediaUrl = (value) => {
            const mediaUrl = String(value || '').trim();
            if (!mediaUrl || seenMediaUrls.has(mediaUrl)) return;
            seenMediaUrls.add(mediaUrl);
            mediaUrls.push(mediaUrl);
          };
          addMediaUrl(node.currentSrc);
          addMediaUrl(node.src);
          addMediaUrl(node.getAttribute && node.getAttribute('src'));
          node.querySelectorAll('source').forEach((source) => {
            addMediaUrl(source.currentSrc);
            addMediaUrl(source.src);
            addMediaUrl(source.getAttribute('src'));
          });
          return {
            index,
            urls: mediaUrls,
            identityIds: collectIdentityIds(node),
            isPlaying: Boolean(!node.paused && !node.ended && Number(node.readyState || 0) >= 2),
            visible,
            intersectsViewport,
            area,
          };
        }).filter((candidate) => candidate.urls.length);
        const canonicalNode = document.querySelector('link[rel=canonical]');
        const ogUrlNode = document.querySelector('meta[property=og:url]');
        const pageIdentityIds = [];
        const seenPageIdentityIds = new Set();
        const addPageIdentityIds = (values) => {
          (Array.isArray(values) ? values : []).forEach((value) => {
            const identityId = String(value || '').trim();
            if (!identityId || seenPageIdentityIds.has(identityId)) return;
            seenPageIdentityIds.add(identityId);
            pageIdentityIds.push(identityId);
          });
        };
        addPageIdentityIds(collectIdentityIds(document.documentElement));
        Array.from(document.querySelectorAll(
          '[data-aweme-id], [data-item-id], a[href*="/video/"], a[href*="aweme_id="], a[href*="modal_id="]',
        )).slice(0, 500).forEach((node) => addPageIdentityIds(collectIdentityIds(node)));
        return {
          urls,
          pageUrl: String(location.href || ''),
          canonicalUrl: String(
            (canonicalNode && canonicalNode.href)
            || (ogUrlNode && ogUrlNode.content)
            || '',
          ),
          domMediaCandidates,
          pageIdentityIds,
        };
      })()
    `);
    throwIfAborted(options.signal);
    await waitForBrowserTasksWithin(debuggerBodyTasks, 2500);
    throwIfAborted(options.signal);
    if (targetDouyinAwemeId && options.strictDouyinTarget === true) {
      return selectIdentityBoundDouyinBrowserMedia({
        targetAwemeId: targetDouyinAwemeId,
        finalUrl: payload && payload.pageUrl,
        canonicalUrl: payload && payload.canonicalUrl,
        debuggerMediaUrls,
        domMediaCandidates: payload && payload.domMediaCandidates,
        pageIdentityIds: payload && payload.pageIdentityIds
      });
    }
    return normalizeBrowserCapturedMediaUrls([
      capturedRequests,
      payload && Array.isArray(payload.urls) ? payload.urls : payload,
      debuggerMediaUrls
    ]);
  } finally {
    cleanupAbort();
    installedWebRequestHandlers.forEach((method) => {
      try {
        if (browserSession && browserSession.webRequest && typeof browserSession.webRequest[method] === "function") {
          browserSession.webRequest[method]({ urls: ["<all_urls>"] }, null);
        }
      } catch (error) {
      }
    });
    try {
      if (debuggerApi && debuggerMessageHandler && typeof debuggerApi.removeListener === "function") {
        debuggerApi.removeListener("message", debuggerMessageHandler);
      }
    } catch (error) {
    }
    try {
      if (debuggerAttached && debuggerApi && typeof debuggerApi.detach === "function") {
        debuggerApi.detach();
      }
    } catch (error) {
    }
    if (win && typeof win.destroy === "function") {
      win.destroy();
    }
  }
}
__name(renderSocialMediaUrlsWithElectron, "renderSocialMediaUrlsWithElectron");
async function renderXiaohongshuContentWithElectron(url, options = {}) {
  throwIfAborted(options.signal);
  const BrowserWindow = getElectronBrowserWindow();
  if (!BrowserWindow) {
    throw new Error("Current Obsidian environment does not support hidden browser rendering");
  }
  const xiaohongshuSession = getXiaohongshuSession();
  const win = new BrowserWindow({
    width: 1280,
    height: 960,
    show: false,
    webPreferences: {
      session: xiaohongshuSession || void 0,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  trackXiaohongshuBrowserWindow(win);
  installXiaohongshuNavigationGuards(win.webContents);
  const cleanupAbort = bindBrowserWindowToAbortSignal(win, options.signal);
  const browserSession = win.webContents && win.webContents.session || xiaohongshuSession;
  let blocksCommentRequests = false;
  let observedIdentityUrl = resolveXiaohongshuIdentityUrl([
    options.expectedUrl,
    url
  ]);
  const deadlineAt = Date.now() + XIAOHONGSHU_CONTENT_DEADLINE_MS;
  const cleanupIdentityObserver = installXiaohongshuIdentityObserver(
    win.webContents,
    (identityUrl) => {
      observedIdentityUrl = rememberXiaohongshuObservedIdentity(
        observedIdentityUrl,
        {
          resourceType: "mainFrame",
          url: identityUrl
        }
      );
    }
  );
  try {
    throwIfAborted(options.signal);
    if (browserSession && browserSession.webRequest && typeof browserSession.webRequest.onBeforeRequest === "function") {
      browserSession.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
        if (typeof callback === "function") {
          callback(
            shouldBlockXiaohongshuBrowserNavigationRequest(details) || isXiaohongshuCommentApiUrl(details && details.url) ? { cancel: true } : {}
          );
        }
      });
      blocksCommentRequests = true;
    }
    const loaded = waitForWebContents(win.webContents, 18e3);
    if (!beginBestEffortBrowserLoad(win, url)) {
      throw new Error("隐藏浏览器未能开始加载小红书页面");
    }
    await loaded;
    throwIfAborted(options.signal);
    let payload = null;
    for (let index = 0; index < 12; index += 1) {
      throwIfAborted(options.signal);
      const remainingMs = deadlineAt - Date.now();
      if (remainingMs <= 0) {
        throw createBrowserTaskTimeoutError(
          "xiaohongshu-content-render",
          XIAOHONGSHU_CONTENT_DEADLINE_MS
        );
      }
      const current = await runBrowserTaskWithTimeout(
        win.webContents.executeJavaScript(`
          (() => ({
            html: document.documentElement ? document.documentElement.outerHTML : '',
            url: String(location.href || ''),
          }))()
        `),
        Math.min(XIAOHONGSHU_BROWSER_SCRIPT_TIMEOUT_MS, remainingMs),
        "xiaohongshu-content-snapshot"
      );
      payload = selectXiaohongshuBrowserSnapshot(
        payload,
        current,
        observedIdentityUrl || options.expectedUrl || url
      );
      if (payload.matched) break;
      const remainingAfterSnapshotMs = deadlineAt - Date.now();
      if (remainingAfterSnapshotMs <= 0) {
        throw createBrowserTaskTimeoutError(
          "xiaohongshu-content-render",
          XIAOHONGSHU_CONTENT_DEADLINE_MS
        );
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(500, remainingAfterSnapshotMs)));
    }
    throwIfAborted(options.signal);
    return {
      html: String(payload && payload.html || ""),
      url: String(payload && payload.url || win.webContents && win.webContents.getURL && win.webContents.getURL() || url),
      identityUrl: String(payload && payload.identityUrl || ""),
      comments: [],
      commentDiagnosticDetails: {
        source: "disabled",
        stopReason: "comments_disabled",
        partial: false
      }
    };
  } finally {
    cleanupAbort();
    try {
      if (blocksCommentRequests && browserSession && browserSession.webRequest && typeof browserSession.webRequest.onBeforeRequest === "function") {
        browserSession.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, null);
      }
      cleanupIdentityObserver();
    } catch (error) {
    }
    if (win && typeof win.destroy === "function") {
      win.destroy();
    }
  }
}
__name(renderXiaohongshuContentWithElectron, "renderXiaohongshuContentWithElectron");
var xiaohongshuBrowserSessionQueue = Promise.resolve();
async function runWithXiaohongshuBrowserSessionLock(task, signal = null) {
  const previous = xiaohongshuBrowserSessionQueue;
  let release;
  const currentGate = new Promise((resolve) => {
    release = resolve;
  });
  xiaohongshuBrowserSessionQueue = Promise.resolve(previous).then(
    () => currentGate,
    () => currentGate
  );
  try {
    await waitForPromiseWithAbort(previous, signal);
    throwIfAborted(signal);
    return await task();
  } finally {
    release();
  }
}
__name(runWithXiaohongshuBrowserSessionLock, "runWithXiaohongshuBrowserSessionLock");
async function renderXiaohongshuPageWithElectron(url, options = {}) {
  return await runWithXiaohongshuBrowserSessionLock(async () => {
    throwIfAborted(options.signal);
    if (options.includeComments === false) {
      return await renderXiaohongshuContentWithElectron(url, options);
    }
    const expectedIdentityUrl = resolveXiaohongshuIdentityUrl([
      options.expectedUrl,
      url
    ]);
    const expectedNoteId = getXiaohongshuTargetNoteId(expectedIdentityUrl);
    if (!expectedNoteId) {
      return {
        html: "",
        comments: [],
        identityUrl: "",
        commentDiagnosticDetails: {
          source: "disabled",
          stopReason: "target_identity_missing",
          partial: true
        }
      };
    }
    const BrowserWindow = getElectronBrowserWindow();
    if (!BrowserWindow) {
      throw new Error("Current Obsidian environment does not support hidden browser rendering");
    }
    const deadlineAt = Date.now() + XIAOHONGSHU_COMMENT_TIMEOUT_MS;
    const getCommentBudget = /* @__PURE__ */ __name((totalCount = 0) => getXiaohongshuCommentBudgetState({
      deadlineAt,
      totalCount,
      limit: XIAOHONGSHU_TOTAL_COMMENT_LIMIT
    }), "getCommentBudget");
    const wechatSession = getXiaohongshuSession();
    const win = new BrowserWindow({
      width: 1280,
      height: 960,
      show: false,
      webPreferences: {
        session: wechatSession || void 0,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    trackXiaohongshuBrowserWindow(win);
    installXiaohongshuNavigationGuards(win.webContents);
    const cleanupAbort = bindBrowserWindowToAbortSignal(win, options.signal);
    const commentApiRequests = [];
    const browserSession = win.webContents && win.webContents.session || wechatSession;
    const seenCommentApiRequests = /* @__PURE__ */ new Set();
    const captureCommentApiRequest = /* @__PURE__ */ __name((details) => {
      const requestUrl2 = String(details && details.url || "").trim();
      if (!isXiaohongshuCommentApiUrl(requestUrl2)) return;
      const method = String(details && details.method || "GET").toUpperCase();
      const body = getXiaohongshuCapturedRequestBody(details);
      if (classifyXiaohongshuCommentRequestIdentity({
        url: requestUrl2,
        body
      }, expectedNoteId) !== "matched") return;
      const key = `${method}|${requestUrl2}|${body}`;
      if (seenCommentApiRequests.has(key)) return;
      seenCommentApiRequests.add(key);
      commentApiRequests.push({
        url: requestUrl2,
        method,
        body,
        requestHeaders: details && details.requestHeaders ? { ...details.requestHeaders } : {}
      });
    }, "captureCommentApiRequest");
    try {
      if (browserSession && browserSession.webRequest && typeof browserSession.webRequest.onBeforeSendHeaders === "function") {
        browserSession.webRequest.onBeforeSendHeaders({ urls: ["*://*.xiaohongshu.com/*"] }, (details, callback) => {
          captureCommentApiRequest(details);
          if (typeof callback === "function") callback({ requestHeaders: details.requestHeaders });
        });
      }
      if (browserSession && browserSession.webRequest && typeof browserSession.webRequest.onBeforeRequest === "function") {
        browserSession.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (details, callback) => {
          if (shouldBlockXiaohongshuBrowserNavigationRequest(details)) {
            if (typeof callback === "function") callback({ cancel: true });
            return;
          }
          captureCommentApiRequest(details);
          if (typeof callback === "function") callback({});
        });
      }
    } catch (error) {
    }
    const debuggerComments = [];
    const debuggerCommentPayloads = [];
    const debuggerSeen = /* @__PURE__ */ new Set();
    const debuggerBodyTasks = [];
    const debuggerRequestUrls = /* @__PURE__ */ new Map();
    let debuggerResponseSequence = 0;
    let debuggerAttached = false;
    const debuggerApi = win.webContents && win.webContents.debugger;
    const drainDebuggerBodyTasks = /* @__PURE__ */ __name(async () => {
      let settledCount = 0;
      let idlePasses = 0;
      for (let pass = 0; pass < 20 && idlePasses < 2; pass += 1) {
        throwIfAborted(options.signal);
        const budget = getCommentBudget(debuggerComments.length);
        if (budget.shouldStop) return budget.stopReason;
        const pending = debuggerBodyTasks.slice(settledCount);
        if (pending.length) {
          const remainingMs = budget.remainingMs;
          const waitStatus = await waitForPromiseWithAbort(
            waitForBrowserTasksWithin(pending, remainingMs),
            options.signal
          );
          throwIfAborted(options.signal);
          if (waitStatus === "timeout") return "time_budget_exceeded";
          settledCount += pending.length;
          idlePasses = 0;
        } else {
          idlePasses += 1;
        }
        if (idlePasses < 2) {
          const remainingMs = getCommentBudget(debuggerComments.length).remainingMs;
          if (remainingMs <= 0) return "time_budget_exceeded";
          await waitForPromiseWithAbort(
            new Promise((resolve) => setTimeout(resolve, Math.min(120, remainingMs))),
            options.signal
          );
        }
      }
      return "";
    }, "drainDebuggerBodyTasks");
    const parseCommentApiText = /* @__PURE__ */ __name((requestDetails, text, sequence = 0) => {
      if (!text || text.length > XIAOHONGSHU_COMMENT_RESPONSE_MAX_BODY_CHARACTERS) return;
      const requestUrl2 = String(requestDetails && requestDetails.url || "").trim();
      const requestBody = String(requestDetails && requestDetails.body || "");
      const payloads = [];
      try {
        const payload = JSON.parse(text);
        if (payload && typeof payload === "object") payloads.push(payload);
      } catch (error) {
      }
      if (!payloads.length) {
        collectJsonObjectCandidates(text).forEach((candidate) => {
          const payload = parseLooseJsonCandidate(candidate);
          if (payload && typeof payload === "object") payloads.push(payload);
        });
      }
      payloads.forEach((payload) => {
        if (classifyXiaohongshuCommentRequestIdentity({
          url: requestUrl2,
          body: requestBody,
          payload
        }, expectedNoteId) !== "matched") return;
        debuggerCommentPayloads.push({
          url: requestUrl2,
          body: requestBody,
          payload,
          sequence
        });
        extractCommentsFromObject(payload, debuggerComments, debuggerSeen, XIAOHONGSHU_ROOT_COMMENT_LIMIT);
      });
    }, "parseCommentApiText");
    try {
      if (debuggerApi && typeof debuggerApi.attach === "function" && typeof debuggerApi.sendCommand === "function") {
        if (!debuggerApi.isAttached || !debuggerApi.isAttached()) {
          debuggerApi.attach("1.3");
          debuggerAttached = true;
        }
        debuggerApi.sendCommand("Network.enable").catch(() => {
        });
        debuggerApi.on("message", (_event, method, params = {}) => {
          try {
            if (method === "Network.requestWillBeSent") {
              const requestUrl2 = String(params.request && params.request.url || "").trim();
              const requestBody = String(params.request && params.request.postData || "");
              if (params.requestId && isXiaohongshuCommentApiUrl(requestUrl2) && classifyXiaohongshuCommentRequestIdentity({
                url: requestUrl2,
                body: requestBody
              }, expectedNoteId) === "matched") {
                debuggerRequestUrls.set(params.requestId, {
                  url: requestUrl2,
                  body: requestBody,
                  sequence: 0
                });
              }
            }
            if (method === "Network.responseReceived") {
              const responseUrl = String(params.response && params.response.url || "").trim();
              const capturedRequest = debuggerRequestUrls.get(params.requestId) || {
                url: responseUrl,
                body: ""
              };
              if (params.requestId && isXiaohongshuCommentApiUrl(responseUrl) && classifyXiaohongshuCommentRequestIdentity(capturedRequest, expectedNoteId) === "matched") {
                debuggerResponseSequence += 1;
                debuggerRequestUrls.set(params.requestId, {
                  ...capturedRequest,
                  sequence: debuggerResponseSequence
                });
              } else if (params.requestId) {
                debuggerRequestUrls.delete(params.requestId);
              }
            }
            if (method === "Network.loadingFinished" && debuggerRequestUrls.has(params.requestId)) {
              const requestId = params.requestId;
              const responseDetails = debuggerRequestUrls.get(requestId) || {};
              debuggerRequestUrls.delete(requestId);
              debuggerBodyTasks.push((async () => {
                try {
                  const body = await debuggerApi.sendCommand("Network.getResponseBody", { requestId });
                  const text = getXiaohongshuCapturedResponseText(body);
                  parseCommentApiText(responseDetails, text, responseDetails.sequence);
                } catch (error) {
                }
              })());
            }
          } catch (error) {
          }
        });
      }
    } catch (error) {
    }
    try {
      const loadBudget = getCommentBudget(0);
      const loaded = waitForWebContents(win.webContents, Math.min(2e4, loadBudget.remainingMs));
      beginBestEffortBrowserLoad(win, url);
      await waitForPromiseWithAbort(loaded, options.signal);
      throwIfAborted(options.signal);
      let identitySnapshot = null;
      for (let index = 0; index < 12; index += 1) {
        throwIfAborted(options.signal);
        const identityBudget = getCommentBudget(0);
        if (identityBudget.shouldStop) break;
        const current = await runBrowserTaskWithTimeout(
          win.webContents.executeJavaScript(`
          (() => ({
            html: document.documentElement ? document.documentElement.outerHTML : '',
            url: String(location.href || ''),
          }))()
        `),
          Math.min(XIAOHONGSHU_BROWSER_SCRIPT_TIMEOUT_MS, identityBudget.remainingMs),
          "xiaohongshu-comment-identity-snapshot"
        );
        identitySnapshot = selectXiaohongshuBrowserSnapshot(
          identitySnapshot,
          current,
          expectedIdentityUrl
        );
        throwIfAborted(options.signal);
        if (identitySnapshot.matched) break;
        await waitForPromiseWithAbort(
          new Promise((resolve) => setTimeout(resolve, Math.min(500, identityBudget.remainingMs))),
          options.signal
        );
      }
      if (!identitySnapshot || !identitySnapshot.matched) {
        return {
          html: String(identitySnapshot && identitySnapshot.html || ""),
          comments: [],
          identityUrl: expectedIdentityUrl,
          commentDiagnosticDetails: {
            source: "disabled",
            stopReason: "target_identity_mismatch",
            partial: true
          }
        };
      }
      let pageApiPayload = {
        rootPayloads: [],
        replyPayloadGroups: [],
        diagnostic: { source: "page-api", stopReason: "page_script_skipped" }
      };
      const pageApiBudget = getCommentBudget(debuggerComments.length);
      if (!pageApiBudget.shouldStop) {
        const pageApiTask = Promise.resolve(win.webContents.executeJavaScript(getXiaohongshuCommentPaginationScript(expectedIdentityUrl, {
          deadlineAt,
          totalLimit: XIAOHONGSHU_TOTAL_COMMENT_LIMIT
        }))).then((value) => {
          pageApiPayload = value;
        }).catch((error) => {
          if (isAbortError(error) || options.signal && options.signal.aborted) {
            throw createAbortError();
          }
          pageApiPayload = {
            rootPayloads: [],
            replyPayloadGroups: [],
            diagnostic: { source: "page-api", stopReason: "page_script_failed" }
          };
        });
        const pageApiWaitStatus = await waitForPromiseWithAbort(
          waitForBrowserTasksWithin([pageApiTask], pageApiBudget.remainingMs),
          options.signal
        );
        throwIfAborted(options.signal);
        if (pageApiWaitStatus === "timeout") {
          pageApiPayload = {
            rootPayloads: [],
            replyPayloadGroups: [],
            diagnostic: { source: "page-api", stopReason: "time_budget_exceeded" }
          };
        }
      }
      if (String(pageApiPayload && pageApiPayload.identityNoteId || "").trim().toLowerCase() !== String(expectedNoteId).trim().toLowerCase()) {
        pageApiPayload = {
          rootPayloads: [],
          replyPayloadGroups: [],
          identityNoteId: "",
          diagnostic: { source: "page-api", stopReason: "target_identity_mismatch" }
        };
      } else {
        const rootRequestUrl = `https://www.xiaohongshu.com/api/sns/web/v2/comment/page?note_id=${encodeURIComponent(expectedNoteId)}`;
        const replyRequestUrl = `https://www.xiaohongshu.com/api/sns/web/v2/comment/sub/page?note_id=${encodeURIComponent(expectedNoteId)}`;
        pageApiPayload.rootPayloads = (Array.isArray(pageApiPayload.rootPayloads) ? pageApiPayload.rootPayloads : []).filter((payload) => classifyXiaohongshuCommentRequestIdentity({
          url: rootRequestUrl,
          payload
        }, expectedNoteId) === "matched");
        pageApiPayload.replyPayloadGroups = (Array.isArray(pageApiPayload.replyPayloadGroups) ? pageApiPayload.replyPayloadGroups : []).map((group) => ({
          ...group,
          payloads: (Array.isArray(group && group.payloads) ? group.payloads : []).filter((payload) => classifyXiaohongshuCommentRequestIdentity({
            url: replyRequestUrl,
            payload
          }, expectedNoteId) === "matched")
        })).filter((group) => group.payloads.length > 0);
      }
      const capturedPageDiagnostic = pageApiPayload && pageApiPayload.diagnostic && typeof pageApiPayload.diagnostic === "object" ? pageApiPayload.diagnostic : {};
      let renderedPayload = {
        html: "",
        comments: [],
        collectionStopReason: capturedPageDiagnostic.stopReason === "time_budget_exceeded" ? "time_budget_exceeded" : "page_render_skipped"
      };
      const renderedBudget = getCommentBudget(
        Number(capturedPageDiagnostic.rootCount || 0) + Number(capturedPageDiagnostic.replyCount || 0)
      );
      if (!renderedBudget.shouldStop) {
        const renderedTask = Promise.resolve(win.webContents.executeJavaScript(`
      (async () => {
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        const XIAOHONGSHU_ROOT_COMMENT_LIMIT = ${XIAOHONGSHU_ROOT_COMMENT_LIMIT};
        const XIAOHONGSHU_TOTAL_COMMENT_LIMIT = ${XIAOHONGSHU_TOTAL_COMMENT_LIMIT};
        const deadlineAt = ${deadlineAt};
        const getCollectionStopReason = () => {
          if (comments.length >= XIAOHONGSHU_TOTAL_COMMENT_LIMIT) return 'total_limit_reached';
          if (Date.now() >= deadlineAt) return 'time_budget_exceeded';
          return '';
        };
        const didRootCollectionProgress = (${didXiaohongshuRootCollectionProgress.toString()});
        const clean = (text) => String(text || '').replace(/\\u00a0/g, ' ').replace(/\\s+/g, ' ').trim();
        const comments = [];
        const seen = new Set();
        const push = (author, content, time, likes, structure = {}) => {
          if (comments.length >= XIAOHONGSHU_TOTAL_COMMENT_LIMIT) return;
          const body = clean(content);
          if (!body || body.length < 2) return;
          if (/^(?:回复|评论|点赞|赞|展开|更多|查看|分享|收藏|[0-9]+)$/.test(body)) return;
          if (/^共\\s*\\d+\\s*条评论/.test(body)) return;
          const name = clean(author);
          const key = name + '|' + body;
          if (seen.has(key)) return;
          seen.add(key);
          comments.push({
            author: name,
            content: body,
            time: clean(time),
            likes: clean(likes),
            id: clean(structure.id),
            domRole: structure.domRole || 'unknown',
            parentAuthor: clean(structure.parentAuthor),
            parentCommentId: clean(structure.parentCommentId),
          });
        };
        const clickUsefulButtons = () => {
          const buttons = Array.from(document.querySelectorAll('button, [role="button"], .show-more, .more, .expand, [class*="more"], [class*="expand"], [class*="reply"], [class*="Reply"], [class*="sub-comment"], [class*="subComment"], [data-testid*="reply"], [data-testid*="comment"]'));
          buttons.forEach((node) => {
            const text = String(node.innerText || node.textContent || node.getAttribute('aria-label') || '').trim();
            const inCommentArea = Boolean(node.closest('[class*="comment"], [class*="Comment"], [id*="comment"], [id*="Comment"], [class*="reply"], [class*="Reply"]'));
            const isExpansion = /(?:展开|查看|更多).{0,16}(?:回复|评论)|(?:回复|评论).{0,16}(?:展开|查看|更多)|^(?:展开|更多|查看全部)$/i.test(text);
            if (inCommentArea && isExpansion) {
              try { node.click(); } catch (error) {}
            }
          });
        };
        const collectDomComments = () => {
          const selectors = [
            '.comment-item',
            '[class*="comment-item"]',
            '[class*="CommentItem"]',
            '[class*="comment"][class*="item"]',
            '[class*="reply-item"]',
            '[class*="ReplyItem"]',
          ];
          const nodes = Array.from(document.querySelectorAll(selectors.join(',')));
          nodes.forEach((node) => {
            const pickFrom = (root, selectorsToTry) => {
              for (const selector of selectorsToTry) {
                const candidates = Array.from(root && root.querySelectorAll ? root.querySelectorAll(selector) : []);
                for (const child of candidates) {
                  const value = clean(child.innerText || child.textContent || '');
                  if (value) return value;
                }
              }
              return '';
            };
            const pick = (selectorsToTry) => pickFrom(node, selectorsToTry);
            const author = pick(['[class*="name"]', '[class*="nick"]', '[class*="author"]', '[class*="user"]']);
            const time = pick(['[class*="time"]', '[class*="date"]']);
            const likes = pick(['[class*="like"]', '[class*="praise"]']);
            let content = pick(['[class*="content"]', '[class*="text"]', '[class*="desc"]']);
            if (!content) {
              const text = clean(node.innerText || node.textContent || '');
              const parts = text.split(/\\s+/).filter(Boolean);
              content = parts.find((part) => part.length >= 2 && !/^(?:回复|评论|点赞|赞|展开|更多|查看|分享|收藏|[0-9]+)$/.test(part)) || text;
            }
            const marker = clean(String(node.className || '') + ' ' + String(node.id || ''));
            const replyAncestor = node.closest
              ? node.closest('[class*="reply"], [class*="Reply"], [class*="sub-comment"], [class*="subComment"]')
              : null;
            const isReplyNode = /reply|sub[-_]?comment/i.test(marker)
              || Boolean(replyAncestor && replyAncestor !== node.closest('.comments-container, [class*="comment-list"], [class*="CommentList"]'));
            const rootSelector = '.comment-item, [class*="comment-item"], [class*="CommentItem"], [class*="comment"][class*="item"]';
            let parentRoot = null;
            if (isReplyNode && node.parentElement && node.parentElement.closest) {
              parentRoot = node.parentElement.closest(rootSelector);
            }
            const parentAuthor = parentRoot
              ? pickFrom(parentRoot, ['[class*="name"]', '[class*="nick"]', '[class*="author"]', '[class*="user"]'])
              : '';
            const parentCommentId = parentRoot
              ? clean(parentRoot.getAttribute('data-comment-id') || parentRoot.getAttribute('data-id') || parentRoot.id || '')
              : '';
            const commentId = clean(node.getAttribute('data-comment-id') || node.getAttribute('data-id') || node.id || '');
            push(author, content, time, likes, {
              id: commentId,
              domRole: isReplyNode ? 'reply' : 'root',
              parentAuthor,
              parentCommentId,
            });
          });
        };
        const findCommentScrollContainer = () => {
          const candidates = new Set();
          const addWithAncestors = (node) => {
            let current = node;
            for (let depth = 0; current && depth < 8; depth += 1) {
              candidates.add(current);
              current = current.parentElement;
            }
          };
          Array.from(document.querySelectorAll([
            '.comments-container',
            '[class*="comments-container"]',
            '[class*="comment-list"]',
            '[class*="CommentList"]',
            '[class*="comment"][class*="list"]',
            '[class*="note-scroller"]',
          ].join(','))).forEach(addWithAncestors);
          const firstComment = document.querySelector('.comment-item, [class*="comment-item"], [class*="CommentItem"]');
          if (firstComment) addWithAncestors(firstComment);
          if (document.scrollingElement) candidates.add(document.scrollingElement);
          if (document.documentElement) candidates.add(document.documentElement);
          if (document.body) candidates.add(document.body);
          const scored = Array.from(candidates)
            .map((node) => {
              if (!node || !Number.isFinite(Number(node.scrollHeight)) || !Number.isFinite(Number(node.clientHeight))) return null;
              const available = Math.max(0, Number(node.scrollHeight) - Number(node.clientHeight));
              if (available < 80) return null;
              let overflowY = '';
              try { overflowY = String(getComputedStyle(node).overflowY || ''); } catch (error) {}
              const marker = String(node.className || '') + ' ' + String(node.id || '');
              let nestedReplyAncestor = null;
              try {
                nestedReplyAncestor = node.closest('[class*="reply"], [class*="Reply"], [class*="sub-comment"], [class*="subComment"]');
              } catch (error) {}
              const nestedReplyPenalty = /reply|sub[-_]?comment/i.test(marker) || nestedReplyAncestor ? -2000000 : 0;
              const mainCommentListBonus = !nestedReplyPenalty && /comments?[-_s]?(?:container|list)|commentlist/i.test(marker)
                ? 1200000
                : 0;
              let rootCommentCount = 0;
              try {
                rootCommentCount = Array.from(node.querySelectorAll('.comment-item, [class*="comment-item"], [class*="CommentItem"], [class*="comment"][class*="item"]'))
                  .filter((item) => !item.closest('[class*="reply"], [class*="Reply"], [class*="sub-comment"], [class*="subComment"]'))
                  .length;
              } catch (error) {}
              const rootCoverageBonus = Math.min(rootCommentCount, 50) * 10000;
              const overflowBonus = /auto|scroll/i.test(overflowY) ? 500000 : 0;
              const documentPenalty = node === document.scrollingElement || node === document.body || node === document.documentElement ? -250000 : 0;
              return { node, score: mainCommentListBonus + rootCoverageBonus + overflowBonus + available + nestedReplyPenalty + documentPenalty };
            })
            .filter(Boolean)
            .sort((a, b) => b.score - a.score);
          return scored.length ? scored[0].node : null;
        };
        const advanceCommentScroll = () => {
          const container = findCommentScrollContainer();
          if (container && container !== document.scrollingElement && container !== document.body && container !== document.documentElement) {
            const before = Number(container.scrollTop) || 0;
            const maxTop = Math.max(0, Number(container.scrollHeight) - Number(container.clientHeight));
            const step = Math.max(600, Math.floor(Number(container.clientHeight || window.innerHeight) * 0.85));
            container.scrollTop = Math.min(maxTop, before + step);
            try { container.dispatchEvent(new Event('scroll', { bubbles: true })); } catch (error) {}
            try { container.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: step })); } catch (error) {}
            return {
              moved: Number(container.scrollTop) > before + 1,
              top: Number(container.scrollTop) || 0,
              height: Number(container.scrollHeight) || 0,
              mode: 'comment_container',
            };
          }
          const before = Number(window.scrollY) || 0;
          const step = Math.max(600, Math.floor(window.innerHeight * 0.8));
          window.scrollBy(0, step);
          return {
            moved: Number(window.scrollY) > before + 1,
            top: Number(window.scrollY) || 0,
            height: Math.max(document.documentElement && document.documentElement.scrollHeight || 0, document.body && document.body.scrollHeight || 0),
            mode: 'window_fallback',
          };
        };
        let idleRounds = 0;
        let completedRounds = 0;
        let lastRootSnapshot = {
          rootCommentCount: -1,
          rootRequestCount: -1,
          replyCommentCount: -1,
          replyRequestCount: -1,
          scrollTop: -1,
          scrollHeight: -1,
        };
        let rootRequestCount = 0;
        let replyRequestCount = 0;
        let scrollMode = 'unknown';
        let collectionStopReason = 'max_rounds';
        const maxRounds = 90;
        for (let index = 0; index < maxRounds; index += 1) {
          const beforeRoundStopReason = getCollectionStopReason();
          if (beforeRoundStopReason) {
            collectionStopReason = beforeRoundStopReason;
            break;
          }
          clickUsefulButtons();
          collectDomComments();
          const movement = advanceCommentScroll();
          scrollMode = movement.mode;
          await sleep(Math.max(0, Math.min(450, deadlineAt - Date.now())));
          clickUsefulButtons();
          collectDomComments();
          let resourceUrls = [];
          try {
            resourceUrls = performance.getEntriesByType('resource')
              .map((entry) => String(entry && entry.name || ''))
              .filter((entryUrl) => /xiaohongshu\\.com\\/api\\/sns\\/web\\/v\\d+\\/comment/i.test(entryUrl));
          } catch (error) {}
          rootRequestCount = resourceUrls.filter((entryUrl) => !/\\/comment\\/sub\\/page(?:[/?]|$)/i.test(entryUrl)).length;
          replyRequestCount = resourceUrls.filter((entryUrl) => /\\/comment\\/sub\\/page(?:[/?]|$)/i.test(entryUrl)).length;
          const rootCommentCount = comments.filter((comment) => comment && comment.domRole === 'root').length;
          const replyCommentCount = comments.filter((comment) => comment && comment.domRole === 'reply').length;
          const currentRootSnapshot = {
            rootCommentCount,
            rootRequestCount,
            replyCommentCount,
            replyRequestCount,
            scrollTop: movement.top,
            scrollHeight: movement.height,
          };
          const progressed = didRootCollectionProgress(lastRootSnapshot, currentRootSnapshot);
          idleRounds = progressed ? 0 : idleRounds + 1;
          lastRootSnapshot = currentRootSnapshot;
          completedRounds = index + 1;
          const afterRoundStopReason = getCollectionStopReason();
          if (afterRoundStopReason) {
            collectionStopReason = afterRoundStopReason;
            break;
          }
          if (idleRounds >= 10 && index >= 9) {
            collectionStopReason = 'root_idle';
            break;
          }
        }
        let replySettlingRounds = 0;
        let replyIdleRounds = 0;
        let lastReplySnapshot = {
          replyCommentCount: comments.filter((comment) => comment && comment.domRole === 'reply').length,
          replyRequestCount,
        };
        for (let index = 0; index < 6 && replyIdleRounds < 2; index += 1) {
          const beforeReplyStopReason = getCollectionStopReason();
          if (beforeReplyStopReason) {
            collectionStopReason = beforeReplyStopReason;
            break;
          }
          clickUsefulButtons();
          collectDomComments();
          await sleep(Math.max(0, Math.min(450, deadlineAt - Date.now())));
          collectDomComments();
          let nextReplyRequestCount = replyRequestCount;
          try {
            nextReplyRequestCount = performance.getEntriesByType('resource')
              .map((entry) => String(entry && entry.name || ''))
              .filter((entryUrl) => /\\/comment\\/sub\\/page(?:[/?]|$)/i.test(entryUrl))
              .length;
          } catch (error) {}
          const nextReplyCommentCount = comments.filter((comment) => comment && comment.domRole === 'reply').length;
          const replyProgressed = nextReplyCommentCount > lastReplySnapshot.replyCommentCount
            || nextReplyRequestCount > lastReplySnapshot.replyRequestCount;
          replyIdleRounds = replyProgressed ? 0 : replyIdleRounds + 1;
          replyRequestCount = nextReplyRequestCount;
          lastReplySnapshot = {
            replyCommentCount: nextReplyCommentCount,
            replyRequestCount: nextReplyRequestCount,
          };
          replySettlingRounds = index + 1;
        }
        const finalCollectionStopReason = getCollectionStopReason();
        if (finalCollectionStopReason) collectionStopReason = finalCollectionStopReason;
        return {
          html: document.documentElement ? document.documentElement.outerHTML : '',
          url: String(location.href || ''),
          comments,
          scrollMode,
          completedRounds,
          idleRounds,
          rootCommentCount: lastRootSnapshot.rootCommentCount,
          replyCommentCount: lastReplySnapshot.replyCommentCount,
          rootRequestCount,
          replyRequestCount,
          replySettlingRounds,
          collectionStopReason,
        };
      })()
    `)).then((value) => {
          renderedPayload = value;
        }).catch((error) => {
          if (isAbortError(error) || options.signal && options.signal.aborted) {
            throw createAbortError();
          }
          renderedPayload = {
            html: "",
            comments: [],
            collectionStopReason: getCommentBudget(0).shouldStop ? "time_budget_exceeded" : "page_render_failed"
          };
        });
        const renderedWaitStatus = await waitForPromiseWithAbort(
          waitForBrowserTasksWithin([renderedTask], renderedBudget.remainingMs),
          options.signal
        );
        throwIfAborted(options.signal);
        if (renderedWaitStatus === "timeout") {
          renderedPayload = {
            html: "",
            comments: [],
            collectionStopReason: "time_budget_exceeded"
          };
        }
      } else {
        renderedPayload.collectionStopReason = renderedBudget.stopReason;
      }
      throwIfAborted(options.signal);
      const debuggerDrainStopReason = await drainDebuggerBodyTasks();
      throwIfAborted(options.signal);
      const renderedHtml = renderedPayload && typeof renderedPayload === "object" ? String(renderedPayload.html || "") : String(renderedPayload || "");
      const renderedUrl = String(renderedPayload && renderedPayload.url || "");
      const renderedUrlNoteId = getXiaohongshuTargetNoteId(renderedUrl);
      const renderedPageMatchesTarget = extractXiaohongshuPrimaryNotePayload(
        renderedHtml,
        expectedIdentityUrl
      ).matched === true && (!renderedUrlNoteId || renderedUrlNoteId.toLowerCase() === String(expectedNoteId).toLowerCase());
      const inlineDomComments = renderedPageMatchesTarget && renderedPayload && typeof renderedPayload === "object" && Array.isArray(renderedPayload.comments) ? renderedPayload.comments : [];
      const pagedRootResult = collectXiaohongshuCommentPages(pageApiPayload && pageApiPayload.rootPayloads, XIAOHONGSHU_ROOT_COMMENT_LIMIT);
      let pagedComments = pagedRootResult.comments;
      (Array.isArray(pageApiPayload && pageApiPayload.replyPayloadGroups) ? pageApiPayload.replyPayloadGroups : []).forEach((group) => {
        pagedComments = mergeXiaohongshuReplyPages(pagedComments, group && group.rootCommentId, group && group.payloads);
      });
      let apiComments = [];
      const signedReplayBudget = getCommentBudget(
        debuggerComments.length + getSocialCommentTreeStats(pagedComments).rootCount + getSocialCommentTreeStats(pagedComments).replyCount
      );
      if (!signedReplayBudget.shouldStop) {
        apiComments = await fetchXiaohongshuCommentsFromCapturedRequests(
          commentApiRequests,
          XIAOHONGSHU_ROOT_COMMENT_LIMIT,
          {
            deadlineAt,
            totalLimit: XIAOHONGSHU_TOTAL_COMMENT_LIMIT,
            expectedNoteId,
            signal: options.signal
          }
        );
        throwIfAborted(options.signal);
      }
      const browserNetworkResult = mergeXiaohongshuCapturedCommentPayloads(
        debuggerCommentPayloads,
        XIAOHONGSHU_ROOT_COMMENT_LIMIT,
        { expectedNoteId }
      );
      const domComments = renderedPageMatchesTarget ? extractSocialCommentsFromHtml(renderedHtml, XIAOHONGSHU_ROOT_COMMENT_LIMIT) : [];
      const candidateNetworkComments = mergeXiaohongshuNetworkComments([
        browserNetworkResult.comments,
        pagedComments,
        debuggerComments,
        apiComments
      ], XIAOHONGSHU_ROOT_COMMENT_LIMIT);
      const networkComments = preserveXiaohongshuPrimaryCommentTree(
        browserNetworkResult.comments,
        candidateNetworkComments,
        XIAOHONGSHU_ROOT_COMMENT_LIMIT
      );
      const mergedCommentSources = mergeXiaohongshuCommentSources({
        networkComments,
        deferredReplyGroups: browserNetworkResult.deferredReplyGroups,
        fallbackGroups: [
          inlineDomComments,
          domComments
        ],
        limit: XIAOHONGSHU_ROOT_COMMENT_LIMIT
      });
      const comments = limitSocialCommentTreeTotal(
        mergedCommentSources.comments,
        XIAOHONGSHU_TOTAL_COMMENT_LIMIT
      );
      const finalCommentStats = getSocialCommentTreeStats(comments);
      const capturedDiagnostic = pageApiPayload && pageApiPayload.diagnostic && typeof pageApiPayload.diagnostic === "object" ? pageApiPayload.diagnostic : {};
      const hasBrowserNetworkPayload = browserNetworkResult.rootPayloadCount > 0 || browserNetworkResult.replyPayloadCount > 0;
      const browserStopReason = browserNetworkResult.stopReason === "source_exhausted" && renderedPayload && renderedPayload.collectionStopReason ? `network_${renderedPayload.collectionStopReason}` : browserNetworkResult.stopReason;
      const finalBudget = getCommentBudget(finalCommentStats.rootCount + finalCommentStats.replyCount);
      const explicitBudgetStopReason = [
        capturedDiagnostic.stopReason,
        renderedPayload && renderedPayload.collectionStopReason,
        debuggerDrainStopReason,
        signedReplayBudget.stopReason,
        finalBudget.stopReason
      ].find((reason) => reason === "time_budget_exceeded" || reason === "total_limit_reached") || "";
      const commentDiagnosticDetails = {
        source: hasBrowserNetworkPayload ? browserNetworkResult.source : capturedDiagnostic.source || "page-api",
        rootCount: hasBrowserNetworkPayload ? browserNetworkResult.rootCount : capturedDiagnostic.rootCount || comments.length,
        replyCount: hasBrowserNetworkPayload ? browserNetworkResult.replyCount : capturedDiagnostic.replyCount || 0,
        pageCount: hasBrowserNetworkPayload ? browserNetworkResult.pageCount : capturedDiagnostic.pageCount || pagedRootResult.pageCount,
        rootPageCount: hasBrowserNetworkPayload ? browserNetworkResult.rootPageCount : pagedRootResult.pageCount,
        replyPageCount: hasBrowserNetworkPayload ? browserNetworkResult.replyPageCount : Math.max(0, Number(capturedDiagnostic.pageCount || 0) - pagedRootResult.pageCount),
        rootRequestCount: Number(renderedPayload && renderedPayload.rootRequestCount || 0),
        replyRequestCount: Number(renderedPayload && renderedPayload.replyRequestCount || 0),
        mergedRootCount: finalCommentStats.rootCount,
        mergedReplyCount: finalCommentStats.replyCount,
        restoredRootCount: mergedCommentSources.restoredRootCount,
        restoredReplyCount: mergedCommentSources.restoredReplyCount,
        finalRootCount: finalCommentStats.rootCount,
        finalReplyCount: finalCommentStats.replyCount,
        lostRootCount: Math.max(0, browserNetworkResult.rootCount - finalCommentStats.rootCount),
        lostReplyCount: Math.max(0, browserNetworkResult.replyCount - finalCommentStats.replyCount),
        fallbackAddedCount: mergedCommentSources.fallbackAddedCount,
        dedupedFallbackCount: mergedCommentSources.dedupedFallbackCount,
        droppedFallbackCount: mergedCommentSources.droppedFallbackCount,
        unmatchedReplyCount: mergedCommentSources.unmatchedDeferredReplyCount + mergedCommentSources.unmatchedFallbackReplyCount,
        invalidPayloadCount: browserNetworkResult.invalidPayloadCount,
        scrollMode: renderedPayload && renderedPayload.scrollMode,
        pageApiStopReason: hasBrowserNetworkPayload ? "network_primary" : capturedDiagnostic.stopReason,
        stopReason: explicitBudgetStopReason || (hasBrowserNetworkPayload ? browserStopReason : capturedDiagnostic.stopReason || pagedRootResult.stopReason)
      };
      commentDiagnosticDetails.partial = isPartialXiaohongshuCommentResult(commentDiagnosticDetails);
      const commentDiagnostic = buildXiaohongshuCommentDiagnostic(commentDiagnosticDetails);
      throwIfAborted(options.signal);
      return {
        html: renderedHtml,
        identityUrl: expectedIdentityUrl,
        comments,
        commentDiagnostic,
        commentDiagnosticDetails,
        commentApiRequestCount: commentApiRequests.length,
        debuggerCommentCount: debuggerComments.length,
        debuggerCommentPayloadCount: debuggerCommentPayloads.length
      };
    } finally {
      cleanupAbort();
      try {
        if (browserSession && browserSession.webRequest && typeof browserSession.webRequest.onBeforeSendHeaders === "function") {
          browserSession.webRequest.onBeforeSendHeaders({ urls: ["*://*.xiaohongshu.com/*"] }, null);
        }
        if (browserSession && browserSession.webRequest && typeof browserSession.webRequest.onBeforeRequest === "function") {
          browserSession.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, null);
        }
      } catch (error) {
      }
      try {
        if (debuggerAttached && debuggerApi && typeof debuggerApi.detach === "function") {
          debuggerApi.detach();
        }
      } catch (error) {
      }
      if (win && typeof win.destroy === "function") {
        win.destroy();
      }
    }
  }, options.signal);
}
__name(renderXiaohongshuPageWithElectron, "renderXiaohongshuPageWithElectron");
async function renderSocialMediaUrlWithElectron(url, options = {}) {
  const urls = await renderSocialMediaUrlsWithElectron(url, options);
  return urls[0] || "";
}
__name(renderSocialMediaUrlWithElectron, "renderSocialMediaUrlWithElectron");
function decodeJsonStringLiteral(value) {
  try {
    return JSON.parse(`"${String(value || "").replace(/"/g, '\\"')}"`);
  } catch (error) {
    return String(value || "");
  }
}
__name(decodeJsonStringLiteral, "decodeJsonStringLiteral");
function collectFeishuImageUrls(source) {
  const urls = [];
  collectImageUrlsFromHtml(source).forEach((url) => pushUniqueUrl(urls, url));
  collectJsonStringValues(source, [
    "url",
    "src",
    "image",
    "imageUrl",
    "image_url",
    "originUrl",
    "origin_url",
    "downloadUrl",
    "download_url"
  ]).forEach((url) => {
    if (isLikelyImageUrl(url)) pushUniqueUrl(urls, url);
  });
  return urls;
}
__name(collectFeishuImageUrls, "collectFeishuImageUrls");
function getFeishuOutlineLevelFromTag(tag) {
  const source = String(tag || "");
  const attrPatterns = [
    /\bdata-(?:level|heading-level|outline-level)\s*=\s*["']?([1-6])["']?/i,
    /\b(?:aria-level|level)\s*=\s*["']?([1-6])["']?/i
  ];
  for (const pattern of attrPatterns) {
    const match = source.match(pattern);
    if (match && match[1]) return Number(match[1]);
  }
  const classMatch = source.match(/\b(?:level|heading|h)-?([1-6])\b/i);
  return classMatch && classMatch[1] ? Number(classMatch[1]) : 0;
}
__name(getFeishuOutlineLevelFromTag, "getFeishuOutlineLevelFromTag");
function extractFeishuOutlineHeadingMap(html) {
  const source = String(html || "");
  const map = /* @__PURE__ */ new Map();
  const containerPattern = /<(?<tag>aside|nav|div|section)\b(?<attrs>[^>]*)>(?<body>[\s\S]*?)<\/\k<tag>>/gi;
  let containerMatch;
  while (containerMatch = containerPattern.exec(source)) {
    const attrs = containerMatch.groups && containerMatch.groups.attrs || "";
    const body = containerMatch.groups && containerMatch.groups.body || "";
    if (!/(?:outline|catalog|toc|目录|docx-outline)/i.test(`${attrs} ${body.slice(0, 300)}`)) continue;
    const itemPattern = /<(?<tag>h[1-6]|li|a|div|span)\b(?<attrs>[^>]*)>(?<text>[\s\S]*?)<\/\k<tag>>/gi;
    let itemMatch;
    while (itemMatch = itemPattern.exec(body)) {
      const tag = String(itemMatch.groups && itemMatch.groups.tag || "").toLowerCase();
      const attrsText = itemMatch.groups && itemMatch.groups.attrs || "";
      const text = stripHtmlTags(itemMatch.groups && itemMatch.groups.text || "").replace(/\s+/g, " ").trim();
      if (!text || text.length < 2 || shouldDropFeishuLine(text, "")) continue;
      let level = /^h[1-6]$/.test(tag) ? Number(tag[1]) : getFeishuOutlineLevelFromTag(attrsText);
      if (!level) {
        const indentMatch = attrsText.match(/padding-left\s*:\s*(\d+)px/i);
        level = indentMatch ? Math.max(1, Math.min(6, Math.floor(Number(indentMatch[1]) / 16) + 1)) : 1;
      }
      const key = normalizeTitleForCompare(text);
      if (key && !map.has(key)) map.set(key, Math.max(1, Math.min(6, level)));
    }
  }
  return map;
}
__name(extractFeishuOutlineHeadingMap, "extractFeishuOutlineHeadingMap");
function stripFeishuOutlineContainers(html) {
  const source = String(html || "");
  return source.replace(/<(?<tag>aside|nav|div|section)\b(?<attrs>[^>]*)>(?<body>[\s\S]*?)<\/\k<tag>>/gi, /* @__PURE__ */ __name(function stripOutline(full) {
    const groups = arguments[arguments.length - 1] || {};
    const attrs = groups && groups.attrs || "";
    const body = groups && groups.body || "";
    return /(?:outline|catalog|toc|目录|docx-outline)/i.test(`${attrs} ${body.slice(0, 300)}`) ? "" : full;
  }, "stripOutline"));
}
__name(stripFeishuOutlineContainers, "stripFeishuOutlineContainers");
function inferFeishuHeadingLevel(text, blockType = "") {
  const normalizedType = String(blockType || "").toLowerCase();
  const match = normalizedType.match(/heading[_-]?([1-6])|h([1-6])/i);
  if (match) return Number(match[1] || match[2]);
  return 0;
}
__name(inferFeishuHeadingLevel, "inferFeishuHeadingLevel");
function pushFeishuLine(lines, seen, text, level = 0) {
  const value = String(text || "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  if (!value || value.length < 2 || /^https?:\/\//i.test(value) || /[{}[\]<>]/.test(value)) return;
  const markdown = level ? `${"#".repeat(Math.max(1, Math.min(6, level)))} ${value}` : formatFeishuHeadingLine(value);
  const key = markdown.replace(/\s+/g, " ");
  if (seen.has(key)) return;
  seen.add(key);
  lines.push(markdown);
}
__name(pushFeishuLine, "pushFeishuLine");
function extractFeishuMarkdownFromHtml(html) {
  const source = decodeHtmlEntities(String(html || ""));
  const outlineHeadingMap = extractFeishuOutlineHeadingMap(source);
  const lines = [];
  const seen = /* @__PURE__ */ new Set();
  const readable = stripScriptAndStyleBlocks(stripFeishuOutlineContainers(source)).replace(/<img\b[^>]*>/gi, (tag) => imageTagToMarkdown(tag)).replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, (_, text) => `
# ${stripHtmlTags(text)}
`).replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, (_, text) => `
## ${stripHtmlTags(text)}
`).replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, (_, text) => `
### ${stripHtmlTags(text)}
`).replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, (_, text) => `
#### ${stripHtmlTags(text)}
`).replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, (_, text) => `
##### ${stripHtmlTags(text)}
`).replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, (_, text) => `
###### ${stripHtmlTags(text)}
`).replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (_, text) => `
${stripHtmlTags(text)}
`);
  cleanMarkdownForStorage(stripHtmlTags(readable), { dedupe: true }).split(/\r?\n/).forEach((line) => {
    const text = line.trim();
    if (shouldDropFeishuLine(text, "")) return;
    if (/^#{1,6}\s+/.test(text) || /^!\[/.test(text)) {
      if (!seen.has(text)) {
        seen.add(text);
        lines.push(text);
      }
      return;
    }
    const outlineLevel = outlineHeadingMap.get(normalizeTitleForCompare(text)) || 0;
    pushFeishuLine(lines, seen, text, outlineLevel);
  });
  const patterns = [
    /"(?:block_type|type)"\s*:\s*"([^"]+)"[\s\S]{0,500}?"(?:text|content|title|name)"\s*:\s*"((?:\\.|[^"\\]){2,})"/g,
    /"(?:text|content|title|name)"\s*:\s*"((?:\\.|[^"\\]){8,})"/g,
    /'text'\s*:\s*'((?:\\.|[^'\\]){8,})'/g
  ];
  patterns.forEach((pattern) => {
    let match;
    while (match = pattern.exec(source)) {
      const hasBlockType = match.length > 2;
      const blockType = hasBlockType ? match[1] : "";
      const rawText = hasBlockType ? match[2] : match[1];
      const text = decodeJsonStringLiteral(rawText).replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
      if (shouldDropFeishuLine(text, "")) return;
      const blockLevel = inferFeishuHeadingLevel(text, blockType);
      const outlineLevel = outlineHeadingMap.get(normalizeTitleForCompare(text)) || 0;
      pushFeishuLine(lines, seen, text, blockLevel || outlineLevel);
    }
  });
  const existingImageUrls = /* @__PURE__ */ new Set();
  lines.forEach((line) => {
    const match = String(line || "").match(/!\[[^\]]*]\(([^)]+)\)/);
    if (match && match[1]) existingImageUrls.add(match[1]);
  });
  let appendedImageIndex = 0;
  collectFeishuImageUrls(source).forEach((url) => {
    if (existingImageUrls.has(url)) return;
    existingImageUrls.add(url);
    const markdown2 = `![图片${appendedImageIndex ? ` ${appendedImageIndex + 1}` : ""}](${url})`;
    appendedImageIndex += 1;
    if (!seen.has(markdown2)) {
      seen.add(markdown2);
      lines.push(markdown2);
    }
  });
  const markdown = lines.join("\n\n").trim();
  if (markdown.length < 20) {
    throw new Error("飞书静态页面中未提取到正文");
  }
  return markdown;
}
__name(extractFeishuMarkdownFromHtml, "extractFeishuMarkdownFromHtml");
function unwrapFeishuClientVarsPayload(payload) {
  if (!payload || typeof payload !== "object") return null;
  if (payload.block_map || payload.blockMap) return payload;
  if (payload.data && typeof payload.data === "object") return unwrapFeishuClientVarsPayload(payload.data);
  if (payload.CLIENT_VARS && typeof payload.CLIENT_VARS === "object") return unwrapFeishuClientVarsPayload(payload.CLIENT_VARS);
  if (payload.clientVars && typeof payload.clientVars === "object") return unwrapFeishuClientVarsPayload(payload.clientVars);
  return null;
}
__name(unwrapFeishuClientVarsPayload, "unwrapFeishuClientVarsPayload");
function collectFeishuRichText(value, output = [], key = "") {
  if (value === void 0 || value === null) return output;
  const normalizedKey = String(key || "").toLowerCase();
  if (typeof value === "string") {
    if (["text", "content", "title", "name", "plain_text", "plainText"].some((item) => normalizedKey === item.toLowerCase())) {
      const text = value.replace(/\s+/g, " ").trim();
      if (text) output.push(text);
    }
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectFeishuRichText(item, output, key));
    return output;
  }
  if (typeof value !== "object") return output;
  if (["text", "content", "title", "name", "plain_text", "plaintext"].includes(normalizedKey)) {
    Object.values(value).forEach((item) => {
      if (typeof item === "string") {
        const text = item.replace(/\s+/g, " ").trim();
        if (text) output.push(text);
      }
    });
  }
  if (value.initialAttributedTexts && typeof value.initialAttributedTexts === "object") {
    collectFeishuRichText(value.initialAttributedTexts, output, "text");
  }
  if (value.text && typeof value.text === "object" && value.text.initialAttributedTexts) {
    collectFeishuRichText(value.text, output, "text");
  }
  if (value.nodes && Array.isArray(value.nodes)) {
    value.nodes.forEach((node) => collectFeishuRichText(node, output, "text"));
  }
  Object.entries(value).forEach(([childKey, childValue]) => {
    if (["id", "token", "parent_id", "parentId", "children", "type", "block_type"].includes(childKey)) return;
    collectFeishuRichText(childValue, output, childKey);
  });
  return output;
}
__name(collectFeishuRichText, "collectFeishuRichText");
var FEISHU_NUMERIC_BLOCK_TYPE_NAMES = {
  1: "page",
  2: "text",
  3: "heading1",
  4: "heading2",
  5: "heading3",
  6: "heading4",
  7: "heading5",
  8: "heading6",
  9: "heading7",
  10: "heading8",
  11: "heading9",
  12: "bullet",
  13: "ordered",
  14: "code",
  15: "quote",
  17: "todo",
  23: "file",
  27: "image",
  31: "table",
  32: "table_cell",
  33: "view"
};
function normalizeFeishuBlockTypeName(value) {
  const text = String(value || "").toLowerCase();
  return FEISHU_NUMERIC_BLOCK_TYPE_NAMES[text] || text;
}
__name(normalizeFeishuBlockTypeName, "normalizeFeishuBlockTypeName");
function getFeishuBlockType(block) {
  const data = block && block.data && typeof block.data === "object" ? block.data : block || {};
  return normalizeFeishuBlockTypeName(data.type || data.block_type || block.type || block.block_type || "");
}
__name(getFeishuBlockType, "getFeishuBlockType");
function getFeishuBlockText(block) {
  const data = block && block.data && typeof block.data === "object" ? block.data : block || {};
  return Array.from(new Set(collectFeishuRichText(data))).join(" ").replace(/\s+/g, " ").trim();
}
__name(getFeishuBlockText, "getFeishuBlockText");
function collectFeishuCodeText(value, output = [], key = "") {
  if (value === void 0 || value === null) return output;
  const normalizedKey = String(key || "").toLowerCase();
  if (typeof value === "string") {
    if (["content", "text", "plain_text", "plaintext"].includes(normalizedKey)) {
      output.push(value);
    }
    return output;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectFeishuCodeText(item, output, key));
    return output;
  }
  if (typeof value !== "object") return output;
  if (value.text_run && typeof value.text_run === "object") {
    collectFeishuCodeText(value.text_run, output, "text_run");
  }
  Object.entries(value).forEach(([childKey, childValue]) => {
    if (["id", "token", "parent_id", "parentId", "children", "type", "block_type"].includes(childKey)) return;
    collectFeishuCodeText(childValue, output, childKey);
  });
  return output;
}
__name(collectFeishuCodeText, "collectFeishuCodeText");
function getFeishuBlockCodeText(block) {
  const data = block && block.data && typeof block.data === "object" ? block.data : block || {};
  const source = data.code || data.Code || data;
  return collectFeishuCodeText(source).join("").replace(/\r\n/g, "\n").trim();
}
__name(getFeishuBlockCodeText, "getFeishuBlockCodeText");
function collectFeishuTableRowsFromValue(value, rows = []) {
  if (!value) return rows;
  if (Array.isArray(value)) {
    if (value.length && value.every((item) => Array.isArray(item) || item && typeof item === "object" && Array.isArray(item.cells))) {
      value.forEach((row) => {
        const cells2 = Array.isArray(row) ? row : row.cells;
        const next = cells2.map((cell) => getFeishuBlockText(cell) || collectFeishuRichText(cell).join(" ")).map((cell) => String(cell || "").trim());
        if (next.some(Boolean)) rows.push(next);
      });
      return rows;
    }
    value.forEach((item) => collectFeishuTableRowsFromValue(item, rows));
    return rows;
  }
  if (typeof value !== "object") return rows;
  const directRows = value.rows || value.row_list || value.rowList;
  if (Array.isArray(directRows)) {
    collectFeishuTableRowsFromValue(directRows, rows);
  }
  const cells = value.cells || value.cell_list || value.cellList;
  if (Array.isArray(cells) && cells.length) {
    const matrix = [];
    cells.forEach((cell, index) => {
      const rowIndex = Number(cell.row || cell.rowIndex || cell.row_index || cell.r || 0);
      const colIndex = Number(cell.col || cell.colIndex || cell.col_index || cell.c || index);
      if (!matrix[rowIndex]) matrix[rowIndex] = [];
      matrix[rowIndex][colIndex] = getFeishuBlockText(cell) || collectFeishuRichText(cell).join(" ");
    });
    matrix.filter(Boolean).forEach((row) => {
      const normalized = row.map((cell) => String(cell || "").trim());
      if (normalized.some(Boolean)) rows.push(normalized);
    });
  }
  return rows;
}
__name(collectFeishuTableRowsFromValue, "collectFeishuTableRowsFromValue");
function formatMarkdownTableRows(rows) {
  const normalizedSource = (rows || []).filter((row) => Array.isArray(row) && row.some(Boolean));
  if (!normalizedSource.length) return "";
  const columnCount = Math.max(...normalizedSource.map((row) => row.length));
  const normalizedRows = normalizedSource.map((row) => {
    const next = row.map((cell) => String(cell || "").replace(/\|/g, "\\|").trim()).slice(0, columnCount);
    while (next.length < columnCount) next.push("");
    return next;
  });
  const header = normalizedRows[0];
  return [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...normalizedRows.slice(1).map((row) => `| ${row.join(" | ")} |`)
  ].join("\n");
}
__name(formatMarkdownTableRows, "formatMarkdownTableRows");
function isFeishuTableType(type) {
  const t = String(type || "").toLowerCase();
  return t === "table" || t === "31";
}
__name(isFeishuTableType, "isFeishuTableType");
function isFeishuTableCellType(type) {
  const t = String(type || "").toLowerCase();
  return t === "table_cell" || t === "tablecell" || t === "32";
}
__name(isFeishuTableCellType, "isFeishuTableCellType");
function isFeishuImageType(type) {
  const t = String(type || "").toLowerCase();
  return t === "image" || t === "27";
}
__name(isFeishuImageType, "isFeishuImageType");
function getFeishuBlockChildrenIds(value) {
  const ids = [];
  if (!value || typeof value !== "object") return ids;
  const keys = ["children", "child_ids", "childIds", "children_ids", "childrenIds", "block_ids", "blockIds"];
  keys.forEach((key) => {
    const v = value[key];
    if (!Array.isArray(v)) return;
    v.forEach((item) => {
      if (typeof item === "string" && item.trim()) {
        ids.push(item.trim());
      } else if (item && typeof item === "object") {
        const id = item.id || item.block_id || item.blockId;
        if (typeof id === "string" && id.trim()) ids.push(id.trim());
      }
    });
  });
  return ids;
}
__name(getFeishuBlockChildrenIds, "getFeishuBlockChildrenIds");
function getFeishuCellTextFromBlock(block, blockMap, depth = 0) {
  if (!block || depth > 6) return "";
  const data = block && block.data && typeof block.data === "object" ? block.data : block || {};
  let text = getFeishuBlockText(block);
  if (text) return text;
  const childIds = getFeishuBlockChildrenIds(data);
  if (!childIds.length || !blockMap) return "";
  const parts = [];
  childIds.forEach((cid) => {
    const cb = blockMap[cid];
    if (!cb) return;
    const t = getFeishuCellTextFromBlock(cb, blockMap, depth + 1);
    if (t) parts.push(t);
  });
  return parts.join(" ").replace(/\s+/g, " ").trim();
}
__name(getFeishuCellTextFromBlock, "getFeishuCellTextFromBlock");
function formatFeishuClientVarTableBlock(block, blockMap) {
  const data = block && block.data && typeof block.data === "object" ? block.data : block || {};
  const table = data.table || data.Table || data;
  const property = table && table.property || table && table.Property || {};
  let rowSize = Number(property.row_size || property.rowSize || 0);
  let colSize = Number(property.column_size || property.columnSize || 0);
  const cellIds = table && (table.cells || table.Cells) || [];
  if (Array.isArray(cellIds) && cellIds.length && blockMap) {
    if (!colSize) colSize = Math.ceil(Math.sqrt(cellIds.length));
    if (!rowSize) rowSize = Math.ceil(cellIds.length / colSize);
    if (rowSize > 0 && colSize > 0) {
      const matrix = [];
      cellIds.forEach((cellId, index) => {
        const r = Math.floor(index / colSize);
        const c = index % colSize;
        if (!matrix[r]) matrix[r] = [];
        const id = String(cellId || "").trim();
        const cellBlock = blockMap[id];
        matrix[r][c] = cellBlock ? getFeishuCellTextFromBlock(cellBlock, blockMap) : "";
      });
      const rows = matrix.filter(Boolean).map((row) => row.map((cell) => String(cell || "").trim()));
      if (rows.length >= 1 && rows.some((row) => row.some(Boolean))) {
        return formatMarkdownTableRows(rows);
      }
    }
  }
  const legacyRows = collectFeishuTableRowsFromValue(data, []);
  if (legacyRows.length >= 2) return formatMarkdownTableRows(legacyRows);
  return "";
}
__name(formatFeishuClientVarTableBlock, "formatFeishuClientVarTableBlock");
function extractFeishuImageToken(block) {
  const data = block && block.data && typeof block.data === "object" ? block.data : block || {};
  const img = data.image || data.Image || {};
  const token = img.token || img.file_token || img.fileToken || data.token || data.file_token || data.fileToken;
  return String(token || "").trim();
}
__name(extractFeishuImageToken, "extractFeishuImageToken");
function collectFeishuBlockImageUrls(block) {
  const data = block && block.data && typeof block.data === "object" ? block.data : block || {};
  const urls = [];
  const token = extractFeishuImageToken(block);
  if (token && !urls.includes(`feishu-image:${token}`)) {
    urls.push(`feishu-image:${token}`);
  }
  collectFeishuImageUrls(JSON.stringify(data || {})).forEach((url) => pushUniqueUrl(urls, url));
  collectJsonStringValues(JSON.stringify(data || {}), [
    "origin_url",
    "originUrl",
    "preview_url",
    "previewUrl",
    "download_url",
    "downloadUrl",
    "src",
    "url"
  ]).forEach((url) => {
    if (isLikelyImageUrl(url)) pushUniqueUrl(urls, url);
  });
  return urls;
}
__name(collectFeishuBlockImageUrls, "collectFeishuBlockImageUrls");
function collectFeishuBlockMediaUrls(block) {
  const data = block && block.data && typeof block.data === "object" ? block.data : block || {};
  const urls = [];
  collectJsonStringValues(JSON.stringify(data || {}), [
    "origin_url",
    "originUrl",
    "preview_url",
    "previewUrl",
    "download_url",
    "downloadUrl",
    "src",
    "url",
    "file_url",
    "fileUrl",
    "media_url",
    "mediaUrl",
    "video_url",
    "videoUrl",
    "play_url",
    "playUrl"
  ]).forEach((url) => {
    if (isLikelyMediaUrl(url)) pushUniqueUrl(urls, url);
  });
  return urls;
}
__name(collectFeishuBlockMediaUrls, "collectFeishuBlockMediaUrls");
function getFeishuBlockMediaLabel(block, text = "") {
  if (isFeishuAssetPlaceholderLine(text)) return text;
  const data = block && block.data && typeof block.data === "object" ? block.data : block || {};
  const labels = collectJsonStringValues(JSON.stringify(data || {}), [
    "name",
    "file_name",
    "fileName",
    "title"
  ]).filter((item) => /\.(?:mp4|mov|m4v|webm|avi|mkv|mp3|m4a|wav|aac|flac)$/i.test(String(item || "").trim()));
  return labels[0] || text || "媒体文件";
}
__name(getFeishuBlockMediaLabel, "getFeishuBlockMediaLabel");
function getFeishuHeadingLevelFromBlock(block, type) {
  const data = block && block.data && typeof block.data === "object" ? block.data : block || {};
  const headingMatch = String(type || "").match(/heading[_-]?([1-6])|h([1-6])/);
  if (headingMatch) return Number(headingMatch[1] || headingMatch[2] || 1);
  const numericLevel = Number(data.heading_level || data.headingLevel || data.level || data.text_level || data.textLevel || 0);
  return numericLevel >= 1 && numericLevel <= 6 ? numericLevel : 0;
}
__name(getFeishuHeadingLevelFromBlock, "getFeishuHeadingLevelFromBlock");
function formatFeishuClientVarBlock(block, blockMap) {
  const text = getFeishuBlockText(block);
  const type = getFeishuBlockType(block);
  if (isFeishuTableCellType(type)) return "";
  if (isFeishuTableType(type) || /sheet|grid/i.test(type)) {
    const table = formatFeishuClientVarTableBlock(block, blockMap);
    if (table) return table;
  }
  if (isFeishuImageType(type) || /picture|diagram/i.test(type)) {
    const imageUrls = collectFeishuBlockImageUrls(block);
    if (imageUrls.length) {
      return imageUrls.map((url, index) => `![图片${index ? ` ${index + 1}` : ""}](${url})`).join("\n\n");
    }
    return "";
  }
  if (/video|audio|media|file|attachment/i.test(type) || isFeishuAssetPlaceholderLine(text)) {
    const mediaUrls = collectFeishuBlockMediaUrls(block);
    if (mediaUrls.length) {
      const label = getFeishuBlockMediaLabel(block, text);
      return mediaUrls.map((url, index) => {
        const suffix = mediaUrls.length > 1 ? ` ${index + 1}` : "";
        return `[${label}${suffix}](${url})`;
      }).join("\n\n");
    }
  }
  if (!text || shouldDropFeishuLine(text, "")) return "";
  if (/code/.test(type)) return `\`\`\`
${getFeishuBlockCodeText(block) || text}
\`\`\``;
  if (/quote/.test(type)) return text.split(/\r?\n/).map((line) => `> ${line}`).join("\n");
  const headingLevel = getFeishuHeadingLevelFromBlock(block, type);
  if (headingLevel) {
    const level = headingLevel;
    return `${"#".repeat(Math.max(1, Math.min(6, level)))} ${text}`;
  }
  if (/bullet|unordered|todo|check/.test(type)) return `- ${text}`;
  if (/ordered|number/.test(type)) return `1. ${text}`;
  return formatFeishuHeadingLine(text);
}
__name(formatFeishuClientVarBlock, "formatFeishuClientVarBlock");
function collectFeishuBlockChildIds(value, ids = []) {
  if (!value) return ids;
  if (typeof value === "string") {
    if (value.trim()) ids.push(value.trim());
    return ids;
  }
  if (Array.isArray(value)) {
    value.forEach((item) => collectFeishuBlockChildIds(item, ids));
    return ids;
  }
  if (typeof value !== "object") return ids;
  const directKeys = [
    "children",
    "child_ids",
    "childIds",
    "children_ids",
    "childrenIds",
    "block_ids",
    "blockIds"
  ];
  directKeys.forEach((key) => {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      collectFeishuBlockChildIds(value[key], ids);
    }
  });
  ["id", "block_id", "blockId", "token"].forEach((key) => {
    const candidate = value[key];
    if (typeof candidate === "string" && candidate.trim()) ids.push(candidate.trim());
  });
  return ids;
}
__name(collectFeishuBlockChildIds, "collectFeishuBlockChildIds");
function markFeishuDescendantsSeen(blockId, blockMap, seen) {
  const block = blockMap[blockId];
  if (!block) return;
  const data = block && block.data && typeof block.data === "object" ? block.data : block || {};
  const table = data.table || data.Table;
  const childIds = Array.isArray(table && (table.cells || table.Cells)) ? table.cells || table.Cells : getFeishuBlockChildrenIds(data);
  childIds.forEach((cid) => {
    const id = typeof cid === "string" ? cid.trim() : String(cid && (cid.id || cid.block_id) || "").trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      markFeishuDescendantsSeen(id, blockMap, seen);
    }
  });
}
__name(markFeishuDescendantsSeen, "markFeishuDescendantsSeen");
function buildFeishuClientVarBlockSequence(clientVars, blockMap) {
  const initial = Array.isArray(clientVars.block_sequence) ? clientVars.block_sequence : Array.isArray(clientVars.blockSequence) ? clientVars.blockSequence : [];
  const ordered = [];
  const seen = /* @__PURE__ */ new Set();
  const push = /* @__PURE__ */ __name((id) => {
    const key = String(id || "").trim();
    if (!key || seen.has(key) || !blockMap[key]) return;
    seen.add(key);
    ordered.push(key);
    const block = blockMap[key];
    const data = block && block.data && typeof block.data === "object" ? block.data : block || {};
    const blockType = getFeishuBlockType(block);
    if (isFeishuTableType(blockType)) {
      markFeishuDescendantsSeen(key, blockMap, seen);
    } else if (!isFeishuTableCellType(blockType)) {
      collectFeishuBlockChildIds(data).forEach(push);
    }
  }, "push");
  initial.forEach(push);
  if (!ordered.length) {
    Object.entries(blockMap).forEach(([id, block]) => {
      const type = getFeishuBlockType(block);
      if (type === "page" || type === "root") push(id);
    });
  }
  Object.keys(blockMap).forEach(push);
  return ordered;
}
__name(buildFeishuClientVarBlockSequence, "buildFeishuClientVarBlockSequence");
function extractFeishuMarkdownFromClientVars(payload) {
  const clientVars = unwrapFeishuClientVarsPayload(payload);
  const blockMap = clientVars && (clientVars.block_map || clientVars.blockMap);
  if (!blockMap || typeof blockMap !== "object") {
    throw new Error("飞书 client_vars 中未找到 block_map");
  }
  const sequence = buildFeishuClientVarBlockSequence(clientVars, blockMap);
  const seen = /* @__PURE__ */ new Set();
  const lines = [];
  sequence.forEach((id) => {
    const block = blockMap[id];
    if (!block) return;
    const type = getFeishuBlockType(block);
    if (type === "page" || type === "root") return;
    const line = formatFeishuClientVarBlock(block, blockMap);
    if (!line) return;
    if (!line.startsWith("|")) {
      if (seen.has(line)) return;
      seen.add(line);
    }
    lines.push(line);
  });
  const markdown = lines.join("\n\n").trim();
  if (markdown.length < 20) {
    throw new Error("飞书 client_vars 中未提取到正文");
  }
  return markdown;
}
__name(extractFeishuMarkdownFromClientVars, "extractFeishuMarkdownFromClientVars");
function appendMissingMarkdownImages(markdown, fallbackMarkdown = "") {
  const source = String(markdown || "").trim();
  if (source.includes("feishu-image:")) return source;
  const existing = /* @__PURE__ */ new Set();
  const collect = /* @__PURE__ */ __name((text) => {
    const pattern2 = /!\[[^\]]*]\(([^)]+)\)/g;
    let match2;
    while (match2 = pattern2.exec(String(text || ""))) {
      if (match2[1]) existing.add(match2[1]);
    }
  }, "collect");
  collect(source);
  const additions = [];
  const pattern = /!\[([^\]]*)]\(([^)]+)\)/g;
  let match;
  while (match = pattern.exec(String(fallbackMarkdown || ""))) {
    const alt = match[1] || "图片";
    const url = match[2] || "";
    if (!url || existing.has(url) || !isLikelyImageUrl(url) || isLikelyFeishuShellImage(alt, url)) continue;
    existing.add(url);
    additions.push(`![${alt || "图片"}](${url})`);
  }
  return additions.length ? `${source}

${additions.join("\n\n")}`.trim() : source;
}
__name(appendMissingMarkdownImages, "appendMissingMarkdownImages");
function isFeishuAssetPlaceholderLine(line) {
  const text = String(line || "").trim();
  if (!text || /^!\[/.test(text) || /^\[.+]\(.+\)$/.test(text)) return false;
  return /^[^\s\\/<>|?*:"]{2,180}\.(?:jpe?g|png|webp|gif|mp4|mov|m4v|webm|avi|mkv)$/i.test(text);
}
__name(isFeishuAssetPlaceholderLine, "isFeishuAssetPlaceholderLine");
function isLikelyFeishuShellImage(alt = "", url = "") {
  const source = `${alt || ""} ${url || ""}`.toLowerCase();
  if (!source) return false;
  if (/^blob:/.test(String(url || "").trim())) return true;
  return /avatar|portrait|profile|user[-_]?avatar|icon|logo|emoji|sticker|reaction|comment|header|toolbar/.test(source) || /头像|图标|表情|评论/.test(`${alt || ""} ${url || ""}`);
}
__name(isLikelyFeishuShellImage, "isLikelyFeishuShellImage");
function getFirstMarkdownHeading(markdown) {
  const lines = String(markdown || "").split(/\r?\n/);
  for (const line of lines) {
    const match = String(line || "").trim().match(/^#{1,6}\s+(.+)$/);
    if (match && match[1]) return match[1].trim();
  }
  return "";
}
__name(getFirstMarkdownHeading, "getFirstMarkdownHeading");
function cleanFeishuRenderedMarkdown(markdown, structuredMarkdown = "") {
  const title = getFirstMarkdownHeading(structuredMarkdown);
  const cleaned = cleanMarkdownForStorage(markdown, {
    dedupe: true,
    feishuTitle: title
  });
  return cleaned.split(/\r?\n/).filter((line) => {
    const imageMatch = String(line || "").trim().match(/^!\[([^\]]*)]\(([^)]+)\)$/);
    if (!imageMatch) return true;
    return !isLikelyFeishuShellImage(imageMatch[1], imageMatch[2]);
  }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}
__name(cleanFeishuRenderedMarkdown, "cleanFeishuRenderedMarkdown");
function getFeishuMarkdownBodyScore(markdown) {
  return String(markdown || "").split(/\r?\n/).map((line) => String(line || "").trim()).filter((line) => line && !/^!\[/.test(line) && !isFeishuAssetPlaceholderLine(line) && !shouldDropFeishuLine(line, "")).join("\n").replace(/\[[^\]]+]\([^)]+\)/g, " ").replace(/https?:\/\/[^\s<>()\]]+/gi, " ").replace(/^#{1,6}\s*/gm, "").replace(/^[-*]\s+/gm, "").replace(/\s+/g, "").length;
}
__name(getFeishuMarkdownBodyScore, "getFeishuMarkdownBodyScore");
function countFeishuAssetPlaceholders(markdown) {
  return String(markdown || "").split(/\r?\n/).filter((line) => isFeishuAssetPlaceholderLine(line)).length;
}
__name(countFeishuAssetPlaceholders, "countFeishuAssetPlaceholders");
function countMarkdownImages(markdown) {
  return (String(markdown || "").match(/!\[[^\]]*]\([^)]+\)/g) || []).length;
}
__name(countMarkdownImages, "countMarkdownImages");
function shouldRefreshFeishuMarkdownFromSource(url, metadata = {}) {
  if (!isFeishuUrl(url)) return false;
  const markdown = String(metadata.markdown || metadata.snapshot || metadata.contentSnapshot || "").trim();
  if (!markdown) return false;
  if (isFeishuMarkdownLikelyTruncated(markdown)) return true;
  const placeholderCount = countFeishuAssetPlaceholders(markdown);
  if (!placeholderCount) return false;
  const bodyScore = getFeishuMarkdownBodyScore(markdown);
  const imageCount = countMarkdownImages(markdown);
  const hasLinkedMedia = /\[[^\]]+\]\(https?:\/\/[^)]+\.(?:mp4|mov|m4v|webm|mp3|m4a|wav|aac|flac)(?:[?#][^)]*)?\)/i.test(markdown);
  return placeholderCount >= 2 || placeholderCount >= 1 && !imageCount && !hasLinkedMedia || placeholderCount >= 1 && bodyScore < 1500;
}
__name(shouldRefreshFeishuMarkdownFromSource, "shouldRefreshFeishuMarkdownFromSource");
function mergeFeishuRenderedAndClientVarsMarkdown(renderedMarkdown = "", clientVarsMarkdown = "") {
  const structured = cleanMarkdownForStorage(String(clientVarsMarkdown || "").trim(), { dedupe: true });
  const rendered = cleanFeishuRenderedMarkdown(renderedMarkdown, structured);
  if (structured.length >= 20) {
    const structuredScore = getFeishuMarkdownBodyScore(structured);
    const renderedScore = getFeishuMarkdownBodyScore(rendered);
    const structuredPlaceholders = countFeishuAssetPlaceholders(structured);
    const renderedHasBodyMedia = countMarkdownImages(rendered) > 0;
    const renderedIsSubstantiallyRicher = renderedScore >= 160 && renderedScore >= Math.max(structuredScore * 1.45, structuredScore + 80);
    if (rendered && (renderedIsSubstantiallyRicher || structuredPlaceholders >= 2 && renderedHasBodyMedia && renderedScore > structuredScore)) {
      return appendMissingMarkdownImages(rendered, structured);
    }
    return appendMissingMarkdownImages(structured, rendered);
  }
  return rendered || String(renderedMarkdown || "").trim();
}
__name(mergeFeishuRenderedAndClientVarsMarkdown, "mergeFeishuRenderedAndClientVarsMarkdown");
function extractFeishuDocumentTokenFromUrl(url) {
  try {
    const parsed = new URL(String(url || ""));
    const match = parsed.pathname.match(/\/(?:docx|wiki)\/([^/?#]+)/i);
    return match ? decodeURIComponent(match[1]) : "";
  } catch (error) {
    const match = String(url || "").match(/\/(?:docx|wiki)\/([^/?#]+)/i);
    return match ? decodeURIComponent(match[1]) : "";
  }
}
__name(extractFeishuDocumentTokenFromUrl, "extractFeishuDocumentTokenFromUrl");
function buildFeishuClientVarsApiUrl(url) {
  const token = extractFeishuDocumentTokenFromUrl(url);
  if (!token) return "";
  const parsed = new URL(String(url || ""));
  parsed.pathname = "/space/api/docx/pages/client_vars";
  parsed.search = `?id=${encodeURIComponent(token)}`;
  parsed.hash = "";
  return parsed.toString();
}
__name(buildFeishuClientVarsApiUrl, "buildFeishuClientVarsApiUrl");
function extractFeishuOpenApiUrlInfo(url) {
  const source = String(url || "").trim();
  if (!source) return null;
  let parsed = null;
  try {
    parsed = new URL(source);
  } catch (error) {
    parsed = null;
  }
  const path2 = parsed ? parsed.pathname : source;
  const match = String(path2 || "").match(/\/(wiki|docx|docs|doc)\/([^/?#]+)/i);
  if (!match) return null;
  const host = String(parsed && parsed.hostname || "").toLowerCase();
  const isLark = /(?:^|\.)larksuite\.com$|(?:^|\.)larkoffice\.com$/.test(host);
  const kind = match[1].toLowerCase();
  return {
    apiBase: isLark ? "https://open.larksuite.com/open-apis" : "https://open.feishu.cn/open-apis",
    kind: kind === "docs" ? "doc" : kind,
    token: decodeURIComponent(match[2])
  };
}
__name(extractFeishuOpenApiUrlInfo, "extractFeishuOpenApiUrlInfo");
function buildFeishuOpenApiUrl(apiBase, path2, params = {}) {
  const base = String(apiBase || "https://open.feishu.cn/open-apis").replace(/\/+$/, "");
  const url = new URL(`${base}${path2.startsWith("/") ? path2 : `/${path2}`}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== void 0 && value !== null && String(value) !== "") {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}
__name(buildFeishuOpenApiUrl, "buildFeishuOpenApiUrl");
async function requestFeishuOpenApiJson({
  apiBase,
  path: path2,
  method = "GET",
  token = "",
  body = null,
  params = {},
  requestJson = requestUrl
}) {
  const url = /^https?:\/\//i.test(String(path2 || "")) ? String(path2) : buildFeishuOpenApiUrl(apiBase, path2, params);
  const headers = {
    "Content-Type": "application/json; charset=utf-8"
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await requestJson({
    url,
    method,
    headers,
    body: body ? JSON.stringify(body) : void 0,
    throw: false
  });
  const status = Number(response && response.status);
  const payload = response && response.json || tryParseJson(response && response.text || "") || {};
  const apiErrorMessage = payload && (payload.msg || payload.message) ? `飞书 OpenAPI 返回 code ${payload.code || status}：${payload.msg || payload.message}` : "";
  if (status && (status < 200 || status >= 300)) {
    throw new Error(apiErrorMessage || `飞书 OpenAPI 请求失败：HTTP ${status}`);
  }
  if (payload && Number(payload.code || 0) !== 0) {
    throw new Error(apiErrorMessage || `飞书 OpenAPI 返回 code ${payload.code}`);
  }
  return payload;
}
__name(requestFeishuOpenApiJson, "requestFeishuOpenApiJson");
async function fetchFeishuTenantAccessToken({ apiBase, appId, appSecret, requestJson = requestUrl }) {
  const normalizedAppId = String(appId || "").trim();
  const normalizedSecret = String(appSecret || "").trim();
  if (!normalizedAppId || !normalizedSecret) {
    throw new Error("未配置飞书自建应用凭据");
  }
  const payload = await requestFeishuOpenApiJson({
    apiBase,
    path: "/auth/v3/tenant_access_token/internal",
    method: "POST",
    body: {
      app_id: normalizedAppId,
      app_secret: normalizedSecret
    },
    requestJson
  });
  const token = String(payload.tenant_access_token || "").trim();
  if (!token) throw new Error("飞书 OpenAPI 未返回 tenant_access_token");
  return {
    token,
    expire: Number(payload.expire || 0)
  };
}
__name(fetchFeishuTenantAccessToken, "fetchFeishuTenantAccessToken");
async function resolveFeishuOpenApiDocument(url, token, { requestJson = requestUrl } = {}) {
  const info = extractFeishuOpenApiUrlInfo(url);
  if (!info || !info.token) throw new Error("飞书链接中未找到文档 token");
  if (info.kind === "wiki") {
    const payload = await requestFeishuOpenApiJson({
      apiBase: info.apiBase,
      path: "/wiki/v2/spaces/get_node",
      token,
      params: { token: info.token },
      requestJson
    });
    const node = payload && payload.data && payload.data.node;
    const documentId = String(node && node.obj_token || "").trim();
    const objType = String(node && node.obj_type || "").toLowerCase();
    if (!documentId) throw new Error("飞书 wiki 节点未返回真实文档 token");
    if (objType && !/doc|docx/.test(objType)) {
      throw new Error(`飞书 wiki 节点不是文档类型：${objType}`);
    }
    return {
      ...info,
      documentId,
      title: String(node && node.title || "").trim(),
      objType
    };
  }
  return {
    ...info,
    documentId: info.token,
    title: "",
    objType: info.kind
  };
}
__name(resolveFeishuOpenApiDocument, "resolveFeishuOpenApiDocument");
async function fetchFeishuOpenApiDocumentTitle(documentInfo, token, { requestJson = requestUrl } = {}) {
  try {
    const payload = await requestFeishuOpenApiJson({
      apiBase: documentInfo.apiBase,
      path: `/docx/v1/documents/${encodeURIComponent(documentInfo.documentId)}`,
      token,
      requestJson
    });
    const document = payload && payload.data && payload.data.document;
    return String(document && document.title || payload.title || documentInfo.title || "").trim();
  } catch (error) {
    return documentInfo.title || "";
  }
}
__name(fetchFeishuOpenApiDocumentTitle, "fetchFeishuOpenApiDocumentTitle");
async function fetchFeishuOpenApiDocumentBlocks(documentInfo, token, { requestJson = requestUrl } = {}) {
  const items = [];
  let pageToken = "";
  for (let pageIndex = 0; pageIndex < FEISHU_OPEN_API_MAX_PAGES; pageIndex += 1) {
    const payload = await requestFeishuOpenApiJson({
      apiBase: documentInfo.apiBase,
      path: `/docx/v1/documents/${encodeURIComponent(documentInfo.documentId)}/blocks`,
      token,
      params: {
        page_size: FEISHU_OPEN_API_PAGE_SIZE,
        page_token: pageToken
      },
      requestJson
    });
    const data = payload && payload.data || {};
    const pageItems = Array.isArray(data.items) ? data.items : [];
    pageItems.forEach((item) => {
      if (item && typeof item === "object") items.push(item);
    });
    if (!data.has_more) break;
    pageToken = String(data.page_token || "").trim();
    if (!pageToken) {
      throw new Error("飞书 OpenAPI 分页中断：has_more=true 但缺少 page_token");
    }
  }
  if (!items.length) throw new Error("飞书 OpenAPI 未返回文档 block");
  return items;
}
__name(fetchFeishuOpenApiDocumentBlocks, "fetchFeishuOpenApiDocumentBlocks");
function extractFeishuMarkdownFromOpenApiBlocks(blocks) {
  const list = Array.isArray(blocks) ? blocks : [];
  const blockMap = {};
  const sequence = [];
  list.forEach((block) => {
    if (!block || typeof block !== "object") return;
    const id = String(block.block_id || block.id || "").trim();
    if (!id) return;
    blockMap[id] = block;
    sequence.push(id);
  });
  if (!sequence.length) throw new Error("飞书 OpenAPI blocks 中未找到 block_id");
  return extractFeishuMarkdownFromClientVars({
    block_sequence: sequence,
    block_map: blockMap
  });
}
__name(extractFeishuMarkdownFromOpenApiBlocks, "extractFeishuMarkdownFromOpenApiBlocks");
async function fetchFeishuOpenApiMarkdownFromUrl(url, {
  appId = "",
  appSecret = "",
  tenantAccessToken = "",
  requestJson = requestUrl
} = {}) {
  const info = extractFeishuOpenApiUrlInfo(url);
  if (!info) throw new Error("不是可识别的飞书文档链接");
  const accessToken = String(tenantAccessToken || "").trim() || (await fetchFeishuTenantAccessToken({
    apiBase: info.apiBase,
    appId,
    appSecret,
    requestJson
  })).token;
  const documentInfo = await resolveFeishuOpenApiDocument(url, accessToken, { requestJson });
  const [title, blocks] = await Promise.all([
    fetchFeishuOpenApiDocumentTitle(documentInfo, accessToken, { requestJson }),
    fetchFeishuOpenApiDocumentBlocks(documentInfo, accessToken, { requestJson })
  ]);
  const markdown = extractFeishuMarkdownFromOpenApiBlocks(blocks);
  return {
    source: "feishu-open-api",
    title: title || documentInfo.title || getFirstMarkdownHeading(markdown) || "飞书链接",
    markdown,
    documentId: documentInfo.documentId,
    blockCount: blocks.length
  };
}
__name(fetchFeishuOpenApiMarkdownFromUrl, "fetchFeishuOpenApiMarkdownFromUrl");
function getFeishuRequestHeaders(url) {
  return {
    Accept: "application/json, text/plain, */*",
    Referer: String(url || ""),
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36"
  };
}
__name(getFeishuRequestHeaders, "getFeishuRequestHeaders");
async function fetchFeishuClientVarsMarkdown(url) {
  const apiUrl = buildFeishuClientVarsApiUrl(url);
  if (!apiUrl) throw new Error("飞书链接中未找到文档 token");
  const response = await requestUrl({
    url: apiUrl,
    method: "GET",
    headers: getFeishuRequestHeaders(url)
  });
  const payload = response.json || JSON.parse(response.text || "{}");
  if (payload && payload.code && payload.code !== 0) {
    throw new Error(payload.msg || `飞书 client_vars 接口返回 code ${payload.code}`);
  }
  return extractFeishuMarkdownFromClientVars(payload);
}
__name(fetchFeishuClientVarsMarkdown, "fetchFeishuClientVarsMarkdown");
function buildFeishuImageFallbackUrl(token, docUrl) {
  const t = String(token || "").trim();
  if (!t) return "";
  let origin = "";
  try {
    origin = new URL(String(docUrl || "")).origin;
  } catch (error) {
    origin = "https://feishu.cn";
  }
  return `${origin}/space/api/box/stream/download/v2/cover/${encodeURIComponent(t)}?width=0&height=0&policy=equal`;
}
__name(buildFeishuImageFallbackUrl, "buildFeishuImageFallbackUrl");
function replaceFeishuImageTokenPlaceholders(markdown, assets, docUrl, tokenUrlMap = {}) {
  let result = String(markdown || "");
  if (!result.includes("feishu-image:")) return result;
  const tokenPattern = /!\[([^\]]*)\]\(feishu-image:([^)]+)\)/g;
  result = result.replace(tokenPattern, (full, alt, token) => {
    const t = String(token || "").trim();
    if (!t) return full;
    const mappedUrl = String(tokenUrlMap && tokenUrlMap[t] || "").trim();
    if (/^https?:\/\//i.test(mappedUrl)) {
      return `![${alt || "图片"}](${mappedUrl})`;
    }
    if (Array.isArray(assets)) {
      for (const asset of assets) {
        const src = String(asset && asset.src || "");
        if (src && src.indexOf(t) !== -1 && /^https?:\/\//i.test(src)) {
          return `![${alt || "图片"}](${src})`;
        }
      }
    }
    const fallback = buildFeishuImageFallbackUrl(t, docUrl);
    return fallback ? `![${alt || "图片"}](${fallback})` : full;
  });
  return result;
}
__name(replaceFeishuImageTokenPlaceholders, "replaceFeishuImageTokenPlaceholders");
function getRecordUrl(record, metadata = record && record.metadata || {}) {
  return cleanDisplayUrl(metadata.url || metadata.originalUrl || record.content || "");
}
__name(getRecordUrl, "getRecordUrl");
function getRecordSourceLabel(record, metadata = {}) {
  const type = String(record && record.type || "").toLowerCase();
  const url = getRecordUrl(record, metadata);
  let platform = metadata.platform || metadata.platformName || "";
  if (!platform) platform = getWebpageSourcePrefix(url);
  if (!platform && type === "voice") platform = "录音";
  if (!platform && type === "file") platform = "文件";
  if (!platform && type === "text") platform = "文本";
  if (!platform) platform = record.source || "微信小程序";
  let category = metadata.contentCategory || metadata.category || metadata.noteType || "";
  if (!category) {
    if (type === "voice") category = "录音";
    else if (type === "file") category = metadata.fileExt ? String(metadata.fileExt).toUpperCase() : "文件";
    else if (metadata.transcriptOnly || metadata.webpageMediaType === "audio_video") category = "音视频";
    else if (type === "webpage" || type === "link") category = "图文";
  }
  const normalizedPlatform = String(platform || "").trim();
  const normalizedCategory = String(category || "").trim();
  if (normalizedPlatform && normalizedCategory && !normalizedPlatform.includes(normalizedCategory)) {
    return `${normalizedPlatform}${normalizedCategory}`;
  }
  return normalizedPlatform || normalizedCategory || "";
}
__name(getRecordSourceLabel, "getRecordSourceLabel");
var aiMetadataHelpers = createAiMetadataHelpers({
  tryParseJson,
  cleanMarkdownForStorage,
  stripMarkdownCodeBlocks
});
var {
  normalizeGeneratedKeywords,
  parseGeneratedMetadataResponse,
  normalizeGeneratedMetadataResult,
  extractAiMetadataInputText
} = aiMetadataHelpers;
var recordBodyMarkdownHelpers = createRecordBodyMarkdownHelpers({
  cleanDisplayUrl,
  cleanMarkdownForStorage,
  extractKeywordsFromText,
  formatCreatedTime,
  getWebpageSourcePrefix,
  isFeishuUrl,
  isWechatChannelsUrl,
  isXiaohongshuUrl,
  normalizeExtractedUrl,
  sanitizeXiaohongshuMarkdownImages,
  stripMarkdownCodeBlocks
});
var {
  buildAudioTranscriptMarkdown,
  buildFileMarkdownBody,
  buildSourceMediaAttachmentMarkdown,
  buildTranscriptOnlyMetadata,
  buildTranscriptPropertyMetadata,
  buildWebpageMarkdownBody
} = recordBodyMarkdownHelpers;
var noteOutputPlanHelpers = createNoteOutputPlanHelpers({
  buildAiMetadataErrorComment,
  buildFileMarkdownBody,
  buildRecordIdMarker,
  buildWebpageMarkdownBody,
  cleanDisplayUrl,
  defaultNotePropertyFields: DEFAULT_NOTE_PROPERTY_FIELDS,
  getRecordAuthor,
  getRecordDescription,
  getRecordId,
  getRecordKeywords,
  getRecordSourceLabel,
  getRecordUrl,
  getWebpageSourcePrefix,
  isFeishuUrl,
  isSuccessfulTranscriptionRecord,
  normalizeNotePropertyFields,
  normalizeVaultPath
});
var {
  buildRecordFrontmatter,
  buildMarkdownForRecord,
  buildNoteOutputPlan
} = noteOutputPlanHelpers;
function getRecordConversionWarning(record) {
  if (!record) return "";
  const metadata = record.metadata || {};
  const aiMetadataWarning = metadata.aiMetadataError ? buildAiMetadataConversionWarning(metadata.aiMetadataError) : "";
  const imageLocalizationFailedCount = Number(metadata.imageLocalizationFailedCount) || 0;
  const imageTempUrlMissingCount = Number(metadata.imageTempUrlMissingCount) || 0;
  const imageFailureCount = Math.max(imageLocalizationFailedCount, imageTempUrlMissingCount);
  const diagnosticParts = [];
  const transportDiagnostic = metadata.conversionDiagnostic && typeof metadata.conversionDiagnostic === "object" ? metadata.conversionDiagnostic : null;
  if (transportDiagnostic) {
    const attempts = Array.isArray(transportDiagnostic.attempts) ? transportDiagnostic.attempts : [];
    const attemptSummary = attempts.map((attempt) => {
      const error = attempt && attempt.error && typeof attempt.error === "object" ? attempt.error : {};
      const code = String(error.code || "").trim();
      const status2 = Number(error.status) || 0;
      const detail = code || (status2 ? `HTTP ${status2}` : String(error.message || "").trim());
      return `${String(attempt.transport || "unknown")}${detail ? `=${detail}` : ""}`;
    }).filter(Boolean).slice(0, 4);
    if (attemptSummary.length) diagnosticParts.push(`网页通道：${attemptSummary.join("；")}`);
  }
  const mediaDiagnostic = metadata.mediaResolutionDiagnostic && typeof metadata.mediaResolutionDiagnostic === "object" ? metadata.mediaResolutionDiagnostic : null;
  if (mediaDiagnostic) {
    const failedStages = (Array.isArray(mediaDiagnostic.stages) ? mediaDiagnostic.stages : []).filter((stage) => stage && stage.ok === false).map((stage) => {
      const error = stage.error && typeof stage.error === "object" ? stage.error : {};
      return `${String(stage.stage || "media")}${error.code ? `=${error.code}` : error.status ? `=HTTP ${error.status}` : ""}`;
    }).filter(Boolean).slice(0, 4);
    if (failedStages.length || Number(mediaDiagnostic.mediaCandidateCount) === 0) {
      diagnosticParts.push(`媒体解析：候选 ${Number(mediaDiagnostic.mediaCandidateCount) || 0} 个${failedStages.length ? `；${failedStages.join("；")}` : ""}`);
    }
  }
  const diagnosticNotice = diagnosticParts.join("；");
  if (imageFailureCount > 0) {
    const details = [];
    if (imageTempUrlMissingCount > 0) {
      details.push(`飞书未返回 ${imageTempUrlMissingCount} 张图片地址`);
    }
    const localizationError = String(metadata.imageLocalizationError || "").trim();
    if (localizationError) details.push(localizationError);
    const imageWarning = `飞书图片有 ${imageFailureCount} 张未保存${details.length ? `：${details.join("；")}` : ""}`;
    return [imageWarning, diagnosticNotice, aiMetadataWarning].filter(Boolean).join("；");
  }
  const status = metadata.conversionStatus || metadata.transcriptionStatus || "";
  const errorMsg = metadata.conversionError || metadata.transcriptionError || "";
  if (status === "failed") {
    return [errorMsg || "网页转写失败（未知原因）", diagnosticNotice, aiMetadataWarning].filter(Boolean).join("；");
  }
  if (status === "wechat_captcha") {
    return ["微信安全验证拦截", aiMetadataWarning].filter(Boolean).join("；");
  }
  if (status === "link_saved") {
    return [errorMsg || "网页抓取未成功", diagnosticNotice, aiMetadataWarning].filter(Boolean).join("；");
  }
  return aiMetadataWarning;
}
__name(getRecordConversionWarning, "getRecordConversionWarning");
var LocalComponentInstallConfirmModalBase = Modal || class {
};
var _LocalComponentInstallConfirmModal = class _LocalComponentInstallConfirmModal extends LocalComponentInstallConfirmModalBase {
  constructor(app, options = {}) {
    super(app);
    this.message = String(options.message || "");
    this.resolve = typeof options.resolve === "function" ? options.resolve : () => {
    };
    this.finished = false;
  }
  finish(value) {
    if (this.finished) return;
    this.finished = true;
    this.resolve(Boolean(value));
    this.close();
  }
  onOpen() {
    const contentEl = this.contentEl;
    if (!contentEl) return;
    contentEl.empty();
    contentEl.createEl("h3", { text: "本地转写组件准备" });
    this.message.split("\n").map((line) => line.trim()).filter(Boolean).forEach((line) => contentEl.createEl("p", { text: line }));
    const buttonRow = contentEl.createDiv({ cls: "wechat-inbox-sync-modal-actions" });
    const confirmButton = buttonRow.createEl("button", { text: "开始安装/修复" });
    if (typeof confirmButton.addClass === "function") {
      confirmButton.addClass("mod-cta");
    } else {
      confirmButton.className = `${confirmButton.className || ""} mod-cta`.trim();
    }
    confirmButton.addEventListener("click", () => this.finish(true));
    const laterButton = buttonRow.createEl("button", { text: "稍后再试" });
    laterButton.addEventListener("click", () => this.finish(false));
  }
  onClose() {
    if (this.contentEl) this.contentEl.empty();
    if (!this.finished) {
      this.finished = true;
      this.resolve(false);
    }
  }
};
__name(_LocalComponentInstallConfirmModal, "LocalComponentInstallConfirmModal");
var LocalComponentInstallConfirmModal = _LocalComponentInstallConfirmModal;
function showLocalComponentInstallConfirm(app, message) {
  if (!Modal || !app) return null;
  return new Promise((resolve) => {
    new LocalComponentInstallConfirmModal(app, { message, resolve }).open();
  });
}
__name(showLocalComponentInstallConfirm, "showLocalComponentInstallConfirm");
var _LocalComponentInstallFailureModal = class _LocalComponentInstallFailureModal extends LocalComponentInstallConfirmModalBase {
  constructor(app, options = {}) {
    super(app);
    this.message = String(options.message || "");
  }
  onOpen() {
    const contentEl = this.contentEl;
    if (!contentEl) return;
    contentEl.empty();
    contentEl.createEl("h3", { text: "本地转写组件安装失败" });
    this.message.split("\n").map((line) => line.trim()).filter(Boolean).forEach((line) => contentEl.createEl("p", { text: line }));
    const buttonRow = contentEl.createDiv({ cls: "wechat-inbox-sync-modal-actions" });
    const closeButton = buttonRow.createEl("button", { text: "知道了" });
    if (typeof closeButton.addClass === "function") {
      closeButton.addClass("mod-cta");
    } else {
      closeButton.className = `${closeButton.className || ""} mod-cta`.trim();
    }
    closeButton.addEventListener("click", () => this.close());
  }
  onClose() {
    if (this.contentEl) this.contentEl.empty();
  }
};
__name(_LocalComponentInstallFailureModal, "LocalComponentInstallFailureModal");
var LocalComponentInstallFailureModal = _LocalComponentInstallFailureModal;
function showLocalComponentInstallFailure(app, message) {
  if (!Modal || !app) return null;
  return new Promise((resolve) => {
    const modal = new LocalComponentInstallFailureModal(app, { message });
    const originalOnClose = modal.onClose.bind(modal);
    modal.onClose = () => {
      originalOnClose();
      resolve(true);
    };
    modal.open();
  });
}
__name(showLocalComponentInstallFailure, "showLocalComponentInstallFailure");
function formatLocalComponentInstallFailureReason(error) {
  const rawMessage = String(error && (error.message || error) || "未知错误").trim();
  const lines = rawMessage.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const isCurlProgressLine = /* @__PURE__ */ __name((line) => /^%?\s*Total\s+%?\s*Received/i.test(line) || /Dload\s+Upload\s+Total\s+Spent\s+Left\s+Speed/i.test(line) || /^\d+\s+\d+\s+\d+\s+\d+\s+\d+\s+\d+/.test(line) || /^-+:\s*-+:\s*-+/.test(line), "isCurlProgressLine");
  const isFailureLine = /* @__PURE__ */ __name((line) => /curl:\s*\(\d+\)|status\s*=\s*failed|failed|failure|error|exception|traceback|connection reset|timed out|timeout|not found|permission denied|denied|无法|失败|错误|异常|超时|未找到|拒绝/i.test(line), "isFailureLine");
  const failureLines = lines.filter((line) => !isCurlProgressLine(line) && isFailureLine(line));
  const cleanLines = failureLines.length ? failureLines : lines.filter((line) => !isCurlProgressLine(line));
  return cleanLines.slice(0, 6).join("\n") || "未知错误";
}
__name(formatLocalComponentInstallFailureReason, "formatLocalComponentInstallFailureReason");
var _WechatObsidianInboxPlugin = class _WechatObsidianInboxPlugin extends Plugin {
  async onload() {
    const savedSettings = await this.loadData();
    this.settings = mergeSettings(savedSettings);
    if (!savedSettings || !savedSettings.clientId || shouldPersistNormalizedInboxDir(savedSettings, this.settings) || shouldPersistAutoLocalAsrPlatform(savedSettings)) {
      await this.saveData(this.settings);
    }
    this.lastSyncDiagnostic = null;
    this.syncStatusBar = typeof this.addStatusBarItem === "function" ? this.addStatusBarItem() : null;
    if (this.syncStatusBar && typeof this.syncStatusBar.setText === "function") {
      this.syncStatusBar.setText("");
    }
    this.localAsrInstallPromise = null;
    this.localOcrInstallPromise = null;
    this.currentTranscriptionAbortController = null;
    this.currentTranscriptionProcess = null;
    this.currentTranscriptionProcessDetached = false;
    this.currentTranscriptionContext = null;
    this.currentProcessingAbortController = null;
    this.currentProcessingContext = null;
    this.pendingStoppedTranscriptionDeletes = /* @__PURE__ */ new Map();
    this.syncInboxPromise = null;
    if (this.getConfiguredLocalAsrPlatform() === "win32") {
      try {
        const switchResult = completePendingLocalOcrSwitch(this.getConfiguredLocalOcrInstallRoot());
        if (switchResult.status === "activated") {
          new Notice("图片文字识别 OCR 修复已自动完成。");
        }
      } catch (error) {
        console.warn("Failed to complete pending OCR environment switch:", error);
      }
    }
    this.addCommand({
      id: "sync-wechat-inbox",
      name: "同步微信收集箱",
      callback: /* @__PURE__ */ __name(() => this.syncInbox(), "callback")
    });
    this.addCommand({
      id: "stop-current-transcription",
      name: "停止当前转写",
      callback: /* @__PURE__ */ __name(async () => this.stopCurrentTranscription(), "callback")
    });
    this.addCommand({
      id: "login-xiaohongshu-web",
      name: "登录小红书（用于提取小红书评论区）",
      callback: /* @__PURE__ */ __name(() => this.loginXiaohongshu(), "callback")
    });
    this.addCommand({
      id: "restore-locally-quarantined-records",
      name: "恢复本机忽略的历史失败内容",
      callback: /* @__PURE__ */ __name(async () => {
        const count = normalizeLocallyQuarantinedRecordIds(
          this.settings.locallyQuarantinedRecordIds
        ).length;
        if (!count) {
          new Notice("当前没有在本机忽略的历史失败内容。");
          return;
        }
        await this.saveSettings({
          ...this.settings,
          locallyQuarantinedRecordIds: []
        });
        new Notice(`已恢复 ${count} 条历史失败内容，下次同步会重新尝试。`);
      }, "callback")
    });
    this.addRibbonIcon("inbox", "同步微信收集箱", () => {
      this.syncInbox();
    });
    this.transcriptionStopRibbon = this.addRibbonIcon("square", "暂停当前转写", () => this.stopCurrentTranscription());
    this.setTranscriptionStopAvailable(false);
    this.addSettingTab(new WechatInboxSettingTab(this.app, this));
    if (this.settings.autoSyncOnLoad) {
      window.setTimeout(() => this.syncInbox(false), 1e3);
    }
  }
  async saveSettings(nextSettings) {
    this.settings = mergeSettings(nextSettings);
    await this.saveData(this.settings);
  }
  setTranscriptionStopAvailable(available) {
    if (!this.transcriptionStopRibbon || !this.transcriptionStopRibbon.style) return;
    this.transcriptionStopRibbon.style.display = "";
  }
  async checkWechatLogin() {
    try {
      return await checkWechatLoginStatus();
    } catch (error) {
      return false;
    }
  }
  async checkFeishuLogin() {
    try {
      return await checkFeishuLoginStatus();
    } catch (error) {
      return false;
    }
  }
  async checkXiaohongshuLogin(options = {}) {
    try {
      return await probeXiaohongshuLoginStatus("", options);
    } catch (error) {
      if (isAbortError(error)) throw error;
      return false;
    }
  }
  async loginWechat() {
    try {
      const loggedIn = await loginWechatWeb(null);
      if (loggedIn) {
        new Notice("微信登录成功！后续同步公众号文章时会自动提取评论区内容。");
      } else {
        new Notice("微信登录未完成，请在浏览器窗口中扫码后重试。");
      }
    } catch (error) {
      new Notice(`微信登录失败：${error.message || error}`);
    }
  }
  async loginFeishu(targetUrl = "") {
    try {
      const loggedIn = await loginFeishuWeb(targetUrl || null);
      if (loggedIn) {
        new Notice("飞书登录已保存，后续同步会复用该登录状态。");
      } else {
        new Notice("飞书登录未确认，请在打开的窗口中完成登录后再同步。");
      }
    } catch (error) {
      new Notice(`飞书登录失败：${error.message || error}`);
    }
  }
  async loginXiaohongshu(targetUrl = "") {
    try {
      const loggedIn = await loginXiaohongshuWeb(targetUrl || null);
      if (loggedIn) {
        new Notice("小红书登录已保存，后续同步小红书图文会复用该登录状态提取评论区。");
      } else {
        new Notice("小红书登录未确认，请在打开的窗口中完成登录后再同步。");
      }
    } catch (error) {
      new Notice(`小红书登录失败：${error.message || error}`);
    }
  }
  async resolveWechatChannelsListenerUrl(targetUrl = "") {
    const source = String(targetUrl || this.settings.wechatChannelsExperimentUrl || "").trim();
    if (!source) return "https://channels.weixin.qq.com/";
    if (!isWechatChannelsUrl(source)) return source;
    const payload = extractWechatChannelsRequestPayload(source);
    if (payload.exportId) return buildWechatChannelsPreviewUrl(source);
    try {
      const feed = await this.fetchWechatChannelsFeedInfo(source);
      if (feed.dynamicExportId) {
        return `https://channels.weixin.qq.com/web/pages/feed?eid=${encodeURIComponent(feed.dynamicExportId)}&context_id=wechat-inbox-${Date.now()}&entrance_id=1019`;
      }
    } catch (error) {
    }
    return buildWechatChannelsPreviewUrl(source);
  }
  async openWechatChannelsListener(targetUrl = "") {
    const BrowserWindow = getElectronBrowserWindow();
    if (!BrowserWindow) {
      new Notice("当前版本已暂停视频号监听功能。");
      return null;
    }
    const session = getWechatSession();
    if (!session) {
      new Notice("无法创建微信网页会话。");
      return null;
    }
    const listenerUrl = await this.resolveWechatChannelsListenerUrl(targetUrl);
    await this.saveSettings({
      ...this.settings,
      wechatChannelsExperimentUrl: String(targetUrl || this.settings.wechatChannelsExperimentUrl || "").trim()
    });
    const win = new BrowserWindow({
      width: 1100,
      height: 860,
      show: true,
      title: "视频号转写监听（实验）",
      webPreferences: {
        session,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });
    const requestMeta = /* @__PURE__ */ new Map();
    const debuggerApi = win.webContents && win.webContents.debugger;
    const inspectCapturedBody = /* @__PURE__ */ __name(async (requestId) => {
      const meta = requestMeta.get(requestId) || {};
      const inspectKey = `${meta.url || ""} ${meta.mimeType || ""} ${meta.type || ""}`.toLowerCase();
      if (!/(channels\.weixin\.qq\.com|finder|wechat|json|cgi|feed|object|comment|profile|media|video)/i.test(inspectKey)) return;
      try {
        const bodyResult = await debuggerApi.sendCommand("Network.getResponseBody", { requestId });
        const rawBody = bodyResult && bodyResult.body ? bodyResult.body : "";
        if (!rawBody || rawBody.length > 8 * 1024 * 1024) return;
        const text = bodyResult.base64Encoded ? Buffer.from(rawBody, "base64").toString("utf8") : rawBody;
        const profiles = extractWechatChannelsProfilesFromText(text, targetUrl || this.settings.wechatChannelsExperimentUrl || meta.url || listenerUrl);
        for (const profile of profiles) {
          await this.handleWechatChannelsCapturedProfile(profile, targetUrl || this.settings.wechatChannelsExperimentUrl || meta.url || listenerUrl);
        }
      } catch (error) {
      } finally {
        requestMeta.delete(requestId);
      }
    }, "inspectCapturedBody");
    if (debuggerApi) {
      try {
        debuggerApi.attach("1.3");
        await debuggerApi.sendCommand("Network.enable");
        debuggerApi.on("message", (_event, method, params = {}) => {
          if (method === "Network.responseReceived" && params.requestId) {
            requestMeta.set(params.requestId, {
              url: params.response && params.response.url,
              mimeType: params.response && params.response.mimeType,
              type: params.type
            });
          }
          if (method === "Network.loadingFinished" && params.requestId) {
            inspectCapturedBody(params.requestId);
          }
        });
        win.on("closed", () => {
          try {
            if (debuggerApi.isAttached && debuggerApi.isAttached()) {
              debuggerApi.detach();
            }
          } catch (error) {
          }
        });
        new Notice("视频号监听窗口已打开。扫码登录后，打开或刷新视频号内容，捕获到媒体后会自动转写保存。");
      } catch (error) {
        new Notice(`视频号监听未能启用网络捕获：${error.message || error}`);
      }
    }
    try {
      await win.loadURL(listenerUrl);
    } catch (error) {
      new Notice(`打开视频号页面失败：${error.message || error}`);
    }
    return win;
  }
  async handleWechatChannelsCapturedProfile(profile, sourceUrl = "") {
    const mediaItems = Array.isArray(profile && profile.mediaItems) ? profile.mediaItems : [];
    const mediaUrl = profile.videoUrl || mediaItems[0] && mediaItems[0].url || "";
    if (!mediaUrl) return null;
    const decryptKey = String(mediaItems[0] && (mediaItems[0].decryptKey || mediaItems[0].decodeKey) || profile.decodeKey || "").trim();
    const captureKey = `${mediaUrl}|${decryptKey}`;
    this.wechatChannelsCapturedMediaKeys = this.wechatChannelsCapturedMediaKeys || /* @__PURE__ */ new Set();
    this.wechatChannelsCaptureInFlight = this.wechatChannelsCaptureInFlight || /* @__PURE__ */ new Set();
    if (this.wechatChannelsCapturedMediaKeys.has(captureKey) || this.wechatChannelsCaptureInFlight.has(captureKey)) {
      return null;
    }
    this.wechatChannelsCaptureInFlight.add(captureKey);
    try {
      new Notice("已捕获视频号媒体，开始转写...");
      const now = (/* @__PURE__ */ new Date()).toISOString();
      const title = profile.title || buildWechatChannelsTitle(profile.description || "", "视频号口播文案");
      const record = {
        _id: `wechat-channels-local-${crypto.createHash("sha256").update(captureKey).digest("hex").slice(0, 24)}`,
        type: "webpage",
        content: cleanDisplayUrl(sourceUrl || profile.sourceUrl || mediaUrl),
        createdAt: now,
        metadata: {
          url: cleanDisplayUrl(sourceUrl || profile.sourceUrl || ""),
          title,
          author: profile.author || "",
          platform: "视频号",
          contentCategory: "视频",
          webpageMediaType: "audio_video",
          transcriptOnly: true,
          coverUrl: profile.coverUrl || mediaItems[0] && mediaItems[0].coverUrl || "",
          dynamicExportId: profile.dynamicExportId || "",
          wechatChannelsDecodeKey: decryptKey,
          wechatChannelsEncryptedMedia: Boolean(decryptKey)
        }
      };
      const activeBinding = this.getActiveBindings()[0] || null;
      const transcribedRecord = await this.buildTranscriptRecordFromMedia(record, {
        url: sourceUrl || profile.sourceUrl || mediaUrl,
        platform: "视频号",
        mediaUrl,
        mediaUrls: Array.isArray(profile.mediaUrls) ? profile.mediaUrls : mediaItems.map((item) => item.url).filter(Boolean),
        mediaItems,
        source: "wechat-channels-local-capture",
        binding: activeBinding,
        title,
        noMediaError: "监听窗口未捕获到可转写的视频号媒体资源"
      });
      const metadata = transcribedRecord.metadata || {};
      if (metadata.transcriptionStatus !== "success") {
        throw new Error(metadata.transcriptionError || "视频号转写失败");
      }
      const transcriptProperties = buildTranscriptPropertyMetadata({
        transcription: metadata.transcription,
        title
      });
      const finalRecord = {
        ...transcribedRecord,
        metadata: {
          ...metadata,
          title: metadata.title || title,
          author: metadata.author || profile.author || "",
          platform: "视频号",
          contentCategory: "视频",
          coverUrl: metadata.coverUrl || profile.coverUrl || "",
          dynamicExportId: metadata.dynamicExportId || profile.dynamicExportId || "",
          description: metadata.description || transcriptProperties.description,
          keywords: getRecordKeywords(metadata).length ? getRecordKeywords(metadata) : transcriptProperties.keywords,
          aiMetadataSource: metadata.aiMetadataSource || transcriptProperties.aiMetadataSource,
          wechatChannelsDecodeKey: metadata.wechatChannelsDecodeKey || decryptKey,
          wechatChannelsEncryptedMedia: Boolean(metadata.wechatChannelsDecodeKey || decryptKey)
        }
      };
      const result = await this.writeCapturedWechatChannelsRecord(finalRecord, now, activeBinding);
      this.wechatChannelsCapturedMediaKeys.add(captureKey);
      new Notice(`视频号转写已保存：${result.title}`);
      return result;
    } catch (error) {
      new Notice(`视频号转写失败：${error.message || error}`);
      return null;
    } finally {
      this.wechatChannelsCaptureInFlight.delete(captureKey);
    }
  }
  async writeCapturedWechatChannelsRecord(record, syncedAt, binding = null) {
    const dateFolder = getDateFolderName(record.createdAt);
    const rootDir = normalizeConfiguredVaultPath(this.settings.inboxDir);
    const noteDir = normalizeVaultPath(this.settings.noteSaveMode === "root" ? rootDir : `${rootDir}/${dateFolder}`);
    await this.ensureFolder(rootDir);
    await this.ensureFolder(noteDir);
    const fallbackTitle = await this.nextRecordTitle(noteDir, record, "");
    let recordForMarkdown = await this.enrichRecordMetadataWithAi(record, binding);
    const noteIdentity = applyTranscriptionNoteIdentity(recordForMarkdown, { fallbackTitle });
    recordForMarkdown = noteIdentity.record;
    const title = noteIdentity.displayTitle || fallbackTitle;
    const fileTitle = noteIdentity.titleSource ? await this.nextTitle(noteDir, noteIdentity.fileTitle) : fallbackTitle;
    const outputPlan = buildNoteOutputPlan({
      record: recordForMarkdown,
      title,
      fileTitle,
      syncedAt,
      noteDir,
      propertyFields: this.settings.notePropertyFields
    });
    const { markdown, filePath } = outputPlan;
    await this.app.vault.adapter.write(filePath, markdown);
    return {
      recordId: getRecordId(record),
      filePath,
      title,
      conversionWarning: getRecordConversionWarning(recordForMarkdown)
    };
  }
  async cacheLocalTranscriptionEntitlementStatus(status) {
    this.settings = mergeSettings({
      ...this.settings,
      localTranscriptionEntitlementStatus: status,
      proEntitlementLastError: "",
      proEntitlementLastErrorAt: ""
    });
    if (typeof this.saveData === "function") {
      await this.saveData(this.settings);
    }
  }
  async cacheProEntitlementQueryError(error) {
    const message = redactKnownCredentials(
      error && error.message ? error.message : String(error || "权限查询失败"),
      this.settings
    ).slice(0, 1e3);
    this.settings = mergeSettings({
      ...this.settings,
      proEntitlementLastError: message,
      proEntitlementLastErrorAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    if (typeof this.saveData === "function") {
      await this.saveData(this.settings);
    }
  }
  getActiveBindings() {
    const bindings = normalizeBindings(this.settings).filter((item) => item.enabled !== false && item.status !== "unbound" && item.token);
    if (bindings.length) return bindings;
    return this.settings.token ? [{
      token: this.settings.token,
      label: "默认微信",
      enabled: true,
      boundAt: "",
      lastSyncAt: ""
    }] : [];
  }
  async syncTranscriptionPreferences() {
    const payload = {
      cloudPreTranscriptionEnabled: Boolean(this.settings.cloudPreTranscriptionEnabled),
      cloudPreTranscriptionThresholdMinutes: normalizeCloudPreTranscriptionThresholdMinutes(this.settings.cloudPreTranscriptionThresholdMinutes)
    };
    const bindings = this.getActiveBindings();
    for (const binding of bindings) {
      await this.requestJson("/transcription-preferences", "POST", payload, binding);
    }
    return payload;
  }
  async requestJson(path2, method = "GET", body = {}, binding = null, options = {}) {
    const signal = options.signal || null;
    throwIfAborted(signal);
    const fallbackToken = getPrimaryBoundToken(normalizeBindings(this.settings));
    const token = normalizeBindCodeInput(
      typeof binding === "string" ? binding : binding && binding.token || this.settings.token || fallbackToken
    );
    if (!token) {
      throw new Error("请先在插件设置里输入小程序绑定码并完成绑定。");
    }
    const retryWithOfficialApiBaseIfNeeded = /* @__PURE__ */ __name(async (message) => {
      const currentApiBase = trimTrailingSlash(this.settings.apiBase || "");
      const officialApiBase = trimTrailingSlash(OFFICIAL_SYNC_API_BASE);
      const shouldRetry = isInvalidCloudBaseEnvMessage(message) || isBindingInvalidMessage(message);
      if (!shouldRetry || currentApiBase === officialApiBase) {
        return null;
      }
      await this.saveSettings({
        ...this.settings,
        apiBase: OFFICIAL_SYNC_API_BASE
      });
      return await this.requestJson(path2, method, body, binding, options);
    }, "retryWithOfficialApiBaseIfNeeded");
    const isFeishuCloudRequest = /^\/feishu(?:\/|$)/.test(String(path2 || ""));
    const apiBaseForRequest = isFeishuCloudRequest ? FEISHU_OAUTH_SYNC_API_BASE : this.settings.apiBase;
    const requestPath = path2;
    const requestBody = body || {};
    const requestOptions = {
      url: `${trimTrailingSlash(apiBaseForRequest)}${requestPath}`,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "X-Wechat-Inbox-Token": token,
        "X-Wechat-Inbox-Client-Id": this.settings.clientId,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...options.noCache === true ? {
          "Cache-Control": "no-cache",
          Pragma: "no-cache"
        } : {}
      },
      body: method === "POST" ? JSON.stringify(requestBody || {}) : void 0,
      signal
    };
    let response;
    try {
      response = signal ? await requestJsonViaNode(requestOptions) : await requestUrl(requestOptions);
    } catch (error) {
      if (isAbortError(error) || signal && signal.aborted) throw createAbortError();
      const message = error && error.message ? error.message : String(error || "");
      const shouldReadBindErrorBody = path2 !== "/unbind-self" && /request failed|status\s*(?:4|5)\d\d|http\s*(?:4|5)\d\d/i.test(message);
      if (isRequestUrlTransportError(message) || shouldReadBindErrorBody) {
        try {
          response = await requestJsonViaNode(requestOptions);
        } catch (fallbackError) {
          if (isAbortError(fallbackError) || signal && signal.aborted) throw createAbortError();
          if (shouldReadBindErrorBody) throw error;
          const fallbackMessage = fallbackError && fallbackError.message ? fallbackError.message : String(fallbackError || "");
          throw new Error(`网络连接失败：${fallbackMessage || message}`);
        }
      } else {
        throw error;
      }
    }
    throwIfAborted(signal);
    let payload = response.json || null;
    if (!payload && response.text) {
      try {
        payload = JSON.parse(response.text || "{}");
      } catch (error) {
        payload = null;
      }
    }
    if (response.status && (response.status < 200 || response.status >= 300)) {
      const message = payload && payload.errMsg || `HTTP ${response.status}`;
      const officialRetryPayload = await retryWithOfficialApiBaseIfNeeded(message);
      if (officialRetryPayload) return officialRetryPayload;
      if (response.status === 400 && message.includes("Missing client ID")) {
        throw new Error("本地设备标识缺失，请更新到最新版插件并重启 Obsidian 后再绑定");
      }
      if (isBindingInvalidMessage(message)) {
        throw new Error("绑定码未绑定或已失效，请在插件设置里粘贴小程序绑定码后点击「立即绑定」");
      }
      const requestError = new Error(message);
      requestError.status = response.status;
      requestError.statusCode = response.status;
      if (payload && payload.errCode) requestError.code = String(payload.errCode);
      throw requestError;
    }
    if (!payload || payload.success === false) {
      const message = payload && payload.errMsg || "同步 API 请求失败";
      const officialRetryPayload = await retryWithOfficialApiBaseIfNeeded(message);
      if (officialRetryPayload) return officialRetryPayload;
      if (message.includes("Missing client ID")) {
        throw new Error("本地设备标识缺失，请更新到最新版插件并重启 Obsidian 后再绑定");
      }
      if (isBindingInvalidMessage(message)) {
        throw new Error("绑定码未绑定或已失效，请在插件设置里粘贴小程序绑定码后点击「立即绑定」");
      }
      throw new Error(message);
    }
    return payload;
  }
  async requestExternalJson(url, { method = "POST", headers = {}, body = null } = {}) {
    const requestOptions = {
      url,
      method,
      headers,
      body
    };
    let response;
    try {
      response = await requestUrl(requestOptions);
    } catch (error) {
      const message = error && error.message ? error.message : String(error || "");
      if (!isRequestUrlTransportError(message)) throw error;
      response = await requestJsonViaNode(requestOptions);
    }
    const payload = response.json || (response.text ? tryParseJson(response.text) : null);
    if (response.status && (response.status < 200 || response.status >= 300)) {
      const error = new Error(payload && (payload.error && payload.error.message || payload.errMsg) || `HTTP ${response.status}`);
      error.status = Number(response.status) || 0;
      error.statusCode = error.status;
      error.response = { status: error.status };
      throw error;
    }
    return payload || {};
  }
  getFeishuCustomAppConfig({ requireComplete = false } = {}) {
    const appId = String(this.settings.feishuAppId || "").trim();
    const appSecret = String(this.settings.feishuAppSecret || "").trim();
    if (!appId && !appSecret) return null;
    if (!appId || !appSecret) {
      if (requireComplete) {
        throw new Error("请同时填写飞书 App ID 和 App Secret，或清空两项后使用默认飞书连接。");
      }
      return null;
    }
    return { appId, appSecret };
  }
  withFeishuCustomAppConfig(body = {}) {
    const config = this.getFeishuCustomAppConfig({ requireComplete: true });
    return config ? { ...body || {}, feishuApp: config } : body || {};
  }
  async fetchFeishuCloudOAuthMarkdownFromUrl(url, binding = null) {
    const payload = await this.requestJson("/feishu/extract", "POST", this.withFeishuCustomAppConfig({
      url
    }), binding || void 0);
    const data = payload && payload.data ? payload.data : payload;
    const blocks = Array.isArray(data && data.blocks) ? data.blocks : [];
    if (!blocks.length) {
      throw new Error("Feishu cloud OAuth returned no document blocks");
    }
    return {
      source: "feishu-cloud-oauth",
      title: String(data && data.title || "").trim(),
      markdown: extractFeishuMarkdownFromOpenApiBlocks(blocks),
      documentId: String(data && data.documentId || "").trim(),
      blockCount: Number(data && data.blockCount || blocks.length) || blocks.length,
      imageTmpDownloadUrls: data && data.imageTmpDownloadUrls && typeof data.imageTmpDownloadUrls === "object" ? data.imageTmpDownloadUrls : {},
      imageTokenCount: Number(data && data.imageTokenCount || 0) || 0,
      imageTokens: Array.isArray(data && data.imageTokens) ? data.imageTokens.map((item) => String(item || "").trim()).filter(Boolean) : [],
      imageDownloadError: String(data && data.imageDownloadError || "").trim()
    };
  }
  async fetchFeishuCloudMediaDataUrl(fileToken, binding = null) {
    const token = String(fileToken || "").trim();
    if (!token) throw new Error("飞书图片标识为空");
    const payload = await this.requestJson(
      "/feishu/media",
      "POST",
      this.withFeishuCustomAppConfig({ fileToken: token }),
      binding || void 0
    );
    const data = payload && payload.data ? payload.data : payload;
    const dataUrl = String(data && data.dataUrl || "").trim();
    if (!/^data:image\//i.test(dataUrl)) {
      throw new Error("飞书图片下载未返回有效图片数据");
    }
    return {
      fileToken: token,
      dataUrl,
      contentType: String(data && data.contentType || "").trim(),
      bytes: Number(data && data.bytes || 0) || 0
    };
  }
  async requestFeishuJsonWithBindingFallback(path2, method = "GET", body = {}, binding = null) {
    const bindings = binding ? [binding] : this.getActiveBindings();
    if (!bindings.length) {
      return await this.requestJson(path2, method, body, binding || void 0);
    }
    let lastError = null;
    for (const candidate of bindings) {
      try {
        return await this.requestJson(path2, method, body, candidate);
      } catch (error) {
        lastError = error;
        if (!isBindingInvalidMessage(error && error.message ? error.message : error)) {
          throw error;
        }
      }
    }
    throw lastError;
  }
  async connectFeishuCloudOAuth(binding = null) {
    const payload = await this.requestFeishuJsonWithBindingFallback(
      "/feishu/oauth/start",
      "POST",
      this.withFeishuCustomAppConfig({}),
      binding
    );
    const data = payload && payload.data ? payload.data : payload;
    const authUrl = String(data && data.authUrl || "").trim();
    if (!authUrl) throw new Error("Feishu OAuth did not return authUrl");
    await openExternalUrl(authUrl);
    return data;
  }
  async refreshFeishuCloudOAuthStatus(binding = null) {
    const payload = await this.requestFeishuJsonWithBindingFallback(
      "/feishu/oauth/status",
      "GET",
      {},
      binding
    );
    const data = payload && payload.data ? payload.data : payload;
    try {
      await this.saveSettings({
        ...this.settings,
        feishuOAuthStatus: data || null
      });
    } catch (error) {
      this.settings.feishuOAuthStatus = data || null;
    }
    return data || null;
  }
  async getFeishuCloudOAuthStatus(binding = null) {
    if (this.settings.feishuOAuthStatus && this.settings.feishuOAuthStatus.connected) {
      return this.settings.feishuOAuthStatus;
    }
    try {
      return await this.refreshFeishuCloudOAuthStatus(binding);
    } catch (error) {
      return this.settings.feishuOAuthStatus || null;
    }
  }
  async generateMetadataWithCloud(record, binding = null) {
    const inputText = extractAiMetadataInputText(record);
    if (!inputText) return { title: "", description: "", keywords: [] };
    const metadata = record && record.metadata || {};
    const payload = await this.requestJson("/metadata/generate", "POST", {
      title: metadata.title || record.title || "",
      source: getRecordSourceLabel(record, metadata),
      content: inputText
    }, binding || null);
    return normalizeGeneratedMetadataResult(payload && payload.data ? payload.data : payload);
  }
  async generateMetadataWithDeepSeek(record, binding = null) {
    if (!this.settings.deepseekApiKey) {
      return await this.generateMetadataWithCloud(record, binding);
    }
    const inputText = extractAiMetadataInputText(record);
    if (!inputText) return { title: "", description: "", keywords: [] };
    const payload = await this.requestExternalJson(this.settings.deepseekBaseUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.settings.deepseekApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: this.settings.deepseekModel || DEFAULT_SETTINGS.deepseekModel,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: '你是内容整理助手。请基于用户提供的文案生成独立标题、简介和关键词。只输出 JSON：{"title":"主题式短标题","description":"一句话简介","keywords":["关键词1","关键词2"]}。title 用 8 到 24 个中文字符概括核心主题，不带平台名，不使用“这是一份”“本文介绍”“本视频讲述”等报告式开头；description 控制在 1 句话；keywords 返回 3 到 8 个简洁中文或英文关键词。'
          },
          {
            role: "user",
            content: inputText
          }
        ]
      })
    });
    return parseGeneratedMetadataResponse(extractOpenAICompatibleText(payload) || JSON.stringify(payload || {}));
  }
  async enrichRecordMetadataWithAi(record, binding = null) {
    if (!shouldGenerateAiMetadata(this.settings, record)) return record;
    const metadata = { ...record && record.metadata || {} };
    delete metadata.aiMetadataError;
    const fail = /* @__PURE__ */ __name((error) => {
      return {
        ...record,
        metadata: {
          ...metadata,
          aiMetadataError: classifyAiMetadataError(error)
        }
      };
    }, "fail");
    let hasAccess = false;
    try {
      hasAccess = await this.hasProFeatureAccess();
    } catch (error) {
      return fail(error);
    }
    if (!hasAccess) {
      return record;
    }
    let generated;
    try {
      generated = await retryAiMetadataGeneration(
        () => this.generateMetadataWithDeepSeek(record, binding),
        { wait: sleep, maxAttempts: 3 }
      );
    } catch (error) {
      return fail(error);
    }
    const semanticTitle = String(generated && generated.title || "").trim();
    const description = String(generated && generated.description || "").trim();
    const keywords = getRecordKeywords(generated || {}).map((item) => String(item || "").trim()).filter(Boolean);
    if (!semanticTitle && !description && !keywords.length) {
      return fail("empty-response");
    }
    if (semanticTitle) metadata.semanticTitle = semanticTitle;
    if (description) {
      metadata.description = description;
    }
    if (keywords.length) {
      metadata.keywords = keywords;
    }
    if (semanticTitle || description || keywords.length) {
      metadata.aiMetadataSource = this.settings.deepseekApiKey ? "deepseek" : "cloud";
    }
    return {
      ...record,
      metadata
    };
  }
  async testDeepSeekConnection() {
    const result = await this.generateMetadataWithDeepSeek({
      type: "text",
      content: "这是一段关于 Obsidian 内容同步助手、飞书机器人和知识管理的测试文案。",
      metadata: {
        title: "AI 连接测试"
      }
    });
    if (!result.description && !result.keywords.length) {
      throw new Error("DeepSeek 已响应，但没有返回可用的简介或关键词");
    }
    return result;
  }
  async bindCurrentCode() {
    if (!this.settings.clientId) {
      await this.saveSettings({
        ...this.settings,
        clientId: createClientId()
      });
    }
    const tokenToBind = normalizeBindCodeInput(this.settings.pendingBindCode || this.settings.token);
    if (!tokenToBind) {
      new Notice("请填写小程序绑定码");
      return;
    }
    if (!this.settings.apiBase) {
      new Notice("请填写同步 API 地址");
      return;
    }
    const currentBindings = normalizeBindings(this.settings);
    const existing = currentBindings.find((item) => item.token === tokenToBind);
    const replacement = !existing && currentBindings.length >= MAX_PLUGIN_BINDINGS ? currentBindings.find((item) => item.status === "needs_rebind") : null;
    if (!canAddPluginBinding(this.settings, tokenToBind)) {
      new Notice(`最多绑定 ${MAX_PLUGIN_BINDINGS} 个小程序码`);
      return;
    }
    try {
      await this.requestJson("/bind", "POST", {
        clientId: this.settings.clientId
      }, { token: tokenToBind });
      const token = tokenToBind;
      const boundBinding = existing ? {
        ...existing,
        enabled: true,
        status: "bound",
        lastError: "",
        unboundAt: ""
      } : {
        token,
        label: `微信 ${currentBindings.length + 1}`,
        enabled: true,
        status: "bound",
        boundAt: (/* @__PURE__ */ new Date()).toISOString(),
        lastSyncAt: "",
        unboundAt: "",
        lastError: ""
      };
      const nextBindings = [
        boundBinding,
        ...currentBindings.filter((item) => item.token !== token && (!replacement || item.token !== replacement.token))
      ];
      await this.saveSettings({
        ...this.settings,
        token,
        pendingBindCode: "",
        bindings: nextBindings
      });
      new Notice("绑定成功");
      this.refreshProAndMaybePromptLocalComponentInstall({ reason: "bind", force: true }).catch((error) => {
        new Notice(`Pro 组件检查失败：${error.message || error}`);
      });
    } catch (error) {
      const message = error && error.message ? error.message : String(error || "");
      if (error && error.code === "PLUGIN_BINDING_LIMIT_EXCEEDED" || message.includes("PLUGIN_BINDING_LIMIT_EXCEEDED") || message.includes("免费版最多绑定") || message.includes("Pro 版最多绑定")) {
        new Notice(message);
        return;
      }
      if (message.includes("409") || message.includes("already bound") || message.includes("already-bound")) {
        new Notice("绑定电脑名额已满，请在小程序绑定页新增电脑名额后再试");
        return;
      }
      if (error && error.code === "EXTRA_BINDING_REQUIRES_ACTIVE_PRO") {
        new Notice("体验 Pro 已到期，额外绑定暂不可用；续期后会自动恢复。");
        return;
      }
      if (/Invalid bind code/i.test(message) || error && error.code === "INVALID_BIND_CODE") {
        new Notice("绑定码无效");
        return;
      }
      if (/request failed|status\s*403|http\s*403/i.test(message)) {
        new Notice("暂时无法确认绑定码状态，请重试。");
        return;
      }
      new Notice(`绑定失败：${message || "请稍后重试"}`);
    }
  }
  async markBindingUnbound(token, reason = "") {
    const normalizedToken = normalizeBindCodeInput(token);
    if (!normalizedToken) return;
    const nextBindings = normalizeBindings(this.settings).filter((item) => item.token !== normalizedToken);
    const currentEntitlement = this.settings.localTranscriptionEntitlementStatus || null;
    const shouldClearProStatus = !nextBindings.length || normalizeBindCodeInput(currentEntitlement && currentEntitlement.bindingToken) === normalizedToken;
    const nextSettings = {
      ...this.settings,
      token: getPrimaryBoundToken(nextBindings),
      bindings: nextBindings
    };
    if (shouldClearProStatus) {
      nextSettings.pendingRedeemCode = "";
      nextSettings.localTranscriptionEntitlementStatus = nextBindings.length ? null : {
        hasAccess: false,
        plan: LOCAL_TRANSCRIPTION_PLAN,
        status: "unbound",
        expiresAt: ""
      };
    }
    await this.saveSettings(nextSettings);
  }
  async markBindingNeedsRebind(binding, reason = "") {
    const normalizedToken = normalizeBindCodeInput(binding && binding.token);
    if (!normalizedToken) return "";
    const label = String(binding && binding.label || "").trim() || "该微信";
    const actionMessage = `${label} 的绑定码已失效，已暂停该绑定；请在小程序重新生成绑定码后，在插件设置中重新绑定。`;
    const nextBindings = normalizeBindings(this.settings).map((item) => item.token === normalizedToken ? { ...item, enabled: false, status: "needs_rebind", lastError: actionMessage } : item);
    await this.saveSettings({
      ...this.settings,
      token: getPrimaryBoundToken(nextBindings),
      bindings: nextBindings
    });
    return actionMessage;
  }
  async downloadArrayBuffer(url, headers = {}, options = {}) {
    if (options.signal || typeof options.onProgress === "function") {
      return downloadArrayBufferViaNode(url, headers, options);
    }
    try {
      const response = await requestUrl({ url, method: "GET", headers });
      const responseBuffer = response && response.arrayBuffer;
      const responseBufferSize = responseBuffer ? Number(responseBuffer.byteLength ?? responseBuffer.length ?? 0) : 0;
      if (responseBuffer && responseBufferSize > 0) {
        return responseBuffer;
      }
    } catch (error) {
    }
    return downloadArrayBufferViaNode(url, headers, options);
  }
  async buildXiaohongshuOcrImagePayload(imageUrls = []) {
    const items = [];
    const selected = dedupeImageVariants(
      (Array.isArray(imageUrls) ? imageUrls : []).filter(Boolean)
    ).slice(0, XIAOHONGSHU_OCR_MAX_IMAGES);
    for (let index = 0; index < selected.length; index += 1) {
      const imageUrl = selected[index];
      try {
        const headers = await getXiaohongshuRequestHeaders(imageUrl);
        const arrayBuffer = await this.downloadArrayBuffer(imageUrl, headers);
        const buffer = Buffer.from(arrayBuffer);
        if (!buffer.length || buffer.length > XIAOHONGSHU_OCR_MAX_IMAGE_BYTES) continue;
        items.push({
          imageUrl,
          imageBase64: buffer.toString("base64"),
          index: index + 1
        });
      } catch (error) {
      }
    }
    return items;
  }
  async requestXiaohongshuImageOcr(imageUrls = [], {
    pageUrl = "",
    title = "",
    binding = null
  } = {}) {
    const requestedImageUrls = dedupeImageVariants(
      (Array.isArray(imageUrls) ? imageUrls : []).map((imageUrl) => String(imageUrl || "").trim()).filter(Boolean)
    );
    if (!requestedImageUrls.length) return [];
    await this.ensureProFeatureAccess("小红书图片 OCR");
    const images = await this.buildXiaohongshuOcrImagePayload(requestedImageUrls);
    if (!images.length) return [];
    await this.ensureLocalComponentReadyForUse("小红书图片 OCR", {
      reason: "first-use",
      requireAsr: false,
      requireOcr: true
    });
    const ocrTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-inbox-ocr-"));
    try {
      const entries = [];
      const sourceById = /* @__PURE__ */ new Map();
      images.forEach((image, sourceOrder) => {
        const rawIndex = Number(image && image.index);
        const integerIndex = Number.isFinite(rawIndex) ? Math.floor(rawIndex) : 0;
        const index = integerIndex > 0 ? integerIndex : sourceOrder + 1;
        const id = `image-${sourceOrder + 1}`;
        const ext = getImageFileExtension(image.imageUrl);
        const imagePath = path.join(ocrTempDir, `${id}.${ext}`);
        fs.writeFileSync(imagePath, Buffer.from(image.imageBase64 || "", "base64"));
        const source = {
          id,
          imageUrl: String(image.imageUrl || "").trim(),
          index,
          imagePath
        };
        entries.push({
          id,
          index,
          imagePath
        });
        sourceById.set(id, source);
      });
      if (!entries.length) return [];
      const batchItems = await this.runLocalImageOcrBatch(entries);
      if (!Array.isArray(batchItems) || batchItems.length !== entries.length || !batchItems.every((item, position) => item && ["ok", "error"].includes(item.status) && item.id === entries[position].id && item.index === entries[position].index)) {
        throw createLocalOcrBatchError("schema");
      }
      if (batchItems.length > 0 && batchItems.every((item) => item && item.status === "error")) {
        throw createLocalOcrBatchAllItemsFailedError(batchItems);
      }
      const items = batchItems.flatMap((item) => {
        if (!item || item.status !== "ok") return [];
        const resultId = String(item.id || "").trim();
        const source = sourceById.get(resultId);
        if (!source) return [];
        return [{
          imageUrl: source.imageUrl,
          index: source.index,
          text: item.text,
          metrics: item.metrics
        }];
      });
      return normalizeXiaohongshuOcrItems(items);
    } finally {
      try {
        fs.rmSync(ocrTempDir, { recursive: true, force: true });
      } catch (error) {
      }
    }
  }
  async enrichXiaohongshuExtractionWithOcr(extracted, {
    pageUrl = "",
    binding = null
  } = {}) {
    if (!extracted || !Array.isArray(extracted.imageUrls) || !extracted.imageUrls.length) return extracted;
    let items = [];
    try {
      items = await this.requestXiaohongshuImageOcr(extracted.imageUrls, {
        pageUrl,
        title: extracted.title || "",
        binding
      });
    } catch (error) {
      return {
        ...extracted,
        ocrError: getSafeXiaohongshuOcrError(error)
      };
    }
    if (!items.length) return extracted;
    return {
      ...extracted,
      markdown: appendXiaohongshuOcrMarkdown(extracted.markdown, items),
      ocrItems: items,
      ocrTextHeavy: isLikelyImageTextNote(items)
    };
  }
  showSyncProgress(progress = {}) {
    const message = buildSyncProgressMessage(progress);
    if (!message) return;
    this.lastSyncDiagnostic = {
      ...progress,
      message,
      status: progress.stage === "empty" ? "empty" : "running",
      time: (/* @__PURE__ */ new Date()).toISOString()
    };
    writeSyncDiagnosticLog(this.lastSyncDiagnostic, this.getConfiguredLocalAsrInstallRoot());
    if (this.syncStatusBar && typeof this.syncStatusBar.setText === "function") {
      this.syncStatusBar.setText(message);
    }
    if (!this.syncProgressNotice) {
      this.syncProgressNotice = new Notice(message, 0);
      return;
    }
    if (typeof this.syncProgressNotice.setMessage === "function") {
      this.syncProgressNotice.setMessage(message);
      return;
    }
    new Notice(message, 2500);
  }
  clearSyncProgressNotice() {
    if (this.syncProgressNotice && typeof this.syncProgressNotice.hide === "function") {
      this.syncProgressNotice.hide();
    }
    this.syncProgressNotice = null;
    if (this.syncStatusBar && typeof this.syncStatusBar.setText === "function") {
      this.syncStatusBar.setText("");
    }
  }
  getPendingStoppedTranscriptionDeletes() {
    if (!(this.pendingStoppedTranscriptionDeletes instanceof Map)) {
      this.pendingStoppedTranscriptionDeletes = /* @__PURE__ */ new Map();
    }
    return this.pendingStoppedTranscriptionDeletes;
  }
  rememberPendingStoppedTranscriptionDelete(recordId, promise) {
    const normalizedRecordId = String(recordId || "").trim();
    if (!normalizedRecordId || !promise || typeof promise.then !== "function") return;
    this.getPendingStoppedTranscriptionDeletes().set(normalizedRecordId, promise);
  }
  async consumePendingStoppedTranscriptionDelete(recordId) {
    const normalizedRecordId = String(recordId || "").trim();
    if (!normalizedRecordId) return null;
    const pendingDeletes = this.getPendingStoppedTranscriptionDeletes();
    const pending = pendingDeletes.get(normalizedRecordId);
    if (!pending) return null;
    pendingDeletes.delete(normalizedRecordId);
    return pending;
  }
  async deleteCurrentTranscriptionRecord(context = {}) {
    const recordId = String(context.recordId || "").trim();
    const binding = context.binding || null;
    if (!recordId || !binding || !binding.token) {
      return { deleted: false, recordId, reason: "missing-context" };
    }
    const payload = await this.requestJson(
      `/records/${encodeURIComponent(recordId)}/synced`,
      "POST",
      {},
      binding
    );
    const data = payload && payload.data ? payload.data : {};
    const responseRecordId = String(data.id || data.recordId || "").trim();
    return {
      deleted: responseRecordId === recordId && (data.deleted === true || data.alreadyMissing === true || data.status === "deleted"),
      recordId,
      response: data
    };
  }
  async writeExpiredXiaohongshuLinkReceipt(record = {}) {
    const originalUrl = getRecordXiaohongshuIdentityCandidates(record).find((candidate) => isXiaohongshuShortLinkUrl(candidate)) || getRecordUrl(record);
    const recordId = String(getRecordId(record) || "").trim();
    let shortCode = "shortlink";
    try {
      shortCode = new URL(originalUrl).pathname.split("/").filter(Boolean).pop() || shortCode;
    } catch (error) {
      shortCode = "shortlink";
    }
    const safeShortCode = sanitizeNoteTitlePart(shortCode, "shortlink");
    const safeRecordSuffix = sanitizeNoteTitlePart(recordId, "record").slice(-8);
    const rootDir = normalizeConfiguredVaultPath(this.settings.inboxDir);
    const dateFolder = getDateFolderName(record.createdAt);
    const noteDir = normalizeVaultPath(
      this.settings.noteSaveMode === "root" ? rootDir : `${rootDir}/${dateFolder}`
    );
    const filePath = normalizeVaultPath(
      `${noteDir}/小红书临时链接已失效-${safeShortCode}-${safeRecordSuffix}.md`
    );
    if (!this.app || !this.app.vault || !this.app.vault.adapter || typeof this.app.vault.adapter.write !== "function") {
      throw new Error("无法写入小红书失效链接说明文件");
    }
    await this.ensureFolder(rootDir);
    await this.ensureFolder(noteDir);
    const markdown = [
      "# 小红书临时链接已失效",
      "",
      "这条内容保存时使用的是小红书临时短链。同步时该短链已经失效，无法再定位原笔记。",
      "",
      `原始临时链接：${originalUrl}`,
      "",
      `原保存时间：${formatCreatedTime(record.createdAt)}`,
      "",
      "请回到原笔记，重新复制当前有效的分享链接，再发送到小程序保存。",
      "",
      "> 插件会尝试清理云端旧记录；只有清理成功后，这条内容才不会在后续同步中反复出现。",
      ""
    ].join("\n");
    await this.app.vault.adapter.write(filePath, markdown);
    return filePath;
  }
  async stopCurrentTranscription() {
    let stopped = false;
    const activeContext = this.currentTranscriptionContext && typeof this.currentTranscriptionContext === "object" ? this.currentTranscriptionContext : this.currentProcessingContext;
    const context = activeContext && typeof activeContext === "object" ? {
      ...activeContext,
      binding: activeContext.binding ? { ...activeContext.binding } : null
    } : null;
    if (this.currentProcessingAbortController) {
      this.currentProcessingAbortController.abort();
      stopped = true;
    }
    if (this.currentTranscriptionAbortController) {
      this.currentTranscriptionAbortController.abort();
      stopped = true;
    }
    if (this.currentTranscriptionProcess && !this.currentTranscriptionProcess.killed) {
      try {
        const child = this.currentTranscriptionProcess;
        if (process.platform === "win32" && Number.isInteger(child.pid) && child.pid > 0) {
          childProcess.spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
        } else if (process.platform === "darwin" && this.currentTranscriptionProcessDetached && Number.isInteger(child.pid) && child.pid > 0) {
          process.kill(-child.pid, "SIGTERM");
        }
        child.kill();
        stopped = true;
      } catch (error) {
      }
    }
    if (context && closeActiveXiaohongshuBrowserWindows() > 0) {
      stopped = true;
    }
    if (!stopped) {
      new Notice("当前没有正在转写的任务。");
      return false;
    }
    if (!context || !context.recordId || !context.binding || !context.binding.token) {
      new Notice("已停止当前转写，会继续处理后面的同步内容。");
      return true;
    }
    const pendingDeletes = this.getPendingStoppedTranscriptionDeletes();
    let deletePromise = pendingDeletes.get(String(context.recordId));
    if (!deletePromise) {
      deletePromise = this.deleteCurrentTranscriptionRecord(context).catch((error) => ({
        deleted: false,
        recordId: context.recordId,
        error
      }));
      this.rememberPendingStoppedTranscriptionDelete(context.recordId, deletePromise);
    }
    const deleteResult = await deletePromise;
    if (deleteResult && deleteResult.deleted) {
      const cleanupWarning = deleteResult.response && deleteResult.response.cleanupComplete === false ? "；记录已删除，但部分关联文件清理失败" : "";
      new Notice(`已停止当前转写，并从云端删除这条内容；后续同步不会再出现${cleanupWarning}。`);
      return true;
    }
    const message = deleteResult && deleteResult.error ? deleteResult.error.message || String(deleteResult.error) : "云端未确认删除成功";
    new Notice(`已停止当前转写，但删除云端内容失败：${message}；这条内容下次同步可能还会出现。`);
    return true;
  }
  async unbindBinding(token) {
    const normalizedToken = normalizeBindCodeInput(token);
    if (!normalizedToken) {
      new Notice("未找到绑定码");
      return;
    }
    try {
      await this.requestJson("/unbind-self", "POST", {
        clientId: this.settings.clientId
      }, { token: normalizedToken });
      await this.markBindingUnbound(normalizedToken, "用户已主动解除本机绑定");
      new Notice("已解除当前电脑绑定");
    } catch (error) {
      const message = error && error.message ? error.message : String(error || "");
      if (isBindingInvalidMessage(message) || /Request failed,\s*status\s+403\b/i.test(message)) {
        await this.markBindingUnbound(normalizedToken, "小程序已解除绑定，本机同步清理旧绑定");
        new Notice("该绑定已在小程序解除，本机旧绑定已同步清除。");
        return;
      }
      new Notice(`解除绑定失败：${message || error}`);
    }
  }
  async requestFileDownloadUrl(fileID, binding = null) {
    const payload = await this.requestJson(`/files/download-url?fileID=${encodeURIComponent(fileID)}`, "GET", {}, binding);
    if (!payload.data || !payload.data.tempFileURL) {
      throw new Error("未获取到录音下载地址");
    }
    return payload.data.tempFileURL;
  }
  async requestAudioDownloadUrl(fileID, binding = null) {
    return this.requestFileDownloadUrl(fileID, binding);
  }
  async postTencent(action, body) {
    const request = buildTencentRequest({
      action,
      region: this.settings.tencentRegion,
      secretId: this.settings.tencentSecretId,
      secretKey: this.settings.tencentSecretKey,
      body
    });
    const { Host, ...headers } = request.headers;
    const response = await requestUrl({
      url: request.url,
      method: "POST",
      headers,
      body: request.body
    });
    if (response.status && (response.status < 200 || response.status >= 300)) {
      throw new Error(`腾讯云请求失败：HTTP ${response.status} ${String(response.text || "").slice(0, 180)}`);
    }
    const payload = response.json || JSON.parse(response.text || "{}");
    const error = payload && payload.Response && payload.Response.Error;
    if (error) {
      throw new Error(`${error.Code}: ${error.Message}`);
    }
    return payload;
  }
  getEffectiveLocalTranscriptionCommand() {
    const configured = String(this.settings.localTranscriptionCommand || "").trim();
    const platform = this.getConfiguredLocalAsrPlatform();
    if (configured) {
      const configuredRoot = extractLocalAsrInstallRootFromCommand(configured, platform);
      if (!configuredRoot) return configured;
      const configuredStatus = getLocalAsrInstallStatus(configuredRoot, fs.existsSync, platform);
      if (configuredStatus.ready) return configured;
    }
    const installRoot = this.getConfiguredLocalAsrInstallRoot();
    const installStatus = getLocalAsrInstallStatus(installRoot, fs.existsSync, platform);
    return installStatus.ready ? getDefaultLocalTranscriptionCommand(platform, installRoot) : configured;
  }
  async recoverStaleLocalTranscriptionCommand() {
    const configured = String(this.settings.localTranscriptionCommand || "").trim();
    const platform = this.getConfiguredLocalAsrPlatform();
    const configuredRoot = extractLocalAsrInstallRootFromCommand(configured, platform);
    if (!configured || !configuredRoot) return "";
    const configuredStatus = getLocalAsrInstallStatus(configuredRoot, fs.existsSync, platform);
    if (configuredStatus.ready) return "";
    const recoveredCommand = this.getEffectiveLocalTranscriptionCommand();
    if (!recoveredCommand || recoveredCommand === configured) return "";
    await this.saveSettings({
      ...this.settings,
      localTranscriptionCommand: recoveredCommand
    });
    return recoveredCommand;
  }
  canRunLocalTranscription() {
    return Boolean(this.getEffectiveLocalTranscriptionCommand());
  }
  getPluginBaseDir() {
    const adapter = this.app && this.app.vault && this.app.vault.adapter;
    if (adapter && adapter.basePath) {
      const dir = this.manifest && this.manifest.dir || ".obsidian/plugins/wechat-inbox-sync";
      return path.join(adapter.basePath, dir);
    }
    return __dirname;
  }
  getConfiguredLocalAsrPlatform() {
    return resolveLocalAsrPlatform(this.settings.localAsrPlatform);
  }
  getConfiguredLocalAsrInstallRoot(mode = this.settings.localAsrInstallMode) {
    const platform = this.getConfiguredLocalAsrPlatform();
    const commandRoot = extractLocalAsrInstallRootFromCommand(this.settings.localTranscriptionCommand, platform);
    if (commandRoot && normalizeLocalAsrInstallMode(mode) === normalizeLocalAsrInstallMode(this.settings.localAsrInstallMode)) {
      const status = getLocalAsrInstallStatus(commandRoot, fs.existsSync, platform);
      if (status.ready) return commandRoot;
    }
    return getLocalAsrInstallRoot(os.homedir(), mode, platform);
  }
  getBundledLocalAsrInstallerPath() {
    const fileName = this.getConfiguredLocalAsrPlatform() === "darwin" ? "install-local-asr-macos.sh" : "install-local-asr.ps1";
    return path.join(this.getPluginBaseDir(), "local-asr", fileName);
  }
  getConfiguredLocalOcrInstallRoot() {
    return getLocalOcrInstallRoot(os.homedir(), this.getConfiguredLocalAsrPlatform());
  }
  getBundledLocalOcrInstallerPath() {
    const fileName = this.getConfiguredLocalAsrPlatform() === "darwin" ? "install-local-ocr-macos.sh" : "install-local-ocr.ps1";
    return path.join(this.getPluginBaseDir(), "local-ocr", fileName);
  }
  copyBundledLocalOcrRuntimeAssets(installerPath) {
    if (!installerPath) return;
    const sourcePath = path.join(this.getPluginBaseDir(), "local-ocr", "ocr_image.py");
    const targetPath = path.join(path.dirname(installerPath), "ocr_image.py");
    try {
      if (!fs.existsSync(sourcePath)) return;
      if (path.resolve(sourcePath) === path.resolve(targetPath)) return;
      fs.copyFileSync(sourcePath, targetPath);
    } catch (error) {
      console.warn("Failed to copy bundled OCR runtime asset:", error);
    }
  }
  getLocalOcrInstallStatus() {
    return getLocalOcrInstallStatus(
      this.getConfiguredLocalOcrInstallRoot(),
      fs.existsSync,
      this.getConfiguredLocalAsrPlatform()
    );
  }
  async installLocalOcr() {
    if (this.localOcrInstallPromise) {
      new Notice("本地转写组件的图片文字识别模块正在安装中，请等待当前安装完成后再重试。");
      return await this.localOcrInstallPromise;
    }
    this.localOcrInstallPromise = this.doInstallLocalOcr();
    try {
      return await this.localOcrInstallPromise;
    } finally {
      this.localOcrInstallPromise = null;
    }
  }
  async doInstallLocalOcr() {
    await this.ensureProFeatureAccess("本地转写组件安装");
    const installerPath = await this.getAvailableLocalOcrInstallerPath();
    if (!fs.existsSync(installerPath)) {
      throw new Error(`本地转写组件的图片文字识别安装器不存在：${installerPath}`);
    }
    const platform = this.getConfiguredLocalAsrPlatform();
    const installRoot = this.getConfiguredLocalOcrInstallRoot();
    const command = buildLocalOcrInstallCommand(installerPath, platform, platform === "win32" ? installRoot : "");
    new Notice("开始安装本地转写组件的图片文字识别模块，可能需要几分钟。");
    const installResult = await new Promise((resolve, reject) => {
      childProcess.exec(command, {
        timeout: LOCAL_OCR_INSTALL_TIMEOUT_MS,
        maxBuffer: 20 * 1024 * 1024,
        windowsHide: true
      }, (error, stdout, stderr) => {
        if (error) {
          const timedOut = error.killed || error.signal === "SIGTERM" || /timed out|timeout/i.test(error.message || "");
          const errorText = timedOut ? "本地转写组件安装超时：图片文字识别模块安装超过 10 分钟仍未完成。通常是 Python 或依赖下载源访问过慢，安装已中止。" : stderr || stdout || error.message || String(error);
          writeLocalAsrInstallLog({
            installRoot,
            platform,
            installerPath,
            command,
            stdout,
            stderr,
            error: errorText,
            status: "failed"
          });
          reject(new Error(errorText));
          return;
        }
        resolve({ stdout, stderr });
      });
    });
    const status = this.getLocalOcrInstallStatus();
    const pendingSwitchPath = path.join(installRoot, "pending-venv-switch.json");
    if (platform === "win32" && fs.existsSync(pendingSwitchPath)) {
      new Notice("图片文字识别 OCR 修复已准备完成，重启 Obsidian 后会自动完成切换。", 1e4);
      return { pendingRestart: true };
    }
    if (!status.ready) {
      const missingText = status.missingReasons && status.missingReasons.length ? status.missingReasons.join("；") : "图片文字识别模块不完整";
      writeLocalAsrInstallLog({
        installRoot,
        platform,
        installerPath,
        command,
        stdout: installResult && installResult.stdout,
        stderr: installResult && installResult.stderr,
        error: missingText,
        status: "failed"
      });
      throw new Error(`本地转写组件安装不完整：${missingText}`);
    }
    new Notice("本地转写组件的图片文字识别模块已安装。");
  }
  async getAvailableLocalOcrInstallerPath() {
    const installerPath = this.getBundledLocalOcrInstallerPath();
    const isMac = this.getConfiguredLocalAsrPlatform() === "darwin";
    const installerUrl = isMac ? LOCAL_OCR_MACOS_INSTALLER_URL : LOCAL_OCR_INSTALLER_URL;
    const installerSha256 = isMac ? LOCAL_OCR_MACOS_INSTALLER_SHA256 : LOCAL_OCR_WINDOWS_INSTALLER_SHA256;
    const downloadedPath = path.join(os.tmpdir(), `wechat-inbox-local-ocr-installer-${Date.now()}${isMac ? ".sh" : ".ps1"}`);
    try {
      let scriptText = "";
      try {
        const response = await requestUrl({ url: `${installerUrl}?t=${Date.now()}`, method: "GET" });
        scriptText = response.text || "";
      } catch (error) {
        scriptText = await downloadTextViaNode(`${installerUrl}?t=${Date.now()}`);
      }
      if (!isTrustedLocalOcrInstallerSource(scriptText, installerSha256, isMac)) {
        throw new Error("Local OCR installer download returned outdated or invalid content");
      }
      fs.writeFileSync(downloadedPath, normalizeInstallerScriptText(scriptText, isMac), "utf8");
      this.copyBundledLocalOcrRuntimeAssets(downloadedPath);
      return downloadedPath;
    } catch (downloadError) {
      if (fs.existsSync(installerPath)) {
        const bundledScriptText = fs.readFileSync(installerPath, "utf8");
        if (isTrustedLocalOcrInstallerSource(bundledScriptText, installerSha256, isMac)) {
          if (isMac) {
            fs.writeFileSync(downloadedPath, normalizeInstallerScriptText(bundledScriptText, isMac), "utf8");
            this.copyBundledLocalOcrRuntimeAssets(downloadedPath);
            return downloadedPath;
          }
          return installerPath;
        }
      }
      throw new Error(`无法下载本地转写 OCR 安装器：${downloadError.message || downloadError}`);
    }
  }
  async runLocalImageOcrBatch(imageEntries = []) {
    const entries = Array.isArray(imageEntries) ? imageEntries : [];
    if (!entries.length) return [];
    const status = this.getLocalOcrInstallStatus();
    if (!status || !status.ready || !status.pythonPath) {
      throw createLocalOcrBatchError("not_ready");
    }
    let batchTempDir = "";
    try {
      batchTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wechat-inbox-ocr-batch-"));
      const runnerPath = path.join(
        batchTempDir,
        `${LOCAL_OCR_BATCH_RUNNER_VERSION}.py`
      );
      const manifestPath = path.join(batchTempDir, "manifest.json");
      const outputPath = path.join(batchTempDir, "result.json");
      const manifestItems = entries.map((entry, sourceOrder) => {
        const rawIndex = Number(entry && entry.index);
        const integerIndex = Number.isFinite(rawIndex) ? Math.floor(rawIndex) : 0;
        const rawId = String(entry && entry.id || "").trim();
        return {
          id: /^[A-Za-z0-9_-]{1,80}$/.test(rawId) ? rawId : `image-${sourceOrder + 1}`,
          index: integerIndex > 0 ? integerIndex : sourceOrder + 1,
          input: String(entry && (entry.imagePath || entry.input || entry.path) || "")
        };
      });
      fs.writeFileSync(runnerPath, LOCAL_OCR_BATCH_RUNNER_SOURCE, "utf8");
      fs.writeFileSync(manifestPath, JSON.stringify({
        schemaVersion: 1,
        runnerVersion: LOCAL_OCR_BATCH_RUNNER_VERSION,
        items: manifestItems
      }), "utf8");
      await new Promise((resolve, reject) => {
        childProcess.execFile(status.pythonPath, [
          runnerPath,
          "--batch-manifest",
          manifestPath,
          "--output",
          outputPath
        ], {
          timeout: LOCAL_OCR_BATCH_RUN_TIMEOUT_MS,
          maxBuffer: 10 * 1024 * 1024,
          windowsHide: true
        }, (error) => {
          if (error) {
            const timedOut = Boolean(
              error.killed || error.signal === "SIGTERM" || /timed out|timeout/i.test(String(error.message || ""))
            );
            reject(createLocalOcrBatchError(timedOut ? "timeout" : "process"));
            return;
          }
          resolve();
        });
      });
      if (!fs.existsSync(outputPath)) throw createLocalOcrBatchError("schema");
      let payload;
      try {
        payload = JSON.parse(fs.readFileSync(outputPath, "utf8"));
      } catch (error) {
        throw createLocalOcrBatchError("schema");
      }
      return bindLocalOcrBatchResultItems(payload, manifestItems);
    } catch (error) {
      if (/^LOCAL_OCR_BATCH_/.test(String(error && error.code || ""))) throw error;
      throw createLocalOcrBatchError("io");
    } finally {
      if (batchTempDir) {
        try {
          fs.rmSync(batchTempDir, { recursive: true, force: true });
        } catch (error) {
        }
      }
    }
  }
  async runLocalImageOcr(imagePath) {
    const status = this.getLocalOcrInstallStatus();
    if (!status.ready) {
      const missingText = status.missingReasons && status.missingReasons.length ? status.missingReasons.join("；") : "图片文字识别模块未安装";
      throw new Error(`${missingText}。请在插件设置的 Pro 高级功能里修复本地转写组件。`);
    }
    const outputPath = path.join(os.tmpdir(), `wechat-inbox-ocr-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.txt`);
    try {
      await new Promise((resolve, reject) => {
        childProcess.execFile(status.pythonPath, [
          status.scriptPath,
          "--input",
          imagePath,
          "--output",
          outputPath
        ], {
          timeout: LOCAL_OCR_RUN_TIMEOUT_MS,
          maxBuffer: 10 * 1024 * 1024,
          windowsHide: true
        }, (error, stdout, stderr) => {
          if (error) {
            reject(new Error(stderr || stdout || error.message || String(error)));
            return;
          }
          resolve({ stdout, stderr });
        });
      });
      return fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8").trim() : "";
    } finally {
      try {
        fs.rmSync(outputPath, { force: true });
      } catch (error) {
      }
    }
  }
  async getAvailableLocalAsrInstallerPath(options = {}) {
    const installerPath = this.getBundledLocalAsrInstallerPath();
    const isMac = this.getConfiguredLocalAsrPlatform() === "darwin";
    const installerUrl = isMac ? LOCAL_ASR_MACOS_INSTALLER_URL : LOCAL_ASR_INSTALLER_URL;
    const downloadedPath = path.join(os.tmpdir(), `wechat-inbox-local-asr-installer-${Date.now()}${isMac ? ".sh" : ".ps1"}`);
    const isInstallerCurrent = /* @__PURE__ */ __name((scriptText) => isLocalAsrInstallerCurrent(scriptText, isMac), "isInstallerCurrent");
    const fetchInstallerText = typeof options.fetchInstallerText === "function" ? options.fetchInstallerText : async (url) => {
      try {
        const response = await requestUrl({ url, method: "GET" });
        return response.text || "";
      } catch (error) {
        return downloadTextViaNode(url);
      }
    };
    try {
      const scriptText = await fetchInstallerText(`${installerUrl}?t=${Date.now()}`);
      if (!isInstallerCurrent(scriptText)) {
        throw new Error("Local ASR installer download returned outdated or invalid content");
      }
      fs.writeFileSync(downloadedPath, normalizeInstallerScriptText(scriptText, isMac), "utf8");
      return downloadedPath;
    } catch (downloadError) {
      if (fs.existsSync(installerPath)) {
        const bundledScriptText = fs.readFileSync(installerPath, "utf8");
        if (isInstallerCurrent(bundledScriptText)) {
          if (isMac) {
            fs.writeFileSync(downloadedPath, normalizeInstallerScriptText(bundledScriptText, isMac), "utf8");
            return downloadedPath;
          }
          return installerPath;
        }
      }
      throw new Error(`无法下载最新本地转写安装器：${downloadError.message || downloadError}`);
    }
  }
  getLocalAsrInstallStatus() {
    return getLocalAsrInstallStatus(this.getConfiguredLocalAsrInstallRoot(), fs.existsSync, this.getConfiguredLocalAsrPlatform());
  }
  getLocalAsrDiagnosticText() {
    const platform = this.getConfiguredLocalAsrPlatform();
    const installRoot = this.getConfiguredLocalAsrInstallRoot();
    const status = getLocalAsrInstallStatus(installRoot, fs.existsSync, platform);
    const logText = readLocalAsrInstallLog(installRoot);
    const runLogText = readLocalAsrRunLog(installRoot);
    const syncLogText = readSyncDiagnosticLog(installRoot);
    const lastSyncText = this.lastSyncDiagnostic ? JSON.stringify(this.lastSyncDiagnostic, null, 2) : "";
    const diagnosticText = [
      "WeChat Inbox Sync 同步/安装失败诊断",
      `插件版本：${this.manifest && this.manifest.version ? this.manifest.version : "unknown"}`,
      `运行系统：${os.platform()} ${os.arch()} ${os.release()}`,
      `手动选择系统：${this.settings.localAsrPlatform || "auto"}`,
      `实际使用系统：${platform}`,
      `API 地址：${this.settings.apiBase || "-"}`,
      `安装目录：${status.installRoot}`,
      `转写脚本：${status.transcribeScript}`,
      `脚本存在：${status.hasTranscribeScript ? "是" : "否"}`,
      `脚本版本：${status.scriptOutdated ? "过旧，请重新安装本地转写组件" : status.scriptVersion}`,
      `脚本过旧：${status.scriptOutdated ? "是" : "否"}`,
      `脚本兼容状态：${status.upgradeRecommended ? "兼容可用，建议升级" : status.scriptOutdated ? "不可用" : "当前版本"}`,
      `whisper：${status.hasWhisper ? "是" : "否"}`,
      `whisper 路径：${status.whisperPath || "未找到"}`,
      `ffmpeg：${status.hasFfmpeg ? "是" : "否"}`,
      `ffmpeg 路径：${status.ffmpegPath || "未找到"}`,
      `模型文件：${status.hasModel ? "是" : "否"}`,
      `模型路径：${status.modelPath}`,
      `组件可用：${status.ready ? "是" : "否"}`,
      `缺失项：${status.missingReasons && status.missingReasons.length ? status.missingReasons.join("；") : "无"}`,
      `绑定码：${this.getActiveBindings().map((item) => `${item.label || ""}:[REDACTED]`).join(", ") || "-"}`,
      `权限缓存：${JSON.stringify(redactSensitiveObject(this.settings.localTranscriptionEntitlementStatus || {}))}`,
      `最近权限查询失败：${this.settings.proEntitlementLastError ? `${this.settings.proEntitlementLastErrorAt || "时间未知"} ${this.settings.proEntitlementLastError}` : "无"}`,
      "最近同步状态：",
      lastSyncText || syncLogText || "暂无 sync-last.log",
      "最近转写日志：",
      runLogText || "暂无 transcribe-last.log",
      "最近安装日志：",
      logText || "暂无 install.log"
    ].join("\n");
    return redactKnownCredentials(diagnosticText, this.settings);
  }
  getSyncDiagnosticText() {
    const platform = this.getConfiguredLocalAsrPlatform();
    const runtimeIdentity = getPluginRuntimeIdentity(
      this.manifest && this.manifest.version ? this.manifest.version : ""
    );
    const asrRoot = this.getConfiguredLocalAsrInstallRoot();
    const ocrRoot = this.getConfiguredLocalOcrInstallRoot();
    const asrStatus = typeof this.getLocalAsrInstallStatus === "function" ? this.getLocalAsrInstallStatus() : getLocalAsrInstallStatus(asrRoot, fs.existsSync, platform);
    const ocrStatus = typeof this.getLocalOcrInstallStatus === "function" ? this.getLocalOcrInstallStatus() : getLocalOcrInstallStatus(ocrRoot, fs.existsSync, platform);
    const asrInstallLog = readLocalAsrInstallLog(asrRoot);
    const asrRunLog = readLocalAsrRunLog(asrRoot);
    const ocrInstallLog = readLocalAsrInstallLog(ocrRoot);
    const syncLogText = readSyncDiagnosticLog(asrRoot);
    const lastSyncText = this.lastSyncDiagnostic ? JSON.stringify(this.lastSyncDiagnostic, null, 2) : syncLogText;
    const hasFailureSignal = /* @__PURE__ */ __name((text) => /status\s*=\s*failed|failed|failure|error|exception|traceback|curl:\s*\(\d+\)|connection reset|timed out|timeout|not found|permission denied|denied|未找到|失败|错误|异常|超时|缺失|不完整/i.test(String(text || "")), "hasFailureSignal");
    const hasAsrRunFailureSignal = /* @__PURE__ */ __name((text) => {
      const source = String(text || "");
      const errorSectionMatch = source.match(/--- error ---\s*([\s\S]*)$/i);
      const explicitError = errorSectionMatch ? errorSectionMatch[1].trim() : "";
      return Boolean(explicitError) || /status\s*=\s*failed|whisper failed|ffmpeg failed|failed with exit code|command failed|runtimeexception|fullyqualifiederrorid|operationstopped|traceback|enoent|permission denied|timed out|timeout/i.test(source);
    }, "hasAsrRunFailureSignal");
    const tailLog = /* @__PURE__ */ __name((text, maxLines = 50) => String(text || "").split(/\r?\n/).slice(-maxLines).join("\n").trim(), "tailLog");
    const appendFailedLog = /* @__PURE__ */ __name((lines2, title, text, detector = hasFailureSignal) => {
      const source = String(text || "").trim();
      if (!source || !detector(source)) return false;
      lines2.push(title, tailLog(source));
      return true;
    }, "appendFailedLog");
    const formatMissingReasons = /* @__PURE__ */ __name((status) => status && Array.isArray(status.missingReasons) && status.missingReasons.length ? status.missingReasons.join("；") : "无", "formatMissingReasons");
    const lines = [
      "WeChat Inbox Sync 同步/安装失败诊断",
      `插件版本：${runtimeIdentity.manifestVersion}`,
      `运行 Bundle：${runtimeIdentity.runtimeVersion} / ${runtimeIdentity.buildMarker}`,
      `版本身份一致：${runtimeIdentity.matchesManifest ? "是" : "否（请完全退出并重新打开 Obsidian）"}`,
      `运行系统：${os.platform()} ${os.arch()} ${os.release()}`,
      `手动选择系统：${this.settings.localAsrPlatform || "auto"}`,
      `实际使用系统：${platform}`,
      `API 地址：${this.settings.apiBase || "-"}`,
      `绑定码：${this.getActiveBindings().map((item) => `${item.label || ""}:[REDACTED]`).join(", ") || "-"}`,
      `权限缓存：${JSON.stringify(redactSensitiveObject(this.settings.localTranscriptionEntitlementStatus || {}))}`,
      `最近权限查询失败：${this.settings.proEntitlementLastError ? `${this.settings.proEntitlementLastErrorAt || "时间未知"} ${this.settings.proEntitlementLastError}` : "无"}`,
      "",
      "组件状态：",
      `音视频转写 ASR：${asrStatus.ready ? "可用" : "不可用"}`,
      `ASR 安装目录：${asrStatus.installRoot || asrRoot}`,
      `ASR 缺失项：${formatMissingReasons(asrStatus)}`,
      `图片文字识别 OCR：${ocrStatus.ready ? "可用" : "不可用"}`,
      `OCR 安装目录：${ocrStatus.installRoot || ocrRoot}`,
      `OCR 安装日志：${getLocalAsrInstallLogPath(ocrRoot)}`,
      `OCR 缺失项：${formatMissingReasons(ocrStatus)}`
    ];
    if (lastSyncText && hasFailureSignal(lastSyncText)) {
      lines.push("", "最近同步失败状态：", lastSyncText);
    }
    if (!asrStatus.ready) {
      appendFailedLog(lines, "ASR 最近安装失败日志：", asrInstallLog);
      appendFailedLog(lines, "ASR 最近转写失败日志：", asrRunLog, hasAsrRunFailureSignal);
    } else {
      appendFailedLog(lines, "ASR 最近转写失败日志：", asrRunLog, hasAsrRunFailureSignal);
    }
    if (!ocrStatus.ready) {
      const appendedOcrLog = appendFailedLog(lines, "OCR 最近安装失败日志：", ocrInstallLog);
      if (ocrStatus.hasPython && !ocrStatus.hasScript) {
        lines.push("", "OCR 修复建议：Python 环境已安装，仅 OCR 脚本缺失；重新安装会复用现有环境并补齐脚本。");
      }
      if (!appendedOcrLog) {
        lines.push("", "OCR 安装日志未找到或没有记录失败信息；请重新安装/修复本地转写组件以生成新的分阶段日志。");
      }
    }
    if (!lines.some((line) => /失败日志|失败状态/.test(line))) {
      lines.push("", "未检测到失败日志；已省略成功日志。");
    } else {
      lines.push("", "已省略成功日志，只保留失败相关信息。");
    }
    return redactKnownCredentials(lines.join("\n"), this.settings);
  }
  async copyTextToClipboard(text) {
    if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    try {
      const electron = require("electron");
      if (electron && electron.clipboard && electron.clipboard.writeText) {
        electron.clipboard.writeText(text);
        return true;
      }
    } catch (error) {
    }
    return false;
  }
  async copyDiagnosticText(text, fileName = "diagnostic.txt") {
    if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    try {
      const electron = require("electron");
      if (electron && electron.clipboard && electron.clipboard.writeText) {
        electron.clipboard.writeText(text);
        return true;
      }
    } catch (error) {
    }
    const installRoot = this.getConfiguredLocalAsrInstallRoot();
    const diagnosticPath = path.join(installRoot, fileName);
    fs.mkdirSync(installRoot, { recursive: true });
    fs.writeFileSync(diagnosticPath, text, "utf8");
    new Notice(`诊断信息已写入：${diagnosticPath}`);
    return false;
  }
  async copyLocalAsrDiagnosticText() {
    return this.copyDiagnosticText(this.getLocalAsrDiagnosticText(), "local-asr-diagnostic.txt");
  }
  async copySyncDiagnosticText() {
    return this.copyDiagnosticText(this.getSyncDiagnosticText(), "sync-diagnostic.txt");
  }
  async getLocalTranscriptionEntitlementStatus(options = {}) {
    const bindings = this.getActiveBindings();
    if (!bindings.length) {
      const unboundStatus = {
        hasAccess: false,
        plan: LOCAL_TRANSCRIPTION_PLAN,
        status: "unbound",
        expiresAt: ""
      };
      await this.cacheLocalTranscriptionEntitlementStatus(unboundStatus);
      return unboundStatus;
    }
    const plans = [LOCAL_TRANSCRIPTION_PLAN, ...LOCAL_TRANSCRIPTION_FALLBACK_PLANS];
    let lastInactiveStatus = null;
    const queryErrors = [];
    for (const binding of bindings) {
      for (const plan of plans) {
        try {
          const payload = await this.requestJson(
            `/entitlements/status?plan=${encodeURIComponent(plan)}`,
            "GET",
            {},
            binding,
            { noCache: options.forceRefresh === true }
          );
          const data = payload && payload.data ? payload.data : {};
          if (data.hasAccess) {
            const activeStatus = {
              hasAccess: true,
              plan: data.plan || plan,
              status: data.status || "active",
              expiresAt: data.expiresAt || "",
              code: normalizeBindCodeInput(data.code || data.redeemCode || ""),
              bindingToken: binding.token,
              bindingLabel: binding.label || ""
            };
            await this.cacheLocalTranscriptionEntitlementStatus(activeStatus);
            if (activeStatus.code && this.settings.pendingRedeemCode !== activeStatus.code) {
              await this.saveSettings({
                ...this.settings,
                pendingRedeemCode: activeStatus.code
              });
            }
            return activeStatus;
          }
          lastInactiveStatus = data;
        } catch (error) {
          queryErrors.push(error);
        }
      }
    }
    if (queryErrors.length) {
      const queryError = queryErrors[queryErrors.length - 1];
      await this.cacheProEntitlementQueryError(queryError);
      throw queryError;
    }
    const inactiveStatus = {
      hasAccess: false,
      plan: LOCAL_TRANSCRIPTION_PLAN,
      status: lastInactiveStatus && lastInactiveStatus.status || "inactive",
      expiresAt: lastInactiveStatus && lastInactiveStatus.expiresAt || ""
    };
    await this.cacheLocalTranscriptionEntitlementStatus(inactiveStatus);
    return inactiveStatus;
  }
  async getProFeatureAccessStatus(options = {}) {
    const code = normalizeBindCodeInput(this.settings.pendingRedeemCode);
    const cached = this.settings && this.settings.localTranscriptionEntitlementStatus;
    if (!options.forceRefresh && isCachedProStatusActive(cached)) return cached;
    const bindingStatus = await this.getLocalTranscriptionEntitlementStatus({
      forceRefresh: options.forceRefresh === true
    });
    if (isCachedProStatusActive(bindingStatus)) return bindingStatus;
    if (code) {
      return await this.validateProRedeemCodeAccess(code);
    }
    return bindingStatus || buildMissingRedeemCodeStatus();
  }
  async hasProFeatureAccess() {
    const cached = this.settings && this.settings.localTranscriptionEntitlementStatus;
    if (isCachedProStatusActive(cached)) return true;
    try {
      const status = await this.getProFeatureAccessStatus();
      return isCachedProStatusActive(status);
    } catch (error) {
      return false;
    }
  }
  async ensureProFeatureAccess(featureName = "该功能", options = {}) {
    let status = await this.getProFeatureAccessStatus({
      forceRefresh: options.forceRefresh === true
    });
    if (isCachedProStatusActive(status)) return status;
    const expiresAt = status && status.expiresAt ? new Date(status.expiresAt).getTime() : 0;
    if (status && status.hasAccess && expiresAt && expiresAt <= Date.now()) {
      status = { ...status, hasAccess: false, status: "expired" };
    }
    if (status.status === "missing_redeem_code") {
      throw new Error(`${featureName}需要有效 Pro。请先绑定小程序并开通 Pro。`);
    }
    if (status.status === "unbound") {
      throw new Error(`${featureName}需要有效 Pro。请先绑定小程序绑定码。`);
    }
    if (status.status === "expired") {
      throw new Error(`${featureName}需要有效 Pro，当前权限已过期。`);
    }
    throw new Error(`${featureName}需要有效 Pro，${status.message || "请先在小程序开通 Pro 后刷新权限。"}`);
  }
  async validateProRedeemCodeAccess(code, options = {}) {
    const normalizedCode = normalizeBindCodeInput(code);
    if (!normalizedCode) {
      const missingStatus = buildMissingRedeemCodeStatus();
      await this.cacheLocalTranscriptionEntitlementStatus(missingStatus);
      if (options.throwOnError) throw new Error("请先输入兑换码。");
      return missingStatus;
    }
    const bindings = this.getActiveBindings();
    if (!bindings.length) {
      const unboundStatus = {
        hasAccess: false,
        plan: LOCAL_TRANSCRIPTION_PLAN,
        status: "unbound",
        expiresAt: "",
        code: normalizedCode,
        message: "请先绑定小程序绑定码，再输入兑换码。"
      };
      await this.cacheLocalTranscriptionEntitlementStatus(unboundStatus);
      if (options.throwOnError) throw new Error(unboundStatus.message);
      return unboundStatus;
    }
    const binding = bindings[0];
    try {
      const payload = await this.requestJson("/entitlements/redeem", "POST", { code: normalizedCode }, binding);
      const status = payload && payload.data ? payload.data : payload;
      const activeStatus = {
        ...status,
        hasAccess: Boolean(status && status.hasAccess),
        code: normalizeBindCodeInput(status && status.code || normalizedCode),
        bindingToken: binding.token,
        bindingLabel: binding.label || ""
      };
      await this.cacheLocalTranscriptionEntitlementStatus(activeStatus);
      if (activeStatus.code && this.settings.pendingRedeemCode !== activeStatus.code) {
        await this.saveSettings({
          ...this.settings,
          pendingRedeemCode: activeStatus.code
        });
      }
      if (!activeStatus.hasAccess && options.throwOnError) {
        throw new Error(formatRedeemAccessError(new Error(activeStatus.message || ""), "redeem"));
      }
      return activeStatus;
    } catch (error) {
      const message = formatRedeemAccessError(error, options.mode || "redeem");
      const inactiveStatus = {
        hasAccess: false,
        plan: LOCAL_TRANSCRIPTION_PLAN,
        status: /过期/.test(message) ? "expired" : "invalid_redeem_code",
        expiresAt: "",
        code: normalizedCode,
        message,
        bindingToken: binding.token,
        bindingLabel: binding.label || ""
      };
      await this.cacheLocalTranscriptionEntitlementStatus(inactiveStatus);
      if (options.throwOnError) throw new Error(message);
      return inactiveStatus;
    }
  }
  async redeemProCode() {
    const code = normalizeBindCodeInput(this.settings.pendingRedeemCode);
    if (!code) {
      new Notice("请填写兑换码");
      return null;
    }
    try {
      const status = await this.validateProRedeemCodeAccess(code, { throwOnError: true, mode: "redeem" });
      new Notice(status && status.expiresAt ? `Pro 权限已开通，有效期至 ${formatEntitlementExpiresAt(status.expiresAt)}` : "Pro 权限已开通");
      return status;
    } catch (error) {
      new Notice(`兑换失败：${formatRedeemAccessError(error, "redeem")}`);
      return null;
    }
  }
  async autoRedeemProCode(options = {}) {
    const bindings = this.getActiveBindings();
    if (!bindings.length) {
      if (!options.silent) new Notice("请先绑定小程序绑定码，再自动识别兑换码。");
      return null;
    }
    let lastError = null;
    for (const binding of bindings) {
      try {
        const payload = await this.requestJson("/entitlements/auto-redeem", "POST", {}, binding);
        const status = payload && payload.data ? payload.data : payload;
        if (status && status.hasAccess) {
          const cachedStatus = {
            ...status,
            code: normalizeBindCodeInput(status.code || ""),
            bindingToken: binding.token,
            bindingLabel: binding.label || ""
          };
          if (!cachedStatus.code) {
            lastError = new Error("没有识别到可用兑换码");
            continue;
          }
          await this.cacheLocalTranscriptionEntitlementStatus(cachedStatus);
          await this.saveSettings({
            ...this.settings,
            pendingRedeemCode: cachedStatus.code
          });
          if (!options.silent) {
            new Notice(status.autoRedeemed ? `已自动识别并开通 Pro，有效期至 ${formatEntitlementExpiresAt(status.expiresAt)}` : `Pro 权限有效${status.expiresAt ? `，有效期至 ${formatEntitlementExpiresAt(status.expiresAt)}` : ""}`);
          }
          return cachedStatus;
        }
        lastError = status;
      } catch (error) {
        lastError = error;
      }
    }
    if (!options.silent) {
      new Notice(`自动识别兑换码失败：${formatRedeemAccessError(lastError, "auto")}`);
    }
    return null;
  }
  getLocalTranscriptionComponentReadiness() {
    const asrStatus = this.getLocalAsrInstallStatus();
    const ocrStatus = this.getLocalOcrInstallStatus();
    const platform = this.getConfiguredLocalAsrPlatform();
    const missingComponents = [];
    if (!asrStatus.ready) missingComponents.push("音视频转写");
    if (!ocrStatus.ready) missingComponents.push("图片文字识别 OCR");
    return {
      ready: missingComponents.length === 0,
      platform,
      platformName: LOCAL_ASR_PLATFORM_NAMES[platform] || platform,
      missingComponents,
      asrStatus,
      ocrStatus
    };
  }
  async refreshProAndMaybePromptLocalComponentInstall(options = {}) {
    const reason = options.reason || "settings-open";
    const now = Date.now();
    const lastCheckedAt = Date.parse(this.settings.proSetupLastCheckedAt || "");
    if (!options.force && reason === "settings-open" && Number.isFinite(lastCheckedAt) && now - lastCheckedAt < PRO_SETUP_CHECK_INTERVAL_MS) {
      const cached = this.settings.localTranscriptionEntitlementStatus;
      if (isCachedProStatusActive(cached)) return cached;
    }
    let status = null;
    try {
      status = await this.getProFeatureAccessStatus({ forceRefresh: Boolean(options.force) });
    } finally {
      if (reason === "settings-open") {
        await this.saveSettings({
          ...this.settings,
          proSetupLastCheckedAt: new Date(now).toISOString()
        });
      }
    }
    if (!status || !status.hasAccess) return status;
    const readiness = this.getLocalTranscriptionComponentReadiness();
    if (readiness.ready) return status;
    const snoozedUntil = Date.parse(this.settings.proSetupInstallPromptSnoozedUntil || "");
    if (!options.force && reason !== "first-use" && Number.isFinite(snoozedUntil) && snoozedUntil > now) {
      return status;
    }
    const accepted = await this.confirmLocalComponentInstall(status, reason, readiness);
    if (!accepted) {
      await this.saveSettings({
        ...this.settings,
        proSetupInstallPromptSnoozedUntil: new Date(now + PRO_SETUP_PROMPT_COOLDOWN_MS).toISOString()
      });
      return status;
    }
    try {
      await this.installLocalTranscriptionComponents({ reason, readiness });
    } catch (error) {
      if (reason === "first-use") {
        throw error;
      }
      return {
        ...status,
        localComponentInstallError: error && error.message ? error.message : String(error || "")
      };
    }
    return status;
  }
  async confirmLocalComponentInstall(status, reason, readiness) {
    const missingText = readiness.missingComponents.join("、") || "本地转写组件";
    const reasonText = reason === "first-use" ? "当前操作需要使用本地转写组件。" : "检测到你已开通 Pro，但本地转写组件还没有准备完整。";
    const message = [
      reasonText,
      `缺少：${missingText}`,
      `当前电脑：${readiness.platformName || "当前系统"}`,
      "这个组件用于音视频转写和小红书图片文字识别，图片会在本机识别，不上传到云端。",
      "现在开始安装/修复吗？"
    ].join("\n");
    const modalResult = showLocalComponentInstallConfirm(this.app, message);
    if (modalResult) {
      return await modalResult;
    }
    if (typeof window !== "undefined" && typeof window.confirm === "function") {
      return Boolean(window.confirm(message));
    }
    new Notice(`Pro 已开通，但缺少${missingText}。请在插件设置的 Pro 高级功能里安装本地转写组件。`, 1e4);
    return false;
  }
  async installLocalTranscriptionComponents(options = {}) {
    if (this.localComponentInstallPromise) {
      new Notice("本地转写组件正在准备中，请等待当前安装完成后再重试。");
      return await this.localComponentInstallPromise;
    }
    this.localComponentInstallPromise = this.doInstallLocalTranscriptionComponents(options);
    try {
      return await this.localComponentInstallPromise;
    } catch (error) {
      await this.showLocalComponentInstallFailure(error);
      throw error;
    } finally {
      this.localComponentInstallPromise = null;
    }
  }
  async showLocalComponentInstallFailure(error) {
    const reason = formatLocalComponentInstallFailureReason(error);
    const message = [
      `失败原因：${reason}`,
      "如需协助，请点击插件设置里的「复制诊断信息」，联系开发者张张（微信：heyhmjx）。"
    ].join("\n");
    const modalResult = showLocalComponentInstallFailure(this.app, message);
    if (modalResult) {
      await modalResult;
      return;
    }
    new Notice(`本地转写组件安装失败：${reason}。如需协助，请点击插件设置里的「复制诊断信息」，联系开发者张张（微信：heyhmjx）。`, 12e3);
  }
  async doInstallLocalTranscriptionComponents(options = {}) {
    await this.ensureProFeatureAccess("本地转写组件安装");
    const readiness = options.readiness || this.getLocalTranscriptionComponentReadiness();
    const requireAsr = options.requireAsr !== false;
    const requireOcr = options.requireOcr !== false;
    const failures = [];
    if (requireAsr && (!readiness.asrStatus || !readiness.asrStatus.ready)) {
      try {
        await this.installLocalAsr({ installMode: normalizeLocalAsrInstallMode(this.settings.localAsrInstallMode), reason: options.reason });
      } catch (error) {
        failures.push({
          component: "音视频转写 ASR",
          error
        });
      }
    }
    const ocrStatus = this.getLocalOcrInstallStatus();
    if (requireOcr && !ocrStatus.ready) {
      try {
        await this.installLocalOcr({ reason: options.reason });
      } catch (error) {
        failures.push({
          component: "图片文字识别 OCR",
          error
        });
      }
    }
    if (failures.length) {
      const message = failures.map((item) => `${item.component}：${item.error && item.error.message ? item.error.message : item.error}`).join("\n");
      throw new Error(message);
    }
    return {
      installed: true,
      reason: options.reason || "",
      readiness: this.getLocalTranscriptionComponentReadiness()
    };
  }
  async ensureLocalComponentReadyForUse(featureName = "该功能", options = {}) {
    const status = await this.ensureProFeatureAccess(featureName);
    const readiness = this.getLocalTranscriptionComponentReadiness();
    const requireAsr = options.requireAsr !== false;
    const requireOcr = Boolean(options.requireOcr);
    const asrMissing = requireAsr && (!readiness.asrStatus || !readiness.asrStatus.ready);
    const ocrMissing = requireOcr && (!readiness.ocrStatus || !readiness.ocrStatus.ready);
    if (!asrMissing && !ocrMissing) return status;
    const accepted = await this.confirmLocalComponentInstall(status, options.reason || "first-use", readiness);
    if (!accepted) {
      throw new Error(`${featureName}需要先安装本地转写组件。`);
    }
    await this.installLocalTranscriptionComponents({
      reason: options.reason || "first-use",
      readiness,
      requireAsr,
      requireOcr
    });
    const nextReadiness = this.getLocalTranscriptionComponentReadiness();
    const stillAsrMissing = requireAsr && (!nextReadiness.asrStatus || !nextReadiness.asrStatus.ready);
    const stillOcrMissing = requireOcr && (!nextReadiness.ocrStatus || !nextReadiness.ocrStatus.ready);
    if (stillAsrMissing || stillOcrMissing) {
      throw new Error(`${featureName}需要本地转写组件安装完整后才能使用。`);
    }
    return status;
  }
  async ensureLocalTranscriptionAccess() {
    return await this.ensureProFeatureAccess("音视频转写权限");
  }
  async installLocalAsr(options = {}) {
    if (this.localAsrInstallPromise) {
      new Notice("本地转写组件正在安装中，请等待当前安装完成后再重试。");
      return await this.localAsrInstallPromise;
    }
    this.localAsrInstallPromise = this.doInstallLocalAsr(options);
    try {
      return await this.localAsrInstallPromise;
    } finally {
      this.localAsrInstallPromise = null;
    }
  }
  async doInstallLocalAsr(options = {}) {
    await this.ensureLocalTranscriptionAccess();
    const mismatchMessage = getLocalAsrPlatformMismatchMessage(this.settings.localAsrPlatform);
    if (mismatchMessage) {
      throw new Error(mismatchMessage);
    }
    const installerPath = await this.getAvailableLocalAsrInstallerPath();
    const platform = this.getConfiguredLocalAsrPlatform();
    const installMode = normalizeLocalAsrInstallMode(options.installMode || this.settings.localAsrInstallMode);
    const installRoot = this.getConfiguredLocalAsrInstallRoot(installMode);
    const command = buildLocalAsrInstallCommand(installerPath, platform, platform === "win32" ? installRoot : "");
    new Notice("开始安装本地转写组件，可能需要几分钟。");
    await new Promise((resolve, reject) => {
      childProcess.exec(command, {
        timeout: LOCAL_ASR_INSTALL_TIMEOUT_MS,
        maxBuffer: 20 * 1024 * 1024,
        windowsHide: true
      }, (error, stdout, stderr) => {
        if (error) {
          const timedOut = error.killed || error.signal === "SIGTERM" || /timed out|timeout/i.test(error.message || "");
          const errorText = timedOut ? "本地转写组件安装超时：安装超过 20 分钟仍未完成。通常是腾讯云下载源、ffmpeg、模型文件或 Python 依赖访问过慢。安装已中止，请复制诊断信息联系开发者。" : error.message || String(error);
          const logPath = writeLocalAsrInstallLog({
            installRoot,
            platform,
            installerPath,
            command,
            stdout,
            stderr,
            error: errorText,
            status: "failed"
          });
          const message = timedOut ? errorText : stderr || stdout || errorText;
          reject(new Error(`${message}${logPath ? `
安装日志：${logPath}` : ""}`));
          return;
        }
        writeLocalAsrInstallLog({
          installRoot,
          platform,
          installerPath,
          command,
          stdout,
          stderr,
          status: "success"
        });
        resolve({ stdout, stderr });
      });
    });
    const installStatus = getLocalAsrInstallStatus(installRoot, fs.existsSync, platform);
    if (!installStatus.ready) {
      const missingText = installStatus.missingReasons && installStatus.missingReasons.length ? installStatus.missingReasons.join("；") : "本地转写组件不完整";
      const logPath = writeLocalAsrInstallLog({
        installRoot,
        platform,
        installerPath,
        command,
        stdout: `whisper=${installStatus.whisperPath || "missing"}
ffmpeg=${installStatus.ffmpegPath || "missing"}
model=${installStatus.hasModel ? installStatus.modelPath : "missing"}`,
        stderr: missingText,
        error: missingText,
        status: "failed"
      });
      throw new Error(`本地转写组件安装不完整：${missingText}${logPath ? `
安装日志：${logPath}` : ""}`);
    }
    await this.saveSettings({
      ...this.settings,
      aiProvider: "local",
      localAsrInstallMode: installMode,
      localTranscriptionCommand: getDefaultLocalTranscriptionCommand(platform, installRoot)
    });
    new Notice("本地转写组件已安装，并已填入默认命令。");
  }
  async switchLocalAsrToSafeInstallRoot() {
    if (this.getConfiguredLocalAsrPlatform() !== "win32") {
      throw new Error("安全安装目录目前只用于 Windows。");
    }
    await this.installLocalAsr({ installMode: "safe" });
  }
  async checkAndRepairLocalAsr() {
    const platform = this.getConfiguredLocalAsrPlatform();
    const installRoot = this.getConfiguredLocalAsrInstallRoot();
    const status = this.getLocalAsrInstallStatus();
    const action = getLocalAsrRepairAction({
      platform,
      installRoot,
      status,
      runLogText: readLocalAsrRunLog(installRoot)
    });
    if (action === "none") {
      new Notice("当前本地转写组件正常，不需要高级修复。");
      return { action };
    }
    if (action === "safe") {
      await this.installLocalAsr({ installMode: "safe" });
      new Notice("已切换到安全安装目录，并重新安装本地转写组件。");
      return { action };
    }
    await this.installLocalAsr({ installMode: normalizeLocalAsrInstallMode(this.settings.localAsrInstallMode) });
    new Notice("已更新本地转写组件。");
    return { action };
  }
  async renderSocialMediaUrl(url, options = {}) {
    return renderSocialMediaUrlWithElectron(url, options);
  }
  async renderXiaohongshuPage(url, options = {}) {
    return await renderXiaohongshuPageWithElectron(url, options);
  }
  async requestXiaohongshuStaticPage(url) {
    const sourceUrl = String(url || "").trim();
    if (!isTrustedXiaohongshuTransportUrl(sourceUrl)) {
      throw new Error("小红书静态抓取地址不是可信的官方 HTTPS 地址");
    }
    const response = await requestPublicWebpageText(sourceUrl, {
      // Static public-note extraction never needs login cookies. Logged-in
      // comments stay inside the isolated BrowserWindow / strict API path.
      headers: getSocialRequestHeaders(sourceUrl),
      allowedRedirectUrl: /* @__PURE__ */ __name((redirectUrl) => isTrustedXiaohongshuTransportUrl(redirectUrl), "allowedRedirectUrl")
    });
    if (!response || !isTrustedXiaohongshuCookieUrl(response.url)) {
      throw new Error("小红书正文抓取的最终地址无法确认为官方 HTTPS 内容页");
    }
    return response;
  }
  async fetchDouyinMediaUrlsWithSession(pageUrl, awemeId) {
    return fetchDouyinMediaUrlsWithSession({ pageUrl, awemeId });
  }
  async fetchDouyinMediaResolutionWithSession(pageUrl, awemeId) {
    return fetchDouyinMediaResolutionWithSession({ pageUrl, awemeId });
  }
  async downloadMediaArrayBufferWithSession(url, headers = {}, options = {}) {
    return downloadArrayBufferViaElectronSession(url, headers, options);
  }
  async renderWebpageWithElectron(url) {
    return renderUrlToMarkdownWithElectron(url);
  }
  async renderFeishuDocumentWithElectron(url) {
    return renderFeishuUrlToSimpleMarkdownWithElectron(url);
  }
  async downloadWebpageHtmlViaNode(url) {
    return downloadTextViaNode(url);
  }
  async renderWechatArticleFallback(record, url, rootDir, dateFolder, title, requestError, nodeError = null) {
    const rendered = await this.renderWebpageWithElectron(url);
    const renderedMarkdown = String(rendered && rendered.markdown || "").trim();
    if (!renderedMarkdown) throw new Error("hidden browser returned empty article content");
    const markdown = await this.saveWebpageImageAssets(
      renderedMarkdown,
      rendered.assets,
      rootDir,
      dateFolder,
      title,
      { sourceUrl: url }
    );
    const diagnostic = buildWebpageTransportDiagnostic({
      sourceUrl: url,
      requestError,
      nodeError,
      selectedTransport: "hidden-browser"
    });
    return {
      ...record,
      metadata: {
        ...record.metadata || {},
        title: record.metadata && record.metadata.title || rendered.title || "",
        markdown,
        conversionStatus: "success",
        conversionSource: "electron-fallback",
        conversionDiagnostic: diagnostic,
        conversionNote: "Obsidian requestUrl 与 Node.js 均失败，已使用隐藏浏览器通道恢复正文"
      }
    };
  }
  async refreshDouyinMediaUrls(sourceUrl) {
    const originalUrl = String(sourceUrl || "").trim();
    if (!isDouyinUrl(originalUrl)) return [];
    const directTarget = normalizeDouyinTargetUrl(originalUrl, originalUrl);
    if (directTarget.awemeId) {
      const candidates2 = [];
      try {
        candidates2.push(...await this.fetchDouyinMediaUrlsWithSession(directTarget.url, directTarget.awemeId));
      } catch (error) {
      }
      if (candidates2.length) return sortMediaUrlsForTranscription(candidates2);
      try {
        candidates2.push(...await this.renderSocialMediaUrls(directTarget.url, {
          timeoutMs: 18e3,
          strictDouyinTarget: true
        }));
      } catch (error) {
      }
      return sortMediaUrlsForTranscription(candidates2);
    }
    let resolvedUrl = originalUrl;
    try {
      resolvedUrl = await resolveRedirectUrl(originalUrl, 5, "GET");
    } catch (error) {
      resolvedUrl = originalUrl;
    }
    const target = normalizeDouyinTargetUrl(originalUrl, resolvedUrl);
    const candidates = [];
    if (target.awemeId) {
      try {
        candidates.push(...await this.fetchDouyinMediaUrlsWithSession(target.url, target.awemeId));
      } catch (error) {
      }
      if (!candidates.length) {
        try {
          candidates.push(...await this.renderSocialMediaUrls(target.url, {
            timeoutMs: 18e3,
            strictDouyinTarget: true
          }));
        } catch (error) {
        }
      }
      return sortMediaUrlsForTranscription(candidates);
    }
    return [];
  }
  async renderSocialMediaUrls(url, options = {}) {
    if (Object.prototype.hasOwnProperty.call(this, "renderSocialMediaUrl") && !Object.prototype.hasOwnProperty.call(this, "renderSocialMediaUrls")) {
      return sortMediaUrlsForTranscription([await this.renderSocialMediaUrl(url, options)]);
    }
    return renderSocialMediaUrlsWithElectron(url, options);
  }
  async runConfiguredTranscription(audioUrl, options = {}) {
    const provider = this.settings.aiProvider;
    const runLocalFallback = /* @__PURE__ */ __name(async (sourcePrefix) => {
      if (provider === "doubao") {
        await this.clearPendingDoubaoTask(getDoubaoTaskKey(audioUrl));
      }
      return {
        transcription: await this.runLocalTranscription(audioUrl, options),
        source: sourcePrefix ? `${sourcePrefix}-local` : "local"
      };
    }, "runLocalFallback");
    if (options.forceLocal) {
      return runLocalFallback("");
    }
    if (provider === "off" && this.canRunLocalTranscription() && await this.hasProFeatureAccess()) {
      return runLocalFallback("");
    }
    if (["aliyun", "doubao", "tencent"].includes(provider) && isHeaderProtectedMediaUrl(audioUrl)) {
      if (this.canRunLocalTranscription()) {
        return runLocalFallback(provider);
      }
      throw new Error("该平台音频地址带防盗链，云端转写服务无法直接下载。请安装本地转写组件后重试。");
    }
    if (this.settings.aiProvider === "aliyun") {
      try {
        return {
          transcription: await this.runAliyunTranscription(audioUrl),
          source: "aliyun"
        };
      } catch (error) {
        if (isRemoteAsrDownloadFailure(error) && this.canRunLocalTranscription()) {
          return runLocalFallback("aliyun");
        }
        throw error;
      }
    }
    if (this.settings.aiProvider === "doubao") {
      try {
        return {
          transcription: await this.runDoubaoTranscription(audioUrl),
          source: "doubao"
        };
      } catch (error) {
        if (isRemoteAsrDownloadFailure(error) && this.canRunLocalTranscription()) {
          return runLocalFallback("doubao");
        }
        throw error;
      }
    }
    if (this.settings.aiProvider === "tencent") {
      try {
        return {
          transcription: await this.runTencentTranscription(audioUrl),
          source: "tencent"
        };
      } catch (error) {
        if (isRemoteAsrDownloadFailure(error) && this.canRunLocalTranscription()) {
          return runLocalFallback("tencent");
        }
        throw error;
      }
    }
    if (this.settings.aiProvider === "local") {
      try {
        return {
          transcription: await this.runLocalTranscription(audioUrl, options),
          source: "local"
        };
      } catch (error) {
        if (isRetryableTranscriptionError(error)) {
          throw error;
        }
        if (!options.fileID && !options.allowCloudUrlFallback) {
          throw error;
        }
        return await this.runCloudFallbackTranscription(audioUrl, {
          ...options,
          localError: error && error.message ? error.message : String(error || ""),
          source: options.source || "local"
        });
      }
    }
    throw new Error("未配置可用的音频转写方案");
  }
  async runCloudFallbackTranscription(audioUrl, options = {}) {
    const binding = options.binding || this.getActiveBindings()[0] || null;
    if (!binding) {
      throw new Error(`${options.localError || "本地转写失败"}；云端兜底失败：未绑定小程序`);
    }
    this.showSyncProgress({
      stage: "transcribing",
      title: options.title || "",
      message: "本地转写失败，正在尝试云端兜底"
    });
    const fileID = String(options.fileID || "").trim();
    if (!fileID && !options.allowCloudUrlFallback) {
      throw new Error(`${options.localError || "本地转写失败"}；云端兜底失败：缺少云端文件 ID`);
    }
    try {
      const requestBody = {
        durationSeconds: options.durationSeconds || 60,
        localError: options.localError || "",
        source: options.source || "local",
        title: options.title || ""
      };
      if (fileID) {
        requestBody.fileID = fileID;
      } else {
        requestBody.audioUrl = audioUrl;
      }
      const payload = await this.requestJson("/transcriptions/cloud", "POST", requestBody, binding, {
        signal: options.signal || null
      });
      throwIfAborted(options.signal || null);
      const data = payload && payload.data ? payload.data : {};
      const transcription = String(data.transcription || "").trim();
      if (!transcription) {
        throw new Error("云端兜底返回空转写结果");
      }
      return {
        transcription,
        source: "local-cloud-fallback",
        cloudProvider: data.provider || "cloud",
        cloudRequestId: data.requestId || "",
        cloudUsedSeconds: Number(data.usedSeconds) || 0,
        cloudRemainingSeconds: Number(data.remainingSeconds) || 0
      };
    } catch (cloudError) {
      if (isAbortError(cloudError) || options.signal && options.signal.aborted) {
        throw createAbortError();
      }
      const cloudMessage = cloudError && cloudError.message ? cloudError.message : String(cloudError || "");
      throw new Error(`${options.localError || "本地转写失败"}；云端兜底失败：${cloudMessage}`);
    }
  }
  async runLocalTranscription(audioUrl, options = {}) {
    await this.ensureLocalComponentReadyForUse("音视频转写", {
      reason: "first-use",
      requireAsr: true,
      requireOcr: false
    });
    await this.recoverStaleLocalTranscriptionCommand();
    const installStatus = this.getLocalAsrInstallStatus();
    const installRoot = this.getConfiguredLocalAsrInstallRoot();
    if (installStatus.scriptOutdated) {
      throw new Error("本地转写脚本过旧：请在插件设置里重新点击“安装/更新本地转写组件”，安装完成后再同步。");
    }
    const commandTemplate = this.getEffectiveLocalTranscriptionCommand();
    if (!commandTemplate) {
      throw new Error("未配置本地转写命令");
    }
    const progressTitle = options.title || "";
    const abortController = new AbortController();
    this.currentTranscriptionAbortController = abortController;
    this.currentTranscriptionContext = {
      recordId: options.recordId || "",
      binding: options.binding || null,
      title: progressTitle
    };
    this.setTranscriptionStopAvailable(true);
    let progressTimer = null;
    let lastProgressKey = "";
    const emitLocalProgress = /* @__PURE__ */ __name((fallbackPercent = null) => {
      if (typeof this.showSyncProgress !== "function") return;
      const parsedProgress = parseLocalAsrProgressLog(readLocalAsrRunLog(installRoot));
      const progress = parsedProgress || (fallbackPercent === null ? null : {
        stage: "",
        current: 0,
        total: 0,
        percent: fallbackPercent
      });
      if (!progress) return;
      const key = buildLocalAsrProgressKey(progress);
      if (key === lastProgressKey) return;
      lastProgressKey = key;
      this.showSyncProgress({
        ...options,
        stage: "transcribing",
        title: progressTitle,
        percent: progress.percent,
        localProgressStage: progress.stage,
        localProgressCurrent: progress.current,
        localProgressTotal: progress.total,
        localProgressStartedAt: progress.startedAt,
        localProgressHeartbeatAt: progress.heartbeatAt
      });
    }, "emitLocalProgress");
    const stopProgressPolling = /* @__PURE__ */ __name(() => {
      if (progressTimer) {
        clearInterval(progressTimer);
        progressTimer = null;
      }
    }, "stopProgressPolling");
    let inputPath = "";
    let outputPath = "";
    let command = "";
    try {
      this.showSyncProgress({
        ...options,
        stage: "downloading",
        title: progressTitle,
        percent: 0
      });
      inputPath = await this.downloadMediaToTempFile(audioUrl, {
        sourceUrl: options.sourceUrl || options.url || "",
        decryptKey: options.decryptKey || options.wechatChannelsDecodeKey || "",
        signal: abortController.signal,
        onProgress: /* @__PURE__ */ __name((progress = {}) => {
          if (typeof progress.percent === "number") {
            this.showSyncProgress({
              ...options,
              stage: "downloading",
              title: progressTitle,
              percent: progress.percent
            });
          }
        }, "onProgress")
      });
      throwIfAborted(abortController.signal);
      outputPath = `${inputPath}.txt`;
      const quote = /* @__PURE__ */ __name((value) => `"${String(value).replace(/"/g, '\\"')}"`, "quote");
      command = commandTemplate.includes("{input}") ? commandTemplate.replace(/\{input\}/g, quote(inputPath)).replace(/\{output\}/g, quote(outputPath)) : `${commandTemplate} ${quote(inputPath)}`;
      const { stdout, stderr } = await new Promise((resolve, reject) => {
        emitLocalProgress(0);
        progressTimer = setInterval(() => emitLocalProgress(), 1e3);
        if (progressTimer && typeof progressTimer.unref === "function") {
          progressTimer.unref();
        }
        const child = childProcess.exec(command, {
          timeout: 2 * 60 * 60 * 1e3,
          maxBuffer: 50 * 1024 * 1024,
          windowsHide: true,
          detached: process.platform === "darwin"
        }, (error, stdout2, stderr2) => {
          stopProgressPolling();
          this.currentTranscriptionProcess = null;
          if (abortController.signal.aborted) {
            reject(createAbortError());
            return;
          }
          if (error) {
            const wrapped = new Error(stderr2 || error.message || String(error));
            wrapped.stdout = stdout2;
            wrapped.stderr = stderr2;
            reject(wrapped);
            return;
          }
          emitLocalProgress(100);
          resolve({ stdout: stdout2, stderr: stderr2 });
        });
        this.currentTranscriptionProcess = child;
        this.currentTranscriptionProcessDetached = process.platform === "darwin";
      });
      const outputText = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : stdout;
      const transcription = assertUsableTranscription(
        cleanTrailingTranscriptionHallucinations(String(outputText || "").trim()),
        "本地转写"
      );
      writeLocalAsrRunLog({
        installRoot,
        status: "success",
        command,
        inputPath,
        outputPath,
        stdout,
        stderr
      });
      return transcription;
    } catch (error) {
      if (isAbortError(error)) {
        throw createRetryableTranscriptionError("用户已停止当前转写");
      }
      appendLocalAsrRunLog({
        installRoot,
        status: "failed",
        command,
        inputPath,
        outputPath,
        stdout: error && error.stdout ? error.stdout : "",
        stderr: error && error.stderr ? error.stderr : "",
        error: error && error.message ? error.message : String(error || "")
      });
      throw error;
    } finally {
      stopProgressPolling();
      this.currentTranscriptionAbortController = null;
      this.currentTranscriptionProcess = null;
      this.currentTranscriptionProcessDetached = false;
      this.currentTranscriptionContext = null;
      this.setTranscriptionStopAvailable(false);
      [inputPath, outputPath].forEach((filePath) => {
        try {
          if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
        } catch (error) {
        }
      });
    }
  }
  async downloadMediaToTempFile(audioUrl, options = {}) {
    const resolvedUrl = shouldResolveMediaDownloadUrl(audioUrl) ? await resolveRedirectUrl(audioUrl, 5, "GET") : audioUrl;
    throwIfAborted(options.signal);
    const mediaDownloadDeadlineAt = Date.now() + 15 * 60 * 1e3;
    const getMediaDownloadRequestOptions = /* @__PURE__ */ __name(() => {
      const remainingMs = mediaDownloadDeadlineAt - Date.now();
      if (remainingMs <= 0) throw createMediaDownloadTimeoutError("total");
      return {
        signal: options.signal,
        onProgress: options.onProgress,
        idleTimeoutMs: 9e4,
        totalTimeoutMs: remainingMs,
        timeout: Math.max(100, Math.min(3e4, remainingMs))
      };
    }, "getMediaDownloadRequestOptions");
    const sourceUrl = String(options.sourceUrl || "").trim();
    const refreshDouyinMediaUrlsWithinBudget = /* @__PURE__ */ __name(async () => {
      const remainingMs = mediaDownloadDeadlineAt - Date.now();
      if (remainingMs <= 0) throw createMediaDownloadTimeoutError("total");
      try {
        return await waitForPromiseWithAbort(
          runBrowserTaskWithTimeout(
            this.refreshDouyinMediaUrls(sourceUrl),
            remainingMs,
            "Douyin media refresh"
          ),
          options.signal
        );
      } catch (error) {
        if (error && error.code === "BROWSER_TASK_TIMEOUT") {
          throw createMediaDownloadTimeoutError("total");
        }
        throw error;
      }
    }, "refreshDouyinMediaUrlsWithinBudget");
    const requestHeaders = getSocialRequestHeaders(sourceUrl || resolvedUrl);
    const canRecoverDouyin = isDouyinUrl(sourceUrl) || isDouyinUrl(audioUrl) || isDouyinMediaUrl(resolvedUrl);
    let downloadedUrl = resolvedUrl;
    let downloadedArrayBuffer;
    try {
      downloadedArrayBuffer = await this.downloadArrayBuffer(
        resolvedUrl,
        requestHeaders,
        getMediaDownloadRequestOptions()
      );
    } catch (error) {
      if (!canRecoverDouyin || !isRecoverableDouyinMediaDownloadError(error)) throw error;
      let lastError = error;
      try {
        downloadedArrayBuffer = await this.downloadMediaArrayBufferWithSession(
          resolvedUrl,
          requestHeaders,
          getMediaDownloadRequestOptions()
        );
      } catch (sessionError) {
        lastError = sessionError;
        const refreshedUrls = sourceUrl ? (await refreshDouyinMediaUrlsWithinBudget()).slice(0, 3) : [];
        for (const refreshedUrl of refreshedUrls) {
          if (!refreshedUrl || refreshedUrl === resolvedUrl) continue;
          try {
            downloadedArrayBuffer = await this.downloadArrayBuffer(
              refreshedUrl,
              getSocialRequestHeaders(sourceUrl || refreshedUrl),
              getMediaDownloadRequestOptions()
            );
            downloadedUrl = refreshedUrl;
            break;
          } catch (refreshedError) {
            lastError = refreshedError;
            if (!isRecoverableDouyinMediaDownloadError(refreshedError)) continue;
            try {
              downloadedArrayBuffer = await this.downloadMediaArrayBufferWithSession(
                refreshedUrl,
                getSocialRequestHeaders(sourceUrl || refreshedUrl),
                getMediaDownloadRequestOptions()
              );
              downloadedUrl = refreshedUrl;
              break;
            } catch (refreshedSessionError) {
              lastError = refreshedSessionError;
            }
          }
        }
        if (!downloadedArrayBuffer) throw lastError;
      }
    }
    const downloadedBuffer = Buffer.from(downloadedArrayBuffer);
    throwIfAborted(options.signal);
    const buffer = options.decryptKey ? decryptWechatChannelsMediaBuffer(downloadedBuffer, options.decryptKey) : downloadedBuffer;
    const invalidReason = getInvalidDownloadedMediaReason(buffer);
    if (invalidReason) {
      throw new Error(`${invalidReason}：${cleanDisplayUrl(downloadedUrl || audioUrl)}`);
    }
    const ext = getAudioFormatFromUrl(downloadedUrl || audioUrl);
    const filePath = path.join(os.tmpdir(), `wechat-inbox-sync-${Date.now()}-${crypto.randomBytes(4).toString("hex")}.${ext}`);
    fs.writeFileSync(filePath, buffer);
    return filePath;
  }
  async runAliyunTranscription(audioUrl) {
    const response = await requestUrl({
      url: this.settings.aliyunBaseUrl,
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.settings.aliyunApiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(buildAliyunVoiceRequest({
        settings: this.settings,
        audioUrl
      }))
    });
    if (response.status && (response.status < 200 || response.status >= 300)) {
      throw new Error(`阿里云百炼请求失败：HTTP ${response.status} ${String(response.text || "").slice(0, 180)}`);
    }
    const transcription = parseAliyunTranscriptionResult(response.text || JSON.stringify(response.json || {}));
    if (!transcription) {
      throw new Error("阿里云百炼返回空转写结果");
    }
    return transcription;
  }
  async runDoubaoTranscriptionLegacy(audioUrl) {
    const request = buildDoubaoAsrRequest({
      apiKey: this.settings.doubaoAsrApiKey,
      audioUrl
    });
    const response = await requestUrl({
      url: request.url,
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      throw: request.throw
    });
    if (response.status && (response.status < 200 || response.status >= 300)) {
      throw new Error(formatHttpError("豆包语音识别", response));
    }
    if (response.status && (response.status < 200 || response.status >= 300)) {
      throw new Error(`豆包语音识别请求失败：HTTP ${response.status} ${String(response.text || "").slice(0, 180)}`);
    }
    const transcription = parseDoubaoAsrResult(response.json || response.text);
    if (!transcription) {
      throw new Error("豆包语音识别返回空转写结果");
    }
    return transcription;
  }
  async runDoubaoTranscription(audioUrl) {
    const taskKey = getDoubaoTaskKey(audioUrl);
    const pendingTasks = this.settings.pendingDoubaoTasks || {};
    const existingTask = pendingTasks[taskKey];
    if (existingTask && existingTask.requestId) {
      try {
        const existingState = await this.queryDoubaoTranscription(existingTask.requestId);
        if (existingState.status === "success") {
          await this.clearPendingDoubaoTask(taskKey);
          return existingState.transcription;
        }
      } catch (error) {
        await this.clearPendingDoubaoTask(taskKey);
        throw error;
      }
      throw createRetryableTranscriptionError("豆包语音识别仍在处理中，请稍后再次同步");
    }
    const requestId = createRequestId();
    const request = buildDoubaoAsrRequest({
      apiKey: this.settings.doubaoAsrApiKey,
      audioUrl,
      requestId
    });
    const submitResponse = await requestUrl({
      url: request.url,
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      throw: request.throw
    });
    const submitState = parseDoubaoAsrTaskState(submitResponse);
    if (submitState.status === "success") {
      return submitState.transcription;
    }
    await this.savePendingDoubaoTask(taskKey, {
      requestId,
      audioUrl,
      createdAt: (/* @__PURE__ */ new Date()).toISOString()
    });
    for (let attempt = 0; attempt < this.settings.doubaoPollAttempts; attempt += 1) {
      if (attempt > 0) {
        await sleep(this.settings.doubaoPollIntervalMs);
      }
      let state;
      try {
        state = await this.queryDoubaoTranscription(requestId);
      } catch (error) {
        await this.clearPendingDoubaoTask(taskKey);
        throw error;
      }
      if (state.status === "success") {
        await this.clearPendingDoubaoTask(taskKey);
        return state.transcription;
      }
    }
    throw createRetryableTranscriptionError("豆包语音识别仍在处理中，请稍后再次同步");
  }
  async queryDoubaoTranscription(requestId) {
    const query = buildDoubaoAsrQueryRequest({
      apiKey: this.settings.doubaoAsrApiKey,
      requestId
    });
    const queryResponse = await requestUrl({
      url: query.url,
      method: "POST",
      headers: query.headers,
      body: JSON.stringify(query.body),
      throw: query.throw
    });
    return parseDoubaoAsrTaskState(queryResponse);
  }
  async savePendingDoubaoTask(taskKey, task) {
    await this.saveSettings({
      ...this.settings,
      pendingDoubaoTasks: {
        ...this.settings.pendingDoubaoTasks || {},
        [taskKey]: task
      }
    });
  }
  async clearPendingDoubaoTask(taskKey) {
    const nextTasks = { ...this.settings.pendingDoubaoTasks || {} };
    delete nextTasks[taskKey];
    await this.saveSettings({
      ...this.settings,
      pendingDoubaoTasks: nextTasks
    });
  }
  async runTencentTranscription(audioUrl) {
    const createPayload = await this.postTencent("CreateRecTask", buildTencentCreateRecTaskBody({
      audioUrl,
      engineModelType: this.settings.tencentEngineModelType
    }));
    const taskId = parseTencentCreateTaskResponse(createPayload);
    for (let attempt = 0; attempt < this.settings.tencentPollAttempts; attempt += 1) {
      if (attempt > 0) {
        await sleep(this.settings.tencentPollIntervalMs);
      }
      const statusPayload = await this.postTencent("DescribeTaskStatus", { TaskId: taskId });
      const status = parseTencentTaskStatusResponse(statusPayload);
      if (status.transcription || status.status === 2 || status.statusStr === "success") {
        return status.transcription;
      }
      if (status.status === 3 || status.statusStr === "failed") {
        throw new Error(status.errorMsg || "腾讯云转写失败");
      }
    }
    throw new Error("腾讯云转写仍在处理中，请稍后重试或调大轮询等待时间");
  }
  async ensureFolder(folderPath) {
    const normalizedFolderPath = normalizeVaultPath(folderPath);
    if (!normalizedFolderPath) return;
    const segments = normalizedFolderPath.split("/");
    let currentPath = "";
    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      if (!await this.app.vault.adapter.exists(currentPath)) {
        try {
          await this.app.vault.createFolder(currentPath);
        } catch (error) {
          if (!await this.app.vault.adapter.exists(currentPath)) {
            throw error;
          }
        }
      }
    }
  }
  async nextTitle(dayDir, recordOrTitle, createdAt) {
    const baseTitle = typeof recordOrTitle === "string" ? createdAt ? `${recordOrTitle}-${getTitleTimePart(createdAt)}` : recordOrTitle : buildRecordTitleBase(recordOrTitle);
    if (!await this.app.vault.adapter.exists(`${dayDir}/${baseTitle}.md`)) {
      return baseTitle;
    }
    let sequence = 2;
    while (await this.app.vault.adapter.exists(`${dayDir}/${baseTitle}-${String(sequence).padStart(3, "0")}.md`)) {
      sequence += 1;
    }
    return `${baseTitle}-${String(sequence).padStart(3, "0")}`;
  }
  async writeVoiceAttachment(record, rootDir, dateFolder, title, binding = null, progress = {}) {
    rootDir = normalizeConfiguredVaultPath(rootDir);
    const metadata = record.metadata || {};
    if (!metadata.audioFileID) {
      return record;
    }
    const sourceAudioName = metadata.audioFileName || record.content || "";
    const sourceAudioExt = getAttachmentExt(sourceAudioName, metadata.audioFileExt || metadata.fileExt);
    const audioFileName = `${title}.${sourceAudioExt || "mp3"}`;
    const audioRootDir = `${rootDir}/语音附件`;
    const audioDayDir = `${audioRootDir}/${dateFolder}`;
    const audioPath = `${audioDayDir}/${audioFileName}`;
    const tempFileURL = await this.requestFileDownloadUrl(metadata.audioFileID, binding);
    this.showSyncProgress({ ...progress, stage: "downloading", title });
    const audioBuffer = await this.downloadArrayBuffer(tempFileURL);
    if (typeof this.app.vault.adapter.writeBinary !== "function") {
      throw new Error("当前 Obsidian 环境不支持写入二进制附件");
    }
    await this.ensureFolder(audioRootDir);
    await this.ensureFolder(audioDayDir);
    await this.app.vault.adapter.writeBinary(normalizeVaultPath(audioPath), audioBuffer);
    let nextMetadata = {
      ...metadata,
      audioFileName: audioPath
    };
    const existingTranscriptionStatus = String(metadata.transcriptionStatus || "").toLowerCase();
    const existingTranscription = String(metadata.transcription || "").trim();
    const transcriptionSource = String(metadata.transcriptionSource || metadata.transcriptionProvider || "");
    const isCloudTranscriptionRecord = metadata.transcriptionMode === "cloud" || transcriptionSource.includes("cloud-pretranscription") || transcriptionSource.includes("cloud");
    const shouldFallbackCloudFailureToLocal = isCloudTranscriptionRecord && existingTranscriptionStatus === "failed" && !existingTranscription;
    if (shouldFallbackCloudFailureToLocal) {
      try {
        this.showSyncProgress({ ...progress, stage: "transcribing", title });
        const result = await this.runConfiguredTranscription(tempFileURL, {
          binding,
          fileID: metadata.audioFileID,
          recordId: getRecordId(record),
          title,
          forceLocal: true,
          cloudFallbackReason: "cloud-pretranscription-failed"
        });
        nextMetadata = {
          ...nextMetadata,
          transcription: result.transcription,
          transcriptionStatus: "success",
          transcriptionProvider: result.source,
          transcriptionSource: "local-fallback",
          cloudTranscriptionError: metadata.transcriptionError || "",
          cloudTranscriptionProvider: metadata.transcriptionProvider || metadata.transcriptionSource || "cloud-pretranscription"
        };
      } catch (error) {
        if (isRetryableTranscriptionError(error)) throw error;
        const message = error.message || String(error);
        nextMetadata = {
          ...nextMetadata,
          transcription: "",
          transcriptionStatus: "failed",
          transcriptionError: message,
          transcriptionProvider: "local",
          transcriptionSource: "local-fallback",
          cloudTranscriptionError: metadata.transcriptionError || ""
        };
      }
    } else if (isCloudTranscriptionRecord) {
      nextMetadata = {
        ...nextMetadata,
        transcription: existingTranscription,
        transcriptionStatus: existingTranscriptionStatus || "processing",
        transcriptionProvider: metadata.transcriptionProvider || metadata.transcriptionSource || "cloud-pretranscription",
        transcriptionSource: metadata.transcriptionSource || "cloud-pretranscription",
        transcriptionError: metadata.transcriptionError || (["queued", "processing"].includes(existingTranscriptionStatus) ? "云端转写中，下次同步会自动更新" : "")
      };
    } else if (this.settings.aiProvider !== "off" || metadata.transcriptionMode === "local") {
      try {
        this.showSyncProgress({ ...progress, stage: "transcribing", title });
        const result = await this.runConfiguredTranscription(tempFileURL, {
          binding,
          fileID: metadata.audioFileID,
          recordId: getRecordId(record),
          title,
          forceLocal: metadata.transcriptionMode === "local"
        });
        nextMetadata = {
          ...nextMetadata,
          transcription: result.transcription,
          transcriptionStatus: "success",
          transcriptionProvider: result.source,
          cloudTranscriptionProvider: result.cloudProvider || "",
          cloudTranscriptionRequestId: result.cloudRequestId || "",
          cloudTranscriptionUsedSeconds: result.cloudUsedSeconds || 0,
          cloudTranscriptionRemainingSeconds: result.cloudRemainingSeconds || 0
        };
      } catch (error) {
        if (isRetryableTranscriptionError(error)) throw error;
        const message = error.message || String(error);
        nextMetadata = {
          ...nextMetadata,
          transcription: "",
          transcriptionStatus: "failed",
          transcriptionError: message,
          transcriptionProvider: this.settings.aiProvider
        };
      }
    }
    return {
      ...record,
      metadata: nextMetadata
    };
  }
  async writeFileAttachment(record, rootDir, dateFolder, title, binding = null, progress = {}) {
    rootDir = normalizeConfiguredVaultPath(rootDir);
    const metadata = record.metadata || {};
    if (!metadata.fileID) {
      return record;
    }
    try {
      const fileName = metadata.fileName || record.content || `${title}.bin`;
      const fileExt = getAttachmentExt(fileName, metadata.fileExt);
      const safeFileName = sanitizeAttachmentName(fileName, `${title}${fileExt ? `.${fileExt}` : ""}`);
      const fileRootDir = `${rootDir}/文件附件`;
      const fileDayDir = `${fileRootDir}/${dateFolder}`;
      const filePath = `${fileDayDir}/${title}-${safeFileName}`;
      const tempFileURL = await this.requestFileDownloadUrl(metadata.fileID, binding);
      this.showSyncProgress({ ...progress, stage: "downloading", title: fileName });
      const fileBuffer = await this.downloadArrayBuffer(tempFileURL);
      if (typeof this.app.vault.adapter.writeBinary !== "function") {
        throw new Error("当前 Obsidian 环境不支持写入二进制附件");
      }
      await this.ensureFolder(fileRootDir);
      await this.ensureFolder(fileDayDir);
      await this.app.vault.adapter.writeBinary(normalizeVaultPath(filePath), fileBuffer);
      const nodeBuffer = toNodeBuffer(fileBuffer);
      const nextMetadata = {
        ...metadata,
        fileName,
        fileExt,
        filePath
      };
      try {
        if (isMarkdownConvertibleExt(fileExt)) {
          nextMetadata.convertedMarkdown = decodeUtf8ArrayBuffer(nodeBuffer);
          nextMetadata.conversionStatus = "success";
        } else if (fileExt === "docx") {
          nextMetadata.convertedMarkdown = extractDocxMarkdown(nodeBuffer);
          nextMetadata.conversionStatus = "success";
        } else if (fileExt === "pdf") {
          this.showSyncProgress({ ...progress, stage: "processing", title: fileName });
          nextMetadata.convertedMarkdown = extractPdfMarkdown(nodeBuffer);
          nextMetadata.conversionProvider = "pdf-text-layer";
          nextMetadata.conversionStatus = "success";
        } else if (fileExt === "doc") {
          nextMetadata.conversionStatus = "attachment_saved";
          nextMetadata.conversionError = "旧版 .doc 是二进制格式，当前请优先上传 .docx。";
        } else if (!nextMetadata.convertedMarkdown && !nextMetadata.markdown) {
          nextMetadata.conversionStatus = "attachment_saved";
        }
      } catch (error) {
        nextMetadata.conversionStatus = "attachment_saved";
        nextMetadata.conversionError = error.message || String(error);
      }
      if (isAudioVideoAttachmentExt(fileExt)) {
        try {
          this.showSyncProgress({ ...progress, stage: "transcribing", title: fileName });
          const result = await this.runConfiguredTranscription(tempFileURL, {
            binding,
            fileID: metadata.fileID,
            recordId: getRecordId(record),
            title,
            source: "file-attachment",
            forceLocal: metadata.transcriptionMode === "local",
            durationSeconds: Math.max(60, Math.ceil((Number(metadata.duration) || 0) / 1e3) || 60)
          });
          const transcriptProperties = buildTranscriptPropertyMetadata({
            transcription: result.transcription,
            title: metadata.title || title || fileName
          });
          nextMetadata.transcription = result.transcription;
          nextMetadata.transcriptionStatus = "success";
          nextMetadata.transcriptionProvider = result.source;
          nextMetadata.transcriptionSource = "file-attachment";
          nextMetadata.conversionStatus = "success";
          nextMetadata.cloudTranscriptionProvider = result.cloudProvider || "";
          nextMetadata.cloudTranscriptionRequestId = result.cloudRequestId || "";
          nextMetadata.cloudTranscriptionUsedSeconds = result.cloudUsedSeconds || 0;
          nextMetadata.cloudTranscriptionRemainingSeconds = result.cloudRemainingSeconds || 0;
          nextMetadata.description = nextMetadata.description || transcriptProperties.description;
          nextMetadata.keywords = getRecordKeywords(nextMetadata).length ? getRecordKeywords(nextMetadata) : transcriptProperties.keywords;
          nextMetadata.aiMetadataSource = nextMetadata.aiMetadataSource || transcriptProperties.aiMetadataSource;
          nextMetadata.contentCategory = nextMetadata.contentCategory || (["mp4", "mov", "m4v"].includes(fileExt) ? "视频" : "音频");
        } catch (error) {
          if (isRetryableTranscriptionError(error)) throw error;
          nextMetadata.transcription = "";
          nextMetadata.transcriptionStatus = "failed";
          nextMetadata.transcriptionError = error.message || String(error);
          nextMetadata.transcriptionProvider = this.settings.aiProvider;
          nextMetadata.transcriptionSource = "file-attachment";
          nextMetadata.conversionStatus = "failed";
          nextMetadata.contentCategory = nextMetadata.contentCategory || (["mp4", "mov", "m4v"].includes(fileExt) ? "视频" : "音频");
        }
      }
      return {
        ...record,
        metadata: nextMetadata
      };
    } catch (error) {
      if (isRetryableTranscriptionError(error)) throw error;
      return {
        ...record,
        metadata: {
          ...metadata,
          conversionStatus: "failed",
          conversionError: error.message || String(error)
        }
      };
    }
  }
  async saveWebpageImageAssets(markdown, assets, rootDir, dateFolder, title, options = {}) {
    rootDir = normalizeConfiguredVaultPath(rootDir);
    if (!Array.isArray(assets) || !assets.length || typeof this.app.vault.adapter.writeBinary !== "function") {
      return markdown;
    }
    const sourceUrl = String(options.sourceUrl || "").trim();
    const isFeishuSource = isFeishuUrl(sourceUrl);
    const isSessionBackedSource = isFeishuSource || isWechatArticleUrl(sourceUrl);
    const stats = options.stats && typeof options.stats === "object" ? options.stats : null;
    const reportError = /* @__PURE__ */ __name((asset, error) => {
      if (stats) {
        stats.failedCount = (Number(stats.failedCount) || 0) + 1;
        if (!asset || !String(asset.src || "").trim()) {
          stats.missingSourceCount = (Number(stats.missingSourceCount) || 0) + 1;
        }
      }
      if (typeof options.onError === "function") options.onError({ asset, error });
    }, "reportError");
    if (stats) {
      stats.assetCount = assets.length;
      stats.localizedCount = 0;
      stats.failedCount = 0;
      stats.missingSourceCount = 0;
    }
    const imageRootDir = `${rootDir}/网页图片`;
    const imageDayDir = `${imageRootDir}/${dateFolder}`;
    let nextMarkdown = String(markdown || "");
    let index = 1;
    await this.ensureFolder(imageRootDir);
    await this.ensureFolder(imageDayDir);
    for (const asset of assets) {
      const assetSource = String(asset && asset.src || "").trim();
      let decoded = decodeDataUrl(asset && asset.dataUrl);
      if (!decoded && assetSource && /^https?:\/\//i.test(assetSource)) {
        const imageHeaders = isSessionBackedSource ? { ...getSocialRequestHeaders(sourceUrl), Referer: sourceUrl } : {};
        let downloadError = null;
        try {
          const arrayBuffer = await this.downloadArrayBuffer(assetSource, imageHeaders);
          const buffer = Buffer.from(arrayBuffer || []);
          if (!buffer.length) throw new Error("image download returned an empty response");
          decoded = { buffer, mimeType: String(asset.mimeType || "") };
        } catch (error) {
          downloadError = error;
          if (isSessionBackedSource && typeof this.downloadMediaArrayBufferWithSession === "function") {
            try {
              const arrayBuffer = await this.downloadMediaArrayBufferWithSession(assetSource, imageHeaders);
              const buffer = Buffer.from(arrayBuffer || []);
              if (!buffer.length) throw new Error("browser-session image download returned an empty response");
              decoded = { buffer, mimeType: String(asset.mimeType || "") };
            } catch (sessionError) {
              const firstMessage = downloadError && downloadError.message ? downloadError.message : String(downloadError || "");
              const sessionMessage = sessionError && sessionError.message ? sessionError.message : String(sessionError || "");
              downloadError = new Error(
                [firstMessage, sessionMessage ? `browser-session: ${sessionMessage}` : ""].filter(Boolean).join("; ")
              );
            }
          }
        }
        if (!decoded && downloadError) {
          reportError(asset, downloadError);
          continue;
        }
      }
      if (!decoded || !assetSource) {
        reportError(asset, new Error(!assetSource ? "image asset has no source URL" : "image asset has no usable data"));
        continue;
      }
      const ext = decoded.mimeType && decoded.mimeType !== "application/octet-stream" ? getImageExtFromMime(decoded.mimeType) : getImageExtFromBuffer(decoded.buffer, assetSource);
      const imagePath = `${imageDayDir}/${title}-image-${String(index).padStart(2, "0")}.${ext}`;
      await this.app.vault.adapter.writeBinary(normalizeVaultPath(imagePath), decoded.buffer);
      const normalizedAssetSource = decodeHtmlEntities(assetSource).trim();
      let replacementCount = 0;
      nextMarkdown = nextMarkdown.replace(/!\[([^\]]*)\]\(([^)\n]+)\)/g, (full, _alt, markdownSource) => {
        const normalizedMarkdownSource = decodeHtmlEntities(String(markdownSource || "").trim()).trim();
        if (normalizedMarkdownSource !== normalizedAssetSource) return full;
        replacementCount += 1;
        return `![[${imagePath}]]`;
      });
      if (replacementCount > 0) {
        if (stats) stats.localizedCount = (Number(stats.localizedCount) || 0) + 1;
      } else {
        reportError(asset, new Error("image attachment was saved but no matching Markdown image reference was found"));
      }
      index += 1;
    }
    return nextMarkdown;
  }
  async saveMarkdownRemoteImageAssets(markdown, rootDir, dateFolder, title, options = {}) {
    rootDir = normalizeConfiguredVaultPath(rootDir);
    if (!markdown || !this.app || !this.app.vault || !this.app.vault.adapter || typeof this.app.vault.adapter.writeBinary !== "function") {
      return markdown;
    }
    const sourceUrl = String(options.sourceUrl || "").trim();
    const isXiaohongshuSource = isXiaohongshuUrl(sourceUrl);
    const isWechatArticleSource = isWechatArticleUrl(sourceUrl);
    const isFeishuSource = isFeishuUrl(sourceUrl);
    const isSessionBackedSource = isFeishuSource || isWechatArticleSource;
    let nextMarkdown = isXiaohongshuSource ? sanitizeXiaohongshuMarkdownImages(String(markdown)) : String(markdown);
    const imageMatches = Array.from(nextMarkdown.matchAll(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g));
    if (!imageMatches.length) return nextMarkdown;
    const imageRootDir = `${rootDir}/网页图片`;
    const imageDayDir = `${imageRootDir}/${dateFolder}`;
    let index = 1;
    const downloadedByUrl = /* @__PURE__ */ new Map();
    const safeTitle = sanitizeAttachmentName(title, "网页图片");
    try {
      await this.ensureFolder(imageRootDir);
      await this.ensureFolder(imageDayDir);
    } catch (error) {
      if (typeof options.onError === "function") {
        options.onError({ imageUrl: "", error });
      }
      return nextMarkdown;
    }
    for (const match of imageMatches) {
      const imageUrl = String(match[2] || "").trim();
      if (!imageUrl || downloadedByUrl.has(imageUrl)) continue;
      try {
        const imageHeaders = isXiaohongshuSource ? await getXiaohongshuRequestHeaders(sourceUrl) : isWechatArticleSource ? { ...getSocialRequestHeaders(sourceUrl), Referer: sourceUrl } : isFeishuSource ? { ...getSocialRequestHeaders(sourceUrl), Referer: sourceUrl } : {};
        let arrayBuffer;
        try {
          arrayBuffer = await this.downloadArrayBuffer(imageUrl, imageHeaders);
        } catch (downloadError) {
          if (!isSessionBackedSource || typeof this.downloadMediaArrayBufferWithSession !== "function") throw downloadError;
          try {
            arrayBuffer = await this.downloadMediaArrayBufferWithSession(imageUrl, imageHeaders);
          } catch (sessionError) {
            const firstMessage = downloadError && downloadError.message ? downloadError.message : String(downloadError || "");
            const sessionMessage = sessionError && sessionError.message ? sessionError.message : String(sessionError || "");
            throw new Error(
              [firstMessage, sessionMessage ? `browser-session: ${sessionMessage}` : ""].filter(Boolean).join("; ")
            );
          }
        }
        const buffer = Buffer.from(arrayBuffer || []);
        if (!buffer.length) throw new Error("图片下载结果为空");
        const ext = getImageExtFromBuffer(buffer, imageUrl);
        downloadedByUrl.set(imageUrl, {
          imageUrl,
          alt: String(match[1] || "").trim(),
          buffer,
          ext,
          dimensions: getImageDimensionsFromBuffer(buffer),
          hash: crypto.createHash("sha256").update(buffer).digest("hex")
        });
      } catch (error) {
        if (typeof options.onError === "function") {
          options.onError({ imageUrl, error });
        }
      }
    }
    const imagePathByAssetKey = /* @__PURE__ */ new Map();
    const replacementByUrl = /* @__PURE__ */ new Map();
    const seenWechatAssetHashes = /* @__PURE__ */ new Set();
    for (const asset of downloadedByUrl.values()) {
      if (isWechatArticleSource && isWechatExplicitDecorativeImageAsset(asset)) {
        replacementByUrl.set(asset.imageUrl, "");
        continue;
      }
      if (isWechatArticleSource && seenWechatAssetHashes.has(asset.hash)) {
        replacementByUrl.set(asset.imageUrl, "");
        continue;
      }
      if (isWechatArticleSource) {
        seenWechatAssetHashes.add(asset.hash);
      }
      const assetKey = isWechatArticleSource ? asset.hash : asset.imageUrl;
      let imagePath = imagePathByAssetKey.get(assetKey) || "";
      if (!imagePath) {
        imagePath = `${imageDayDir}/${safeTitle}-image-${String(index).padStart(2, "0")}.${asset.ext}`;
        await this.app.vault.adapter.writeBinary(normalizeVaultPath(imagePath), asset.buffer);
        imagePathByAssetKey.set(assetKey, imagePath);
        index += 1;
      }
      replacementByUrl.set(asset.imageUrl, imagePath);
    }
    replacementByUrl.forEach((imagePath, imageUrl) => {
      const pattern = new RegExp(`!\\[([^\\]]*)\\]\\(${escapeRegExp(imageUrl)}\\)`, "g");
      nextMarkdown = nextMarkdown.replace(pattern, imagePath ? `![[${imagePath}]]` : "");
    });
    if (isWechatArticleSource) {
      const seenLocalizedImagePaths = /* @__PURE__ */ new Set();
      nextMarkdown = nextMarkdown.replace(/!\[\[([^\]]+)\]\]/g, (match, imagePath) => {
        if (seenLocalizedImagePaths.has(imagePath)) return "";
        seenLocalizedImagePaths.add(imagePath);
        return match;
      });
      return nextMarkdown.replace(/\n{3,}/g, "\n\n");
    }
    return nextMarkdown;
  }
  async saveSourceMediaAttachment(record, rootDir, dateFolder, title) {
    rootDir = normalizeConfiguredVaultPath(rootDir);
    const metadata = record && record.metadata || {};
    const mediaUrl = String(metadata.mediaUrl || metadata.audioUrl || "").trim();
    if (!this.settings.saveOriginalMediaEnabled || !metadata.transcriptOnly || !mediaUrl) {
      return record;
    }
    try {
      await this.ensureProFeatureAccess("保存原始音视频到本地", { forceRefresh: true });
    } catch (error) {
      return record;
    }
    const videoPlatform = isVideoPlatform(metadata.platform, metadata.url || record.content || "");
    const attachmentFailure = /* @__PURE__ */ __name((message = "") => ({
      ...record,
      metadata: {
        ...metadata,
        sourceMediaAttachmentPath: "",
        sourceMediaAttachmentError: message || (videoPlatform ? "未取得原视频，已保留转写结果。" : "原始音视频未能保存到本地。")
      }
    }), "attachmentFailure");
    if (!this.app || !this.app.vault || !this.app.vault.adapter || typeof this.app.vault.adapter.writeBinary !== "function") {
      return attachmentFailure();
    }
    try {
      const sourceUrl = String(metadata.url || record.content || mediaUrl).trim();
      const candidates = Array.from(new Set([
        ...Array.isArray(metadata.mediaUrls) ? metadata.mediaUrls : [],
        mediaUrl
      ].map((item) => String(item || "").trim()).filter(Boolean)));
      let selectedBuffer = null;
      let selectedUrl = "";
      for (const candidateUrl of candidates) {
        const headers = isXiaohongshuUrl(sourceUrl) ? await getXiaohongshuRequestHeaders(candidateUrl) : getSocialRequestHeaders(sourceUrl || candidateUrl);
        const buffer = Buffer.from(await this.downloadArrayBuffer(candidateUrl, headers));
        if (getInvalidDownloadedMediaReason(buffer)) continue;
        if (videoPlatform && !hasVideoTrackInMediaBuffer(buffer)) continue;
        selectedBuffer = buffer;
        selectedUrl = candidateUrl;
        break;
      }
      if (!selectedBuffer || !selectedUrl) return attachmentFailure();
      const extension = videoPlatform ? "mp4" : getAudioFormatFromUrl(selectedUrl);
      const recordShortId = sanitizeAttachmentName(getRecordId(record), "media").slice(0, 12) || "media";
      const safeTitle = sanitizeAttachmentName(title || metadata.title, "音视频");
      const attachmentRootDir = `${rootDir}/音视频附件`;
      const attachmentDayDir = `${attachmentRootDir}/${dateFolder}`;
      const attachmentPath = `${attachmentDayDir}/${safeTitle}-${recordShortId}.${extension}`;
      await this.ensureFolder(attachmentRootDir);
      await this.ensureFolder(attachmentDayDir);
      await this.app.vault.adapter.writeBinary(normalizeVaultPath(attachmentPath), selectedBuffer);
      return {
        ...record,
        metadata: {
          ...metadata,
          sourceMediaAttachmentPath: attachmentPath,
          sourceMediaAttachmentError: ""
        }
      };
    } catch (error) {
      return attachmentFailure();
    }
  }
  async buildTranscriptRecordFromMedia(record, {
    url,
    platform,
    mediaUrl = "",
    mediaUrls = [],
    mediaItems = [],
    subtitleText = "",
    subtitleUrl = "",
    source = "",
    noMediaError = "",
    markdown = "",
    trailingMarkdown = "",
    binding = null,
    title = "",
    socialMetrics = {},
    sourceTitle = "",
    mediaResolutionDiagnostic = null,
    signal = null
  }) {
    throwIfAborted(signal);
    const metadata = record.metadata || {};
    const normalizedSourceTitle = String(sourceTitle || metadata.sourceTitle || "").trim();
    const metadataWithSocialMetrics = {
      ...metadata,
      contentCategory: metadata.contentCategory || "音视频",
      ...hasSocialMetrics(socialMetrics) ? { socialMetrics: withCapturedSocialMetrics(socialMetrics, (/* @__PURE__ */ new Date()).toISOString()) } : {},
      ...normalizedSourceTitle ? { sourceTitle: normalizedSourceTitle } : {}
    };
    if (subtitleText) {
      return {
        ...record,
        metadata: buildTranscriptOnlyMetadata(metadataWithSocialMetrics, {
          url,
          platform,
          mediaUrl,
          mediaUrls,
          subtitleUrl,
          transcription: subtitleText,
          transcriptionStatus: "success",
          transcriptionSource: source || "subtitle",
          conversionStatus: "success",
          markdown,
          trailingMarkdown,
          sourceTitle: normalizedSourceTitle,
          mediaResolutionDiagnostic
        })
      };
    }
    const candidateMap = /* @__PURE__ */ new Map();
    const addCandidate = /* @__PURE__ */ __name((value, extra = {}) => {
      let candidateUrl = "";
      let candidateMetadata = { ...extra };
      if (typeof value === "string") {
        candidateUrl = value;
      } else if (value && typeof value === "object") {
        candidateUrl = value.url || value.mediaUrl || value.videoUrl || "";
        candidateMetadata = { ...value, ...extra };
      }
      const normalizedUrl = normalizeExtractedUrl(candidateUrl);
      if (!/^https?:\/\//i.test(normalizedUrl) || !isLikelyMediaUrl(normalizedUrl)) return;
      const existing = candidateMap.get(normalizedUrl) || { url: normalizedUrl };
      const decryptKey = String(
        candidateMetadata.decryptKey || candidateMetadata.decodeKey || candidateMetadata.decode_key || candidateMetadata.wechatChannelsDecodeKey || existing.decryptKey || existing.decodeKey || ""
      ).trim();
      candidateMap.set(normalizedUrl, {
        ...existing,
        ...candidateMetadata,
        url: normalizedUrl,
        decryptKey,
        decodeKey: decryptKey || existing.decodeKey || ""
      });
    }, "addCandidate");
    addCandidate(mediaUrl);
    (Array.isArray(mediaUrls) ? mediaUrls : []).forEach((item) => addCandidate(item));
    (Array.isArray(mediaItems) ? mediaItems : []).forEach((item) => addCandidate(item));
    const candidates = sortMediaUrlsForTranscription(Array.from(candidateMap.keys())).map((candidateUrl) => candidateMap.get(candidateUrl)).filter(Boolean);
    if (!candidates.length) {
      return {
        ...record,
        metadata: buildTranscriptOnlyMetadata(metadataWithSocialMetrics, {
          url,
          platform,
          mediaUrl,
          subtitleUrl,
          transcription: "",
          transcriptionStatus: "failed",
          transcriptionError: noMediaError || "未能从链接中提取到可转写的音频或视频地址",
          transcriptionSource: source || "media-url",
          conversionStatus: "failed",
          markdown,
          trailingMarkdown,
          sourceTitle: normalizedSourceTitle,
          mediaResolutionDiagnostic
        })
      };
    }
    let lastError = null;
    try {
      for (const candidate of candidates) {
        throwIfAborted(signal);
        try {
          const candidateUrl = candidate.url;
          const candidateDecryptKey = String(candidate.decryptKey || candidate.decodeKey || "").trim();
          const useCloudForWebpage = !candidateDecryptKey && (metadata.transcriptionMode === "cloud" || metadata.cloudTranscriptionRequested === true);
          const result = useCloudForWebpage ? await this.runCloudFallbackTranscription(candidateUrl, {
            binding,
            title: title || metadata.title || "",
            source: source || "media-url",
            localError: "user selected cloud transcription",
            allowCloudUrlFallback: true,
            signal
          }) : await this.runConfiguredTranscription(candidateUrl, {
            allowCloudUrlFallback: true,
            title: metadata.title || "",
            source: source || "media-url",
            sourceUrl: url,
            binding,
            recordId: getRecordId(record),
            decryptKey: candidateDecryptKey,
            forceLocal: metadata.transcriptionMode === "local",
            signal
          });
          throwIfAborted(signal);
          const nextMetadata = buildTranscriptOnlyMetadata(metadataWithSocialMetrics, {
            url,
            platform,
            mediaUrl: candidateUrl,
            mediaUrls: candidates.map((candidate2) => candidate2.url),
            subtitleUrl,
            transcription: result.transcription,
            transcriptionStatus: "success",
            transcriptionSource: result.source,
            conversionStatus: "success",
            markdown,
            trailingMarkdown,
            sourceTitle: normalizedSourceTitle,
            mediaResolutionDiagnostic
          });
          return {
            ...record,
            metadata: {
              ...nextMetadata,
              cloudTranscriptionProvider: result.cloudProvider || nextMetadata.cloudTranscriptionProvider || "",
              cloudTranscriptionRequestId: result.cloudRequestId || nextMetadata.cloudTranscriptionRequestId || "",
              cloudTranscriptionUsedSeconds: result.cloudUsedSeconds || nextMetadata.cloudTranscriptionUsedSeconds || 0,
              cloudTranscriptionRemainingSeconds: result.cloudRemainingSeconds || nextMetadata.cloudTranscriptionRemainingSeconds || 0,
              wechatChannelsDecodeKey: candidateDecryptKey || nextMetadata.wechatChannelsDecodeKey || "",
              wechatChannelsEncryptedMedia: Boolean(candidateDecryptKey) || Boolean(nextMetadata.wechatChannelsEncryptedMedia)
            }
          };
        } catch (candidateError) {
          if (isAbortError(candidateError)) throw candidateError;
          lastError = candidateError;
        }
      }
      throw lastError || new Error("未能完成音视频转写");
    } catch (error) {
      if (isRetryableTranscriptionError(error)) {
        throw error;
      }
      return {
        ...record,
        metadata: buildTranscriptOnlyMetadata(metadataWithSocialMetrics, {
          url,
          platform,
          mediaUrl,
          subtitleUrl,
          transcription: "",
          transcriptionStatus: "failed",
          transcriptionError: error.message || String(error),
          transcriptionSource: source || this.settings.aiProvider || "unknown",
          conversionStatus: "failed",
          markdown,
          trailingMarkdown,
          sourceTitle: normalizedSourceTitle,
          mediaResolutionDiagnostic
        })
      };
    }
  }
  async hydrateXiaoyuzhouTranscript(record, url, binding = null, title = "") {
    const response = await requestUrl({ url, method: "GET", headers: getSocialRequestHeaders(url) });
    const html = response.text || "";
    const markdown = buildSocialMediaSupplementalMarkdownFromHtml(html, url);
    const pageMetadata = extractWebpageMetadataFromHtml(html, url);
    const mediaUrl = extractPodcastAudioUrlFromHtml(html) || extractSocialMediaUrlFromHtml(html);
    return this.buildTranscriptRecordFromMedia(record, {
      url,
      platform: "小宇宙",
      mediaUrl,
      mediaUrls: extractSocialMediaUrlsFromHtml(html),
      source: "audio",
      markdown,
      binding,
      title,
      sourceTitle: pageMetadata.title,
      socialMetrics: extractSocialMetricsFromHtml(html)
    });
  }
  async fetchBilibiliSubtitleTextFromUrls(subtitleUrls) {
    for (const subtitleUrl of subtitleUrls || []) {
      try {
        const response = await requestUrl({ url: subtitleUrl, method: "GET", headers: getSocialRequestHeaders("https://www.bilibili.com/") });
        const transcription = parseBilibiliSubtitlePayload(response.json || response.text);
        if (transcription) {
          return {
            transcription,
            subtitleUrl
          };
        }
      } catch (error) {
      }
    }
    return {
      transcription: "",
      subtitleUrl: ""
    };
  }
  async hydrateBilibiliTranscript(record, url, binding = null, title = "") {
    const resolvedUrl = shouldResolvePlatformRedirect(url) ? await resolveRedirectUrl(url) : url;
    const response = await requestUrl({ url: resolvedUrl, method: "GET", headers: getSocialRequestHeaders(resolvedUrl) });
    const html = response.text || "";
    let markdown = buildSocialMediaSupplementalMarkdownFromHtml(html, resolvedUrl);
    const pageMetadata = extractWebpageMetadataFromHtml(html, resolvedUrl);
    let sourceTitle = pageMetadata.title;
    let bilibiliSocialMetrics = extractSocialMetricsFromHtml(html);
    let subtitleUrls = extractBilibiliSubtitleUrlsFromHtml(html);
    let bvid = extractBilibiliBvid(resolvedUrl) || extractBilibiliBvid(url) || extractBilibiliBvid(html);
    let cid = "";
    let playurlAudioUrl = "";
    let progressiveVideoUrl = "";
    if (bvid) {
      try {
        const viewResponse = await requestUrl({
          url: `https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`,
          method: "GET",
          headers: getSocialRequestHeaders(resolvedUrl)
        });
        const viewPayload = viewResponse.json || tryParseJson(viewResponse.text) || {};
        const viewData = viewPayload && viewPayload.data && typeof viewPayload.data === "object" ? viewPayload.data : {};
        const apiTitle = cleanSocialDescription(viewData.title || "");
        const apiDescription = cleanSocialDescription(viewData.desc || viewData.description || "");
        const apiCoverUrl = normalizeExtractedUrl(viewData.pic || viewData.cover || viewData.coverUrl || "");
        sourceTitle = apiTitle || sourceTitle;
        if (apiTitle || apiDescription || apiCoverUrl) {
          markdown = buildSocialMediaSupplementalMarkdown({
            title: sourceTitle,
            description: apiDescription || pageMetadata.description,
            tags: pageMetadata.keywords,
            imageUrls: [
              apiCoverUrl,
              extractMetaContent(html, ["og:image", "twitter:image"])
            ].filter(Boolean)
          });
        }
        cid = extractBilibiliCidFromPayload(viewPayload);
        bilibiliSocialMetrics = hasSocialMetrics(buildSocialMetrics(viewPayload)) ? buildSocialMetrics(viewPayload) : bilibiliSocialMetrics;
        if (cid && !subtitleUrls.length) {
          const playerResponse = await requestUrl({
            url: `https://api.bilibili.com/x/player/v2?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}`,
            method: "GET",
            headers: getSocialRequestHeaders(resolvedUrl)
          });
          subtitleUrls = extractBilibiliSubtitleUrlsFromHtml(JSON.stringify(playerResponse.json || tryParseJson(playerResponse.text) || {}));
        }
        if (cid) {
          const playurlResponse = await requestUrl({
            url: `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}&fnval=16&fourk=1`,
            method: "GET",
            headers: getSocialRequestHeaders(resolvedUrl)
          });
          playurlAudioUrl = extractBilibiliAudioUrlFromPlayurlPayload(playurlResponse.json || playurlResponse.text);
          try {
            const progressiveResponse = await requestUrl({
              url: `https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(cid)}&fnval=0&fourk=0`,
              method: "GET",
              headers: getSocialRequestHeaders(resolvedUrl)
            });
            progressiveVideoUrl = extractBilibiliProgressiveVideoUrlFromPlayurlPayload(progressiveResponse.json || progressiveResponse.text);
          } catch (progressiveError) {
          }
        }
      } catch (error) {
      }
    }
    const subtitle = await this.fetchBilibiliSubtitleTextFromUrls(subtitleUrls);
    if (subtitle.transcription) {
      return this.buildTranscriptRecordFromMedia(record, {
        url,
        platform: "B站",
        mediaUrl: progressiveVideoUrl,
        mediaUrls: progressiveVideoUrl ? [progressiveVideoUrl] : [],
        subtitleText: subtitle.transcription,
        subtitleUrl: subtitle.subtitleUrl,
        source: "bilibili-subtitle",
        markdown,
        binding,
        title,
        sourceTitle,
        socialMetrics: bilibiliSocialMetrics
      });
    }
    return this.buildTranscriptRecordFromMedia(record, {
      url,
      platform: "B站",
      mediaUrl: playurlAudioUrl || extractBilibiliAudioUrlFromHtml(html) || extractSocialMediaUrlFromHtml(html),
      mediaUrls: [progressiveVideoUrl, playurlAudioUrl].filter(Boolean),
      source: "audio",
      markdown,
      binding,
      title,
      sourceTitle,
      socialMetrics: bilibiliSocialMetrics
    });
  }
  async fetchWechatChannelsFeedInfo(url) {
    const payload = extractWechatChannelsRequestPayload(url);
    if (!payload.shortUri && !payload.exportId) {
      throw new Error("无法识别视频号链接 ID");
    }
    const response = await requestUrl({
      url: WECHAT_CHANNELS_FEED_INFO_URL,
      method: "POST",
      headers: {
        ...getSocialRequestHeaders(url),
        "Content-Type": "application/json; charset=utf-8",
        Accept: "application/json, text/plain, */*",
        Origin: "https://channels.weixin.qq.com",
        Referer: "https://channels.weixin.qq.com/"
      },
      body: JSON.stringify({
        baseReq: { generalToken: "" },
        ...payload
      }),
      throw: false
    });
    if (response.status && (response.status < 200 || response.status >= 300)) {
      throw new Error(`视频号文案接口请求失败：HTTP ${response.status}`);
    }
    const body = response.json || tryParseJson(response.text || "") || {};
    if (Number(body.errCode || 0) !== 0) {
      throw new Error(body.errMsg || "视频号文案接口返回失败");
    }
    return normalizeWechatChannelsFeedPayload(body);
  }
  async hydrateWechatChannelsTranscript(record, url, binding = null, title = "") {
    const metadata = record.metadata || {};
    const feed = await this.fetchWechatChannelsFeedInfo(url);
    let mediaUrl = feed.videoUrl || "";
    let mediaUrls = Array.isArray(feed.mediaUrls) ? feed.mediaUrls : [];
    const mediaItems = Array.isArray(feed.mediaItems) ? feed.mediaItems : [];
    let mediaSource = mediaUrl ? "wechat-channels-feed" : "video";
    if (typeof this.renderSocialMediaUrls === "function") {
      try {
        const renderedUrls = await this.renderSocialMediaUrls(buildWechatChannelsPreviewUrl(url));
        mediaUrls = sortMediaUrlsForTranscription([mediaUrl, ...mediaUrls, ...renderedUrls]);
        mediaUrl = mediaUrls[0] || "";
        if (renderedUrls && renderedUrls.length) {
          mediaSource = mediaSource === "wechat-channels-feed" ? "wechat-channels-feed-rendered" : "video-rendered";
        }
      } catch (error) {
        mediaUrls = sortMediaUrlsForTranscription([mediaUrl, ...mediaUrls]);
        mediaUrl = mediaUrls[0] || "";
      }
    }
    mediaUrls = sortMediaUrlsForTranscription([mediaUrl, ...mediaUrls]);
    mediaUrl = mediaUrls[0] || "";
    if (mediaUrl) {
      const transcribedRecord = await this.buildTranscriptRecordFromMedia(record, {
        url,
        platform: "视频号",
        mediaUrl,
        mediaUrls,
        mediaItems,
        source: mediaSource,
        binding,
        title,
        noMediaError: "视频号网页端未返回可转写的视频资源"
      });
      const nextMetadata = transcribedRecord.metadata || {};
      const transcriptProperties = nextMetadata.transcriptionStatus === "success" ? buildTranscriptPropertyMetadata({
        transcription: nextMetadata.transcription,
        title: metadata.title || nextMetadata.title || "视频号口播文案"
      }) : { description: "", keywords: [], aiMetadataSource: "" };
      return {
        ...transcribedRecord,
        metadata: {
          ...nextMetadata,
          title: metadata.title || nextMetadata.title || "视频号口播文案",
          author: metadata.author || feed.author || nextMetadata.author || "",
          platform: metadata.platform || "视频号",
          contentCategory: metadata.contentCategory || "视频",
          coverUrl: feed.coverUrl || metadata.coverUrl || nextMetadata.coverUrl || "",
          dynamicExportId: feed.dynamicExportId || metadata.dynamicExportId || nextMetadata.dynamicExportId || "",
          wechatChannelsDecodeKey: feed.decodeKey || nextMetadata.wechatChannelsDecodeKey || "",
          wechatChannelsEncryptedMedia: Boolean(feed.decodeKey) || Boolean(nextMetadata.wechatChannelsEncryptedMedia),
          description: nextMetadata.description || transcriptProperties.description,
          keywords: getRecordKeywords(nextMetadata).length ? getRecordKeywords(nextMetadata) : transcriptProperties.keywords,
          aiMetadataSource: nextMetadata.aiMetadataSource || transcriptProperties.aiMetadataSource
        }
      };
    }
    return {
      ...record,
      metadata: {
        ...buildTranscriptOnlyMetadata(metadata, {
          url,
          platform: "视频号",
          transcription: "",
          transcriptionStatus: "failed",
          transcriptionSource: "wechat-channels-preview",
          transcriptionError: feed.errMsg || "视频号网页端未返回可转写的视频资源，无法提取视频口播文案",
          conversionStatus: "link_saved"
        }),
        markdown: buildWechatChannelsUnavailableMarkdown(
          url,
          feed,
          feed.errMsg || "视频号网页端未返回可转写的视频资源，无法提取视频口播文案"
        ),
        conversionStatus: "link_saved",
        title: metadata.title || feed.title || "视频号口播文案",
        author: metadata.author || feed.author || "",
        platform: metadata.platform || "视频号",
        contentCategory: metadata.contentCategory || "视频",
        coverUrl: feed.coverUrl || metadata.coverUrl || "",
        dynamicExportId: feed.dynamicExportId || metadata.dynamicExportId || "",
        wechatChannelsDecodeKey: feed.decodeKey || metadata.wechatChannelsDecodeKey || "",
        wechatChannelsEncryptedMedia: Boolean(feed.decodeKey) || Boolean(metadata.wechatChannelsEncryptedMedia)
      }
    };
  }
  async hydrateWebpageMarkdown(record, rootDir, dateFolder, title, binding = null, options = {}) {
    const signal = options.signal || null;
    throwIfAborted(signal);
    const metadata = record.metadata || {};
    const url = metadata.url || record.content;
    let xiaohongshuRedirectDiagnostic = null;
    let xiaohongshuResolvedUrl = url || "";
    let xiaohongshuResponseStatus = 0;
    let webpageTransportDiagnostic = null;
    let douyinResolutionStages = [];
    let douyinResolutionDiagnostic = null;
    if (!url) {
      return record;
    }
    const isFeishuLink = isFeishuUrl(url);
    const feishuCloudOAuthStatus = isFeishuLink ? await this.getFeishuCloudOAuthStatus(binding) : null;
    if (!(feishuCloudOAuthStatus == null ? void 0 : feishuCloudOAuthStatus.connected) && (metadata.markdown || metadata.snapshot || metadata.contentSnapshot) && !shouldRefreshFeishuMarkdownFromSource(url, metadata)) {
      return record;
    }
    try {
      if (isFeishuLink) {
        let openApiError = null;
        const shouldUseFeishuCloudOAuth = feishuCloudOAuthStatus && feishuCloudOAuthStatus.connected;
        if (shouldUseFeishuCloudOAuth) {
          try {
            const cloudOpenApiResult = await this.fetchFeishuCloudOAuthMarkdownFromUrl(url, binding);
            const feishuTitle = metadata.title || cloudOpenApiResult.title || "飞书文档";
            const imageTokens = Array.from(new Set((cloudOpenApiResult.imageTokens || []).map((item) => String(item || "").trim()).filter(Boolean)));
            const imageDataAssets = [];
            const imageDataErrors = [];
            for (const imageToken of imageTokens) {
              try {
                const downloaded = await this.fetchFeishuCloudMediaDataUrl(imageToken, binding);
                imageDataAssets.push({
                  token: imageToken,
                  // Keep the stable OpenAPI token as the Markdown identity.
                  // Signed URLs may be escaped differently in Markdown, which
                  // used to save the binary without replacing the note link.
                  src: `feishu-image:${imageToken}`,
                  dataUrl: downloaded.dataUrl
                });
              } catch (error) {
                imageDataErrors.push(String(error && (error.message || error) || "unknown error"));
              }
            }
            let cleanedCloudOpenApiMarkdown = cleanMarkdownForStorage(cloudOpenApiResult.markdown, {
              dedupe: true,
              feishuTitle
            });
            const imageTokenCount = Number(cloudOpenApiResult.imageTokenCount) || 0;
            const imageTempUrlCount = Object.values(cloudOpenApiResult.imageTmpDownloadUrls || {}).filter((value) => /^https?:\/\//i.test(String(value || "").trim())).length;
            const missingImageTempUrlCount = Math.max(
              0,
              imageTokenCount - imageTempUrlCount - imageDataAssets.length
            );
            const imageLocalizationErrors2 = [];
            cleanedCloudOpenApiMarkdown = await this.saveWebpageImageAssets(
              cleanedCloudOpenApiMarkdown,
              imageDataAssets,
              rootDir,
              dateFolder,
              feishuTitle,
              {
                sourceUrl: url,
                onError: /* @__PURE__ */ __name(({ error }) => {
                  imageLocalizationErrors2.push(String(error && (error.message || error) || "unknown error"));
                }, "onError")
              }
            );
            cleanedCloudOpenApiMarkdown = replaceFeishuImageTokenPlaceholders(
              cleanedCloudOpenApiMarkdown,
              [],
              url,
              cloudOpenApiResult.imageTmpDownloadUrls || {}
            );
            cleanedCloudOpenApiMarkdown = await this.saveMarkdownRemoteImageAssets(
              cleanedCloudOpenApiMarkdown,
              rootDir,
              dateFolder,
              feishuTitle,
              {
                sourceUrl: url,
                onError: /* @__PURE__ */ __name(({ error }) => {
                  imageLocalizationErrors2.push(String(error && (error.message || error) || "unknown error"));
                }, "onError")
              }
            );
            let feishuImageFallbackNote = "";
            if (imageTokenCount > 0 && (missingImageTempUrlCount > 0 || imageLocalizationErrors2.length > 0)) {
              try {
                const renderedFallback = await this.renderFeishuDocumentWithElectron(url);
                const fallbackStats = {};
                const fallbackMarkdown = await this.saveWebpageImageAssets(
                  cleanMarkdownForStorage(renderedFallback.markdown, {
                    dedupe: true,
                    feishuTitle
                  }),
                  renderedFallback.assets,
                  rootDir,
                  dateFolder,
                  feishuTitle,
                  { sourceUrl: url, stats: fallbackStats }
                );
                if (fallbackStats.localizedCount > 0) {
                  cleanedCloudOpenApiMarkdown = fallbackMarkdown;
                  feishuImageFallbackNote = `browser-image-fallback=${fallbackStats.localizedCount}/${fallbackStats.assetCount || 0}`;
                } else {
                  feishuImageFallbackNote = `browser-image-fallback=0/${fallbackStats.assetCount || 0}`;
                }
              } catch (fallbackError) {
                feishuImageFallbackNote = `browser-image-fallback-failed=${getTransportErrorDiagnostic(fallbackError).message}`;
              }
            }
            return {
              ...record,
              metadata: enrichExtractedWebpageMetadata({
                ...metadata,
                title: feishuTitle,
                markdown: cleanedCloudOpenApiMarkdown,
                conversionStatus: "success",
                conversionSource: "feishu-cloud-oauth",
                imageTempUrlMissingCount: missingImageTempUrlCount,
                imageLocalizationFailedCount: imageDataErrors.length + imageLocalizationErrors2.length,
                imageLocalizationError: [...imageDataErrors, ...imageLocalizationErrors2].slice(0, 3).join(" | "),
                conversionNote: [
                  `feishu-cloud-oauth blocks=${cloudOpenApiResult.blockCount || 0}`,
                  imageTokenCount ? `images=${imageTokenCount}` : "",
                  missingImageTempUrlCount ? `image-temp-url-missing=${missingImageTempUrlCount}` : "",
                  cloudOpenApiResult.imageDownloadError ? `image-download: ${cloudOpenApiResult.imageDownloadError}` : "",
                  imageDataErrors.length + imageLocalizationErrors2.length ? `image-localize-failed=${imageDataErrors.length + imageLocalizationErrors2.length}: ${[...imageDataErrors, ...imageLocalizationErrors2].slice(0, 3).join(" | ")}` : "",
                  feishuImageFallbackNote
                ].filter(Boolean).join("; ")
              })
            };
          } catch (error) {
            openApiError = error;
          }
        }
        try {
          const rendered = await this.renderFeishuDocumentWithElectron(url);
          const feishuTitle = metadata.title || rendered.title || "飞书链接";
          let cleanedRenderedMarkdown = cleanMarkdownForStorage(rendered.markdown, {
            dedupe: true,
            feishuTitle
          });
          cleanedRenderedMarkdown = replaceFeishuImageTokenPlaceholders(cleanedRenderedMarkdown, rendered.assets, url);
          const renderedImageStats = {};
          const markdown2 = await this.saveWebpageImageAssets(
            cleanedRenderedMarkdown,
            rendered.assets,
            rootDir,
            dateFolder,
            title,
            {
              sourceUrl: url,
              stats: renderedImageStats
            }
          );
          const openApiDiag = openApiError ? `

<!-- feishu-openapi-error: ${String(openApiError.message || openApiError).replace(/-->/g, "-- >")} -->` : "";
          const diagComment = rendered.__feishuDiag ? `

<!-- feishu-diag: ${rendered.__feishuDiag} -->` : "";
          return {
            ...record,
            metadata: enrichExtractedWebpageMetadata({
              ...metadata,
              title: feishuTitle,
              markdown: markdown2 + openApiDiag + diagComment,
              conversionStatus: "success",
              imageLocalizationFailedCount: renderedImageStats.failedCount || 0,
              imageLocalizationError: renderedImageStats.failedCount ? `${renderedImageStats.failedCount} image assets could not be localized` : "",
              conversionNote: [
                openApiError ? `feishu-open-api: ${openApiError.message || openApiError}` : "",
                renderedImageStats.assetCount ? `images=${renderedImageStats.assetCount}` : "",
                renderedImageStats.localizedCount ? `images-localized=${renderedImageStats.localizedCount}` : "",
                renderedImageStats.failedCount ? `image-localize-failed=${renderedImageStats.failedCount}` : ""
              ].filter(Boolean).join("; ") || metadata.conversionNote
            })
          };
        } catch (renderError) {
          try {
            const markdown2 = replaceFeishuImageTokenPlaceholders(await fetchFeishuClientVarsMarkdown(url), [], url);
            return {
              ...record,
              metadata: enrichExtractedWebpageMetadata({
                ...metadata,
                title: metadata.title || "飞书链接",
                markdown: markdown2,
                conversionStatus: "success",
                conversionNote: [
                  openApiError ? `feishu-open-api: ${openApiError.message || String(openApiError)}` : "",
                  renderError.message || String(renderError)
                ].filter(Boolean).join("；")
              })
            };
          } catch (clientVarsError) {
            try {
              const response = await requestUrl({ url, method: "GET" });
              const html2 = response.text || "";
              const markdown2 = extractFeishuMarkdownFromHtml(html2);
              return {
                ...record,
                metadata: enrichExtractedWebpageMetadata({
                  ...metadata,
                  title: metadata.title || extractHtmlTitle(html2) || "飞书链接",
                  markdown: markdown2,
                  conversionStatus: "success",
                  conversionNote: [
                    openApiError ? `feishu-open-api: ${openApiError.message || String(openApiError)}` : "",
                    renderError.message || String(renderError),
                    clientVarsError.message || String(clientVarsError)
                  ].filter(Boolean).join("；")
                })
              };
            } catch (staticError) {
              throw new Error([
                openApiError ? `feishu-open-api: ${openApiError.message || String(openApiError)}` : "",
                renderError.message || String(renderError),
                clientVarsError.message || String(clientVarsError),
                staticError.message || String(staticError)
              ].filter(Boolean).join("；"));
            }
          }
        }
      }
      if (isXiaoyuzhouUrl(url)) {
        return await this.hydrateXiaoyuzhouTranscript(record, url, binding, title);
      }
      if (isBilibiliUrl(url)) {
        return await this.hydrateBilibiliTranscript(record, url, binding, title);
      }
      if (isXiaohongshuUrl(url) || isDouyinUrl(url)) {
        throwIfAborted(signal);
        const redirectResult = shouldResolvePlatformRedirect(url) ? await resolveRedirectUrlWithDiagnostics(url) : {
          url,
          diagnostic: {
            attempts: [],
            redirectCount: 0,
            usedGetFallback: false
          }
        };
        throwIfAborted(signal);
        xiaohongshuRedirectDiagnostic = redirectResult.diagnostic;
        const redirectedUrl = redirectResult.url;
        const targetIdentityUrl = isXiaohongshuUrl(url) ? resolveXiaohongshuIdentityUrl([redirectedUrl, url]) : "";
        xiaohongshuResolvedUrl = redirectedUrl;
        const douyinTarget = isDouyinUrl(url) || isDouyinUrl(redirectedUrl) ? normalizeDouyinTargetUrl(url, redirectedUrl) : { awemeId: "", url: "" };
        let resolvedUrl = douyinTarget.url || redirectedUrl;
        let xiaohongshuBrowserCandidates = isXiaohongshuUrl(url) ? getXiaohongshuBrowserCandidates(url, targetIdentityUrl, resolvedUrl) : [];
        let primarySocialMediaBrowserUrl = xiaohongshuBrowserCandidates[0] ? xiaohongshuBrowserCandidates[0].url : resolvedUrl;
        let douyinAwemeId = douyinTarget.awemeId;
        if (shouldBlockExternalAppUrl(resolvedUrl)) {
          throw new Error(`已阻止网页尝试打开外部应用协议：${new URL(resolvedUrl).protocol}`);
        }
        if (isXiaohongshuUrl(url) && !isXiaohongshuUrl(resolvedUrl)) {
          const externalRedirectError = new Error("小红书短链接跳转到了非官方网站，已停止请求");
          externalRedirectError.code = "XIAOHONGSHU_CONTENT_UNAVAILABLE";
          throw externalRedirectError;
        }
        const headers = getSocialRequestHeaders(resolvedUrl);
        let renderedXiaohongshuPage = null;
        let renderedXiaohongshuUrl = "";
        let renderedXiaohongshuIncludesComments = false;
        let renderedXiaohongshuError = null;
        const xiaohongshuBrowserAttempts = [];
        let response;
        try {
          response = isXiaohongshuUrl(url) ? await this.requestXiaohongshuStaticPage(resolvedUrl) : metadata.automaticWebpageExtraction ? await requestPublicWebpageText(resolvedUrl, { headers }) : await requestUrl({ url: resolvedUrl, method: "GET", headers });
        } catch (requestError) {
          if (!isXiaohongshuUrl(url)) throw requestError;
          for (const candidate of xiaohongshuBrowserCandidates) {
            throwIfAborted(signal);
            try {
              const candidatePage = await this.renderXiaohongshuPage(candidate.url, {
                includeComments: false,
                expectedUrl: targetIdentityUrl || resolvedUrl,
                signal
              });
              const candidateFinalUrl = String(candidatePage && candidatePage.url || "").trim();
              if (!isTrustedXiaohongshuCookieUrl(candidateFinalUrl)) {
                throw new Error("隐藏浏览器最终页面不是可信的小红书 HTTPS 内容页");
              }
              renderedXiaohongshuPage = candidatePage;
              renderedXiaohongshuUrl = candidate.url;
              renderedXiaohongshuIncludesComments = false;
              response = {
                status: 200,
                text: String(candidatePage && candidatePage.html || ""),
                url: candidateFinalUrl
              };
              break;
            } catch (renderError) {
              if (isAbortError(renderError)) throw renderError;
              renderedXiaohongshuError = renderError;
            }
          }
          if (!response) throw renderedXiaohongshuError || requestError;
        }
        if (isXiaohongshuUrl(url)) {
          const responseFinalUrl = String(response && response.url || "").trim();
          if (!isTrustedXiaohongshuCookieUrl(responseFinalUrl)) {
            throw new Error("小红书正文响应的最终地址无法确认为官方 HTTPS 内容页");
          }
          resolvedUrl = responseFinalUrl;
          xiaohongshuResolvedUrl = responseFinalUrl;
          xiaohongshuBrowserCandidates = getXiaohongshuBrowserCandidates(
            url,
            targetIdentityUrl,
            responseFinalUrl
          );
          primarySocialMediaBrowserUrl = xiaohongshuBrowserCandidates[0] ? xiaohongshuBrowserCandidates[0].url : resolvedUrl;
        }
        xiaohongshuResponseStatus = Number(response.status) || 0;
        let html2 = response.text || "";
        let socialMediaSupplementalMarkdown = buildSocialMediaSupplementalMarkdownFromHtml(html2, resolvedUrl);
        const hasProAdvancedAccess = isXiaohongshuUrl(url) ? await this.hasProFeatureAccess() : false;
        let xiaohongshuLoggedIn = false;
        if (isXiaohongshuUrl(url) && hasProAdvancedAccess && this.settings.xiaohongshuCommentsEnabled !== false) {
          try {
            xiaohongshuLoggedIn = await this.checkXiaohongshuLogin({ signal });
          } catch (error) {
            if (isAbortError(error)) throw error;
            xiaohongshuLoggedIn = false;
          }
        }
        const xiaohongshuCapabilities = getXiaohongshuCapabilityMatrix({
          hasProAccess: hasProAdvancedAccess,
          commentsEnabled: this.settings.xiaohongshuCommentsEnabled !== false,
          imageOcrEnabled: this.settings.xiaohongshuImageOcrEnabled === true,
          isLoggedIn: xiaohongshuLoggedIn
        });
        let mediaUrls = isXiaohongshuUrl(url) || Boolean(douyinAwemeId) ? [] : extractSocialMediaUrlsFromHtml(html2);
        let mediaUrl = mediaUrls[0] || "";
        let hasPreciseDouyinMedia = false;
        let douyinSocialMetrics = {};
        let douyinStructuredContent = null;
        if (isDouyinUrl(url) || isDouyinUrl(resolvedUrl)) {
          douyinAwemeId = douyinAwemeId || extractDouyinAwemeId(resolvedUrl) || extractDouyinAwemeId(url);
          for (const shareUrl of getDouyinMobileSharePageUrls(douyinAwemeId)) {
            const shareStage = { stage: "mobile-share", ok: false, mediaCount: 0, detailFound: false };
            try {
              const shareResponse = await requestUrl({
                url: shareUrl,
                method: "GET",
                headers: getDouyinMobileShareRequestHeaders(shareUrl)
              });
              const shareHtml = shareResponse.text || "";
              const shareUrls = extractDouyinMediaUrlsFromShareHtml(shareHtml, douyinAwemeId);
              const shareDetail = extractDouyinDetailFromShareHtml(shareHtml, douyinAwemeId);
              shareStage.mediaCount = shareUrls.length;
              shareStage.detailFound = Boolean(shareDetail);
              if (shareDetail) {
                const sharePageMetadata = extractWebpageMetadataFromHtml(shareHtml, resolvedUrl);
                douyinStructuredContent = buildDouyinStructuredContent(shareDetail, {
                  title: douyinStructuredContent && douyinStructuredContent.title || sharePageMetadata.title,
                  description: douyinStructuredContent && douyinStructuredContent.description || sharePageMetadata.description,
                  tags: douyinStructuredContent && douyinStructuredContent.tags && douyinStructuredContent.tags.length ? douyinStructuredContent.tags : extractTagsFromText(sharePageMetadata.description, shareHtml),
                  coverUrl: douyinStructuredContent && douyinStructuredContent.coverUrl || normalizeExtractedUrl(extractMetaContent(shareHtml, ["og:image", "twitter:image"])),
                  socialMetrics: douyinStructuredContent && douyinStructuredContent.socialMetrics || douyinSocialMetrics
                });
                socialMediaSupplementalMarkdown = buildSocialMediaSupplementalMarkdown({
                  title: douyinStructuredContent.title,
                  description: douyinStructuredContent.description,
                  tags: douyinStructuredContent.tags,
                  imageUrls: [douyinStructuredContent.coverUrl].filter(Boolean)
                });
                if (hasSocialMetrics(douyinStructuredContent.socialMetrics)) {
                  douyinSocialMetrics = douyinStructuredContent.socialMetrics;
                }
              }
              if (shareUrls.length) {
                html2 = shareHtml;
                const structuredShareMetrics = buildSocialMetrics(shareDetail);
                const shareMetrics = hasSocialMetrics(structuredShareMetrics) ? structuredShareMetrics : extractSocialMetricsFromHtml(shareHtml);
                if (hasSocialMetrics(shareMetrics)) douyinSocialMetrics = shareMetrics;
                mediaUrls = sortMediaUrlsForTranscription([...shareUrls, ...mediaUrls]);
                mediaUrl = mediaUrls[0] || mediaUrl;
                hasPreciseDouyinMedia = true;
                shareStage.ok = true;
                break;
              }
            } catch (shareError) {
              shareStage.error = shareError;
            } finally {
              douyinResolutionStages.push(shareStage);
            }
          }
          if (!hasPreciseDouyinMedia || !hasSocialMetrics(douyinSocialMetrics) || !douyinStructuredContent) {
            for (const detailUrl of getDouyinAwemeDetailUrls(douyinAwemeId)) {
              const detailStage = { stage: "aweme-detail", ok: false, mediaCount: 0, detailFound: false };
              try {
                const detailResponse = await requestUrl({ url: detailUrl, method: "GET", headers: getSocialRequestHeaders(detailUrl) });
                const detailPayload = detailResponse.json || JSON.parse(detailResponse.text || "{}");
                if (getDouyinDetailAwemeId(detailPayload) !== douyinAwemeId) continue;
                const detail = detailPayload.aweme_detail || detailPayload.awemeDetail || (Array.isArray(detailPayload.item_list) ? detailPayload.item_list[0] : null);
                detailStage.detailFound = Boolean(detail);
                const detailPageMetadata = extractWebpageMetadataFromHtml(html2, resolvedUrl);
                douyinStructuredContent = buildDouyinStructuredContent(detail, {
                  title: douyinStructuredContent && douyinStructuredContent.title || detailPageMetadata.title,
                  description: douyinStructuredContent && douyinStructuredContent.description || detailPageMetadata.description,
                  tags: douyinStructuredContent && douyinStructuredContent.tags && douyinStructuredContent.tags.length ? douyinStructuredContent.tags : extractTagsFromText(detailPageMetadata.description, html2),
                  coverUrl: douyinStructuredContent && douyinStructuredContent.coverUrl || normalizeExtractedUrl(extractMetaContent(html2, ["og:image", "twitter:image"])),
                  socialMetrics: douyinStructuredContent && douyinStructuredContent.socialMetrics || douyinSocialMetrics
                });
                socialMediaSupplementalMarkdown = buildSocialMediaSupplementalMarkdown({
                  title: douyinStructuredContent.title,
                  description: douyinStructuredContent.description,
                  tags: douyinStructuredContent.tags,
                  imageUrls: [douyinStructuredContent.coverUrl].filter(Boolean)
                });
                if (hasSocialMetrics(douyinStructuredContent.socialMetrics)) {
                  douyinSocialMetrics = douyinStructuredContent.socialMetrics;
                }
                const detailUrls = extractDouyinMediaUrlsFromDetailPayload(detailPayload);
                detailStage.mediaCount = detailUrls.length;
                if (detailUrls.length) {
                  mediaUrls = sortMediaUrlsForTranscription([...detailUrls, ...mediaUrls]);
                  mediaUrl = mediaUrls[0] || mediaUrl;
                  hasPreciseDouyinMedia = true;
                  detailStage.ok = true;
                  break;
                }
              } catch (detailError) {
                detailStage.error = detailError;
              } finally {
                douyinResolutionStages.push(detailStage);
              }
            }
          }
          if (douyinAwemeId && (!hasPreciseDouyinMedia || !douyinStructuredContent || !hasSocialMetrics(douyinSocialMetrics))) {
            const sessionStage = { stage: "authenticated-session", ok: false, mediaCount: 0, detailFound: false };
            try {
              const hasLegacyInstanceResolver = Object.prototype.hasOwnProperty.call(this, "fetchDouyinMediaUrlsWithSession") && !Object.prototype.hasOwnProperty.call(this, "fetchDouyinMediaResolutionWithSession");
              const sessionResolution = !hasLegacyInstanceResolver && typeof this.fetchDouyinMediaResolutionWithSession === "function" ? await this.fetchDouyinMediaResolutionWithSession(resolvedUrl, douyinAwemeId) : {
                mediaUrls: typeof this.fetchDouyinMediaUrlsWithSession === "function" ? await this.fetchDouyinMediaUrlsWithSession(resolvedUrl, douyinAwemeId) : [],
                detail: null
              };
              const sessionUrls = Array.isArray(sessionResolution && sessionResolution.mediaUrls) ? sessionResolution.mediaUrls : [];
              const sessionDetail = sessionResolution && sessionResolution.detail;
              sessionStage.mediaCount = sessionUrls.length;
              sessionStage.detailFound = Boolean(sessionDetail);
              if (sessionDetail) {
                const detailPageMetadata = extractWebpageMetadataFromHtml(html2, resolvedUrl);
                douyinStructuredContent = buildDouyinStructuredContent(sessionDetail, {
                  title: douyinStructuredContent && douyinStructuredContent.title || detailPageMetadata.title,
                  description: douyinStructuredContent && douyinStructuredContent.description || detailPageMetadata.description,
                  tags: douyinStructuredContent && douyinStructuredContent.tags && douyinStructuredContent.tags.length ? douyinStructuredContent.tags : extractTagsFromText(detailPageMetadata.description, html2),
                  coverUrl: douyinStructuredContent && douyinStructuredContent.coverUrl || normalizeExtractedUrl(extractMetaContent(html2, ["og:image", "twitter:image"])),
                  socialMetrics: douyinStructuredContent && douyinStructuredContent.socialMetrics || douyinSocialMetrics
                });
                socialMediaSupplementalMarkdown = buildSocialMediaSupplementalMarkdown({
                  title: douyinStructuredContent.title,
                  description: douyinStructuredContent.description,
                  tags: douyinStructuredContent.tags,
                  imageUrls: [douyinStructuredContent.coverUrl].filter(Boolean)
                });
                if (hasSocialMetrics(douyinStructuredContent.socialMetrics)) {
                  douyinSocialMetrics = douyinStructuredContent.socialMetrics;
                }
              }
              if (sessionUrls.length) {
                mediaUrls = sortMediaUrlsForTranscription([...sessionUrls, ...mediaUrls]);
                mediaUrl = mediaUrls[0] || mediaUrl;
                hasPreciseDouyinMedia = true;
                sessionStage.ok = true;
              }
            } catch (sessionError) {
              sessionStage.error = sessionError;
            } finally {
              douyinResolutionStages.push(sessionStage);
            }
          }
          if (!hasPreciseDouyinMedia && douyinAwemeId && typeof this.renderSocialMediaUrls === "function") {
            const browserStage = { stage: "targeted-browser", ok: false, mediaCount: 0, detailFound: false };
            try {
              const browserUrls = await this.renderSocialMediaUrls(resolvedUrl, {
                signal,
                strictDouyinTarget: true
              });
              browserStage.mediaCount = Array.isArray(browserUrls) ? browserUrls.length : 0;
              if (browserStage.mediaCount) {
                mediaUrls = sortMediaUrlsForTranscription([...browserUrls, ...mediaUrls]);
                mediaUrl = mediaUrls[0] || mediaUrl;
                hasPreciseDouyinMedia = true;
                browserStage.ok = true;
              }
            } catch (browserError) {
              if (isAbortError(browserError)) throw browserError;
              browserStage.error = browserError;
            } finally {
              douyinResolutionStages.push(browserStage);
            }
          }
        }
        if (isDouyinUrl(url) || isDouyinUrl(resolvedUrl)) {
          douyinResolutionDiagnostic = buildDouyinMediaResolutionDiagnostic({
            sourceUrl: url,
            resolvedUrl,
            awemeId: douyinAwemeId,
            stages: douyinResolutionStages,
            mediaCandidateCount: mediaUrls.length,
            preciseMediaFound: hasPreciseDouyinMedia,
            saveOriginalMediaEnabled: this.settings.saveOriginalMediaEnabled === true
          });
        }
        const isUnavailableXhs = isXiaohongshuUrl(url) && isUnavailableXiaohongshuPage(html2, resolvedUrl);
        let isVideoIntent = metadata.webpageMediaType === "audio_video" || isDouyinUrl(url) || isDouyinUrl(resolvedUrl) || /[?&]type=video\b/i.test(resolvedUrl) || /\/video\//i.test(resolvedUrl);
        const shouldIncludeXiaohongshuComments = xiaohongshuCapabilities.comments;
        let extractedXiaohongshu = null;
        let pendingXiaohongshuFailureDiagnostic = null;
        if (isXiaohongshuUrl(url)) {
          if (!isTrustedXiaohongshuCookieUrl(resolvedUrl)) {
            mediaUrls = [];
            mediaUrl = "";
            html2 = "";
          }
          let xiaohongshuIdentityUrl = resolveXiaohongshuIdentityUrl([
            targetIdentityUrl,
            resolvedUrl,
            url
          ], html2);
          const staticXiaohongshuComments = [];
          extractedXiaohongshu = extractXiaohongshuMarkdownFromHtml(html2, xiaohongshuIdentityUrl, metadata.shareText || record.content || "", {
            includeComments: false
          });
          isVideoIntent = isVideoIntent || extractedXiaohongshu.isVideoNote === true;
          if (extractedXiaohongshu.xiaohongshuPrimaryNoteMatched === true) {
            mediaUrls = extractedXiaohongshu.videoUrl ? [extractedXiaohongshu.videoUrl] : [];
            mediaUrl = mediaUrls[0] || "";
          }
          const shouldEnrichXiaohongshuGraphicImages = !extractedXiaohongshu.videoUrl && !mediaUrl;
          let bestRenderedXiaohongshuPage = null;
          let bestRenderedXiaohongshuExtraction = null;
          let bestRenderedXiaohongshuHtml = "";
          let bestRenderedXiaohongshuUrl = "";
          let bestRenderedXiaohongshuScore = -1;
          const mergeableXiaohongshuExtractions = [];
          if (scoreXiaohongshuExtraction(extractedXiaohongshu, html2, resolvedUrl) >= 0) {
            mergeableXiaohongshuExtractions.push(extractedXiaohongshu);
          }
          if (shouldEnrichXiaohongshuGraphicImages || shouldIncludeXiaohongshuComments) {
            for (const candidate of xiaohongshuBrowserCandidates) {
              throwIfAborted(signal);
              let candidatePage = null;
              try {
                candidatePage = renderedXiaohongshuPage && renderedXiaohongshuUrl === candidate.url && renderedXiaohongshuIncludesComments === false ? renderedXiaohongshuPage : await this.renderXiaohongshuPage(candidate.url, {
                  includeComments: false,
                  expectedUrl: xiaohongshuIdentityUrl,
                  signal
                });
                const candidateHtml = String(candidatePage && candidatePage.html || "");
                const candidateFinalUrl = String(candidatePage && candidatePage.url || resolvedUrl);
                if (!isTrustedXiaohongshuCookieUrl(candidateFinalUrl)) {
                  throw new Error("隐藏浏览器最终页面不是可信的小红书 HTTPS 内容页");
                }
                const candidateIdentityUrl = resolveXiaohongshuIdentityUrl([
                  xiaohongshuIdentityUrl,
                  candidatePage && candidatePage.identityUrl,
                  candidateFinalUrl,
                  candidate.url
                ], candidateHtml);
                const candidateExtraction = extractXiaohongshuMarkdownFromHtml(
                  candidateHtml,
                  candidateIdentityUrl,
                  metadata.shareText || record.content || "",
                  { includeComments: false }
                );
                xiaohongshuBrowserAttempts.push(buildXiaohongshuBrowserAttemptDiagnostic(
                  candidate,
                  candidatePage,
                  candidateExtraction
                ));
                const candidateScore = scoreXiaohongshuExtraction(
                  candidateExtraction,
                  candidateHtml,
                  candidateIdentityUrl
                );
                if (candidateScore >= 0) {
                  mergeableXiaohongshuExtractions.push(candidateExtraction);
                }
                const candidateHasExactIdentity = candidateExtraction.xiaohongshuPrimaryNoteMatched === true;
                const bestHasExactIdentity = bestRenderedXiaohongshuExtraction && bestRenderedXiaohongshuExtraction.xiaohongshuPrimaryNoteMatched === true;
                const shouldSelectCandidate = bestRenderedXiaohongshuScore < 0 || candidateHasExactIdentity && !bestHasExactIdentity || candidateHasExactIdentity && bestHasExactIdentity && candidateScore > bestRenderedXiaohongshuScore;
                if (shouldSelectCandidate) {
                  bestRenderedXiaohongshuPage = candidatePage;
                  bestRenderedXiaohongshuExtraction = candidateExtraction;
                  bestRenderedXiaohongshuHtml = candidateHtml;
                  bestRenderedXiaohongshuUrl = candidateIdentityUrl;
                  bestRenderedXiaohongshuScore = candidateScore;
                }
              } catch (error) {
                if (isAbortError(error)) throw error;
                renderedXiaohongshuError = error;
                xiaohongshuBrowserAttempts.push(buildXiaohongshuBrowserAttemptDiagnostic(
                  candidate,
                  candidatePage,
                  null,
                  error
                ));
              }
            }
          }
          if (bestRenderedXiaohongshuPage) {
            renderedXiaohongshuPage = bestRenderedXiaohongshuPage;
            renderedXiaohongshuIncludesComments = false;
          }
          if (bestRenderedXiaohongshuExtraction && bestRenderedXiaohongshuScore >= 0) {
            extractedXiaohongshu = mergeXiaohongshuExtractions(
              mergeableXiaohongshuExtractions,
              bestRenderedXiaohongshuExtraction
            );
            isVideoIntent = isVideoIntent || extractedXiaohongshu.isVideoNote === true;
            html2 = bestRenderedXiaohongshuHtml;
            xiaohongshuIdentityUrl = bestRenderedXiaohongshuUrl || xiaohongshuIdentityUrl;
            mediaUrls = extractedXiaohongshu.xiaohongshuPrimaryNoteMatched === true ? extractedXiaohongshu.videoUrl ? [extractedXiaohongshu.videoUrl] : [] : mediaUrls;
            mediaUrl = extractedXiaohongshu.xiaohongshuPrimaryNoteMatched === true ? mediaUrls[0] || "" : mediaUrls[0] || mediaUrl;
          }
          const shouldProbeConfirmedXiaohongshuVideo = extractedXiaohongshu.xiaohongshuPrimaryNoteMatched === true && extractedXiaohongshu.isVideoNote === true;
          if (!mediaUrl && (shouldProbeConfirmedXiaohongshuVideo || shouldProbeXiaohongshuMediaFromGenericLanding(extractedXiaohongshu, html2, resolvedUrl))) {
            for (const candidate of xiaohongshuBrowserCandidates) {
              throwIfAborted(signal);
              try {
                mediaUrls = sortMediaUrlsForTranscription([
                  ...mediaUrls,
                  ...await this.renderSocialMediaUrls(candidate.url, { includeComments: false, signal })
                ]);
                mediaUrl = mediaUrls[0] || "";
                if (mediaUrl) break;
              } catch (renderError) {
                if (isAbortError(renderError)) throw renderError;
              }
            }
          }
          if (shouldIncludeXiaohongshuComments) {
            try {
              const commentsRenderUrl = bestRenderedXiaohongshuUrl || String(bestRenderedXiaohongshuPage && bestRenderedXiaohongshuPage.url || "") || resolvedUrl || url;
              const commentsPage = await this.renderXiaohongshuPage(commentsRenderUrl, {
                includeComments: true,
                expectedUrl: xiaohongshuIdentityUrl,
                signal
              });
              const renderedXiaohongshuComments = commentsPage && Array.isArray(commentsPage.comments) ? commentsPage.comments : [];
              const renderedDiagnosticDetails = commentsPage && commentsPage.commentDiagnosticDetails && typeof commentsPage.commentDiagnosticDetails === "object" ? commentsPage.commentDiagnosticDetails : {};
              const finalizedXiaohongshuComments = finalizeXiaohongshuComments({
                baseMarkdown: extractedXiaohongshu.markdown,
                renderedComments: renderedXiaohongshuComments,
                staticComments: staticXiaohongshuComments,
                diagnosticDetails: renderedDiagnosticDetails,
                limit: XIAOHONGSHU_ROOT_COMMENT_LIMIT
              });
              extractedXiaohongshu = {
                ...extractedXiaohongshu,
                comments: finalizedXiaohongshuComments.comments,
                markdown: finalizedXiaohongshuComments.markdown
              };
            } catch (xiaohongshuRenderError) {
              if (isAbortError(xiaohongshuRenderError)) throw xiaohongshuRenderError;
              if (staticXiaohongshuComments.length) {
                const fallbackXiaohongshuComments = finalizeXiaohongshuComments({
                  baseMarkdown: extractedXiaohongshu.markdown,
                  renderedComments: [],
                  staticComments: staticXiaohongshuComments,
                  limit: XIAOHONGSHU_ROOT_COMMENT_LIMIT
                });
                extractedXiaohongshu = {
                  ...extractedXiaohongshu,
                  comments: fallbackXiaohongshuComments.comments,
                  markdown: fallbackXiaohongshuComments.markdown
                };
              }
            }
          } else if (staticXiaohongshuComments.length) {
            extractedXiaohongshu = {
              ...extractedXiaohongshu,
              comments: staticXiaohongshuComments,
              markdown: appendSocialCommentsToMarkdown(extractedXiaohongshu.markdown, staticXiaohongshuComments)
            };
          }
          const hasReadableXiaohongshuGraphic = hasReadableXiaohongshuGraphicContent(
            extractedXiaohongshu,
            html2,
            xiaohongshuIdentityUrl
          );
          if (!hasReadableXiaohongshuGraphic && !extractedXiaohongshu.videoUrl && !mediaUrl) {
            pendingXiaohongshuFailureDiagnostic = buildXiaohongshuFailureDiagnostic({
              manifestVersion: this.manifest && this.manifest.version,
              sourceUrl: url,
              resolvedUrl,
              responseStatus: response.status,
              html: html2,
              extracted: extractedXiaohongshu,
              renderError: renderedXiaohongshuError,
              redirectDiagnostic: redirectResult.diagnostic,
              browserAttempts: xiaohongshuBrowserAttempts
            });
            if (!isVideoIntent) {
              throw createRetryableXiaohongshuContentError(pendingXiaohongshuFailureDiagnostic);
            }
          }
          const isXiaohongshuVideoNote = Boolean(extractedXiaohongshu.videoUrl || mediaUrl);
          if (xiaohongshuCapabilities.imageOcr && !isVideoIntent && !isXiaohongshuVideoNote) {
            extractedXiaohongshu = await this.enrichXiaohongshuExtractionWithOcr(extractedXiaohongshu, {
              pageUrl: resolvedUrl,
              binding
            });
          }
          if (hasReadableXiaohongshuGraphic && extractedXiaohongshu.isVideoNote !== true && (!isVideoIntent || !shouldProbeXiaohongshuMediaFromGenericLanding(
            extractedXiaohongshu,
            html2,
            resolvedUrl
          )) && !extractedXiaohongshu.videoUrl && !mediaUrl) {
            extractedXiaohongshu = {
              ...extractedXiaohongshu,
              markdown: await this.saveMarkdownRemoteImageAssets(
                extractedXiaohongshu.markdown,
                rootDir,
                dateFolder,
                extractedXiaohongshu.title || title || "小红书图文",
                { sourceUrl: xiaohongshuIdentityUrl }
              )
            };
            return {
              ...record,
              metadata: {
                ...metadata,
                title: getPreferredXiaohongshuTitle(
                  metadata.title,
                  extractedXiaohongshu.title,
                  getWebpageSourcePrefix(url)
                ),
                author: metadata.author || extractedXiaohongshu.author || "",
                extractedDescription: metadata.extractedDescription || extractedXiaohongshu.description || "",
                extractedKeywords: metadata.extractedKeywords || extractedXiaohongshu.tags || [],
                platform: metadata.platform || "小红书",
                contentCategory: "图文",
                markdown: extractedXiaohongshu.markdown,
                imageUrls: extractedXiaohongshu.imageUrls || [],
                xiaohongshuOcrTextHeavy: Boolean(extractedXiaohongshu.ocrTextHeavy),
                xiaohongshuOcrError: extractedXiaohongshu.ocrError || "",
                socialMetrics: withCapturedSocialMetrics(
                  extractedXiaohongshu.socialMetrics,
                  (/* @__PURE__ */ new Date()).toISOString()
                ),
                videoUrl: "",
                conversionStatus: "success"
              }
            };
          }
        }
        const socialMediaRenderOptions = isXiaohongshuUrl(url) ? { includeComments: false, signal } : { signal };
        const allowGenericSocialMediaRender = !(douyinAwemeId && (isDouyinUrl(url) || isDouyinUrl(resolvedUrl)));
        if (!hasPreciseDouyinMedia && allowGenericSocialMediaRender && isVideoIntent && typeof this.renderSocialMediaUrls === "function") {
          try {
            mediaUrls = sortMediaUrlsForTranscription([
              ...mediaUrls,
              ...await this.renderSocialMediaUrls(primarySocialMediaBrowserUrl, socialMediaRenderOptions)
            ]);
            mediaUrl = mediaUrls[0] || mediaUrl;
          } catch (renderError) {
            if (isAbortError(renderError)) throw renderError;
            mediaUrl = mediaUrl || "";
          }
        } else if (!hasPreciseDouyinMedia && allowGenericSocialMediaRender && !mediaUrl && isVideoIntent && typeof this.renderSocialMediaUrl === "function") {
          try {
            mediaUrl = await this.renderSocialMediaUrl(primarySocialMediaBrowserUrl, socialMediaRenderOptions);
            mediaUrls = sortMediaUrlsForTranscription([...mediaUrls, mediaUrl]);
          } catch (renderError) {
            if (isAbortError(renderError)) throw renderError;
            mediaUrl = "";
          }
        }
        if (pendingXiaohongshuFailureDiagnostic && !mediaUrl) {
          throw createRetryableXiaohongshuContentError(pendingXiaohongshuFailureDiagnostic);
        }
        if (mediaUrl) {
          if (isXiaohongshuUrl(url) && !xiaohongshuCapabilities.mediaTranscription) {
            return {
              ...record,
              metadata: buildTranscriptOnlyMetadata(metadata, {
                url,
                platform: "小红书",
                mediaUrl,
                mediaUrls,
                transcription: "",
                transcriptionStatus: "failed",
                transcriptionError: "小红书音视频转写需要有效 Pro。请先开通 Pro 并刷新插件权限。",
                transcriptionSource: "pro-required",
                conversionStatus: "failed",
                markdown: ""
              })
            };
          }
          const selectedSupplementalMarkdown = isXiaohongshuUrl(url) && extractedXiaohongshu && String(extractedXiaohongshu.markdown || "").trim() ? extractedXiaohongshu.markdown : socialMediaSupplementalMarkdown;
          const supplementalMarkdownParts = isXiaohongshuUrl(url) ? splitSocialCommentsMarkdown(selectedSupplementalMarkdown) : { markdown: selectedSupplementalMarkdown, trailingMarkdown: "" };
          return await this.buildTranscriptRecordFromMedia(record, {
            url,
            platform: isDouyinUrl(url) || isDouyinUrl(resolvedUrl) ? "抖音" : "小红书",
            mediaUrl,
            mediaUrls,
            source: "video",
            markdown: supplementalMarkdownParts.markdown,
            trailingMarkdown: supplementalMarkdownParts.trailingMarkdown,
            binding,
            title,
            socialMetrics: isXiaohongshuUrl(url) ? extractedXiaohongshu && extractedXiaohongshu.socialMetrics : douyinStructuredContent && hasSocialMetrics(douyinStructuredContent.socialMetrics) ? douyinStructuredContent.socialMetrics : hasSocialMetrics(douyinSocialMetrics) ? douyinSocialMetrics : extractSocialMetricsFromHtml(html2),
            sourceTitle: isXiaohongshuUrl(url) ? getPreferredXiaohongshuTitle(metadata.title, extractedXiaohongshu && extractedXiaohongshu.title, "小红书") : douyinStructuredContent && douyinStructuredContent.title || extractWebpageMetadataFromHtml(html2, resolvedUrl).title,
            noMediaError: isUnavailableXhs ? "小红书网页端未返回可转写的视频资源。这通常是该分享链接在电脑网页端不可访问、笔记失效或需要小红书登录环境。请让用户重新复制小红书链接；如果仍失败，建议从手机相册或文件导入视频。" : "",
            mediaResolutionDiagnostic: douyinResolutionDiagnostic,
            signal
          });
        }
        if (isVideoIntent && (isDouyinUrl(url) || isDouyinUrl(resolvedUrl))) {
          const noMediaError = "未能从抖音作品页获取到与目标作品一致的音频或视频地址";
          return {
            ...record,
            metadata: {
              ...metadata,
              title: metadata.title || extractHtmlTitle(html2) || "抖音链接",
              url,
              markdown: buildDouyinFallbackMarkdown(url, noMediaError),
              platform: "抖音",
              contentCategory: "视频",
              transcriptionStatus: "failed",
              transcriptionError: noMediaError,
              transcriptionSource: "video",
              conversionStatus: "link_saved",
              mediaResolutionDiagnostic: douyinResolutionDiagnostic
            }
          };
        }
        const extracted = extractedXiaohongshu || extractXiaohongshuMarkdownFromHtml(html2, resolvedUrl, metadata.shareText || record.content || "", {
          includeComments: shouldIncludeXiaohongshuComments
        });
        return {
          ...record,
          metadata: {
            ...metadata,
            title: isXiaohongshuUrl(url) ? getPreferredXiaohongshuTitle(metadata.title, extracted.title, getWebpageSourcePrefix(url)) : metadata.title || extracted.title || getWebpageSourcePrefix(url),
            author: metadata.author || extracted.author || "",
            extractedDescription: metadata.extractedDescription || extracted.description || "",
            extractedKeywords: metadata.extractedKeywords || extracted.tags || [],
            platform: metadata.platform || "小红书",
            contentCategory: metadata.contentCategory || (extracted.videoUrl || metadata.webpageMediaType === "audio_video" ? "视频" : "图文"),
            markdown: extracted.markdown,
            imageUrls: extracted.imageUrls || [],
            socialMetrics: withCapturedSocialMetrics(extracted.socialMetrics, (/* @__PURE__ */ new Date()).toISOString()),
            videoUrl: extracted.videoUrl || "",
            conversionStatus: "success"
          }
        };
      }
      if (isWechatArticleUrl(url)) {
        const wechatLoggedIn = await checkWechatLoginStatus();
        if (wechatLoggedIn) {
          try {
            const rendered = await this.renderWebpageWithElectron(url);
            const renderedImageStats = {};
            const markdown2 = await this.saveWebpageImageAssets(
              rendered.markdown,
              rendered.assets,
              rootDir,
              dateFolder,
              title,
              { sourceUrl: url, stats: renderedImageStats }
            );
            return {
              ...record,
              metadata: {
                ...metadata,
                title: metadata.title || rendered.title || "",
                markdown: markdown2,
                conversionStatus: "success",
                imageLocalizationFailedCount: renderedImageStats.failedCount || 0,
                imageLocalizationError: renderedImageStats.failedCount ? `${renderedImageStats.failedCount} image assets could not be localized` : "",
                conversionNote: renderedImageStats.failedCount ? `image-localize-failed=${renderedImageStats.failedCount}` : metadata.conversionNote
              }
            };
          } catch (electronError) {
          }
        }
      }
      let html;
      let usedFallback = false;
      try {
        const response = metadata.automaticWebpageExtraction && !isTrustedAutomaticPlatformUrl(url) ? await requestPublicWebpageText(url) : await requestUrl({ url, method: "GET" });
        html = response.text || "";
      } catch (requestError) {
        try {
          html = await this.downloadWebpageHtmlViaNode(url);
          usedFallback = true;
        } catch (fallbackError) {
          webpageTransportDiagnostic = buildWebpageTransportDiagnostic({
            sourceUrl: url,
            requestError,
            nodeError: fallbackError
          });
          if (isWechatArticleUrl(url)) {
            try {
              return await this.renderWechatArticleFallback(record, url, rootDir, dateFolder, title, requestError, fallbackError);
            } catch (browserError) {
              webpageTransportDiagnostic = buildWebpageTransportDiagnostic({
                sourceUrl: url,
                requestError,
                nodeError: fallbackError,
                browserError
              });
            }
          }
          if (metadata.automaticWebpageExtraction) {
            const automaticError = new Error(`网页抓取失败：${requestError.message || requestError}`);
            automaticError.diagnostic = webpageTransportDiagnostic;
            throw automaticError;
          }
          throw new Error(`网页抓取失败（Obsidian 请求 + Node.js 降级均失败）：${requestError.message || requestError}；降级错误：${fallbackError.message || fallbackError}`);
        }
      }
      if (isWechatArticleUrl(url) && (isWechatCaptchaUrl(url) || isWechatCaptchaHtml(html))) {
        const targetUrl = extractWechatCaptchaTargetUrl(url);
        return {
          ...record,
          metadata: {
            ...metadata,
            title: metadata.title || "公众号文章需要验证",
            url: targetUrl || metadata.url || url,
            originalUrl: metadata.originalUrl || url,
            markdown: buildWechatCaptchaMarkdown(url, html),
            conversionStatus: "wechat_captcha",
            conversionError: "微信返回公众号文章安全验证页",
            conversionNote: usedFallback ? "已通过备用通道抓取" : ""
          }
        };
      }
      let markdown;
      try {
        markdown = htmlToMarkdown(html);
      } catch (convertError) {
        throw new Error(`HTML 转 Markdown 失败：${convertError.message || convertError}`);
      }
      const pageTitle = metadata.title || extractHtmlTitle(html);
      const pageMeta = extractWebpageMetadataFromHtml(html, url);
      const imageLocalizationErrors = [];
      if (isWechatArticleUrl(url)) {
        markdown = await this.saveMarkdownRemoteImageAssets(
          markdown,
          rootDir,
          dateFolder,
          pageTitle || title || "公众号文章",
          {
            sourceUrl: url,
            onError: /* @__PURE__ */ __name(({ error }) => {
              imageLocalizationErrors.push(String(error && (error.message || error) || "unknown error"));
            }, "onError")
          }
        );
      }
      const conversionNote = [
        usedFallback ? "已通过备用通道抓取" : "",
        imageLocalizationErrors.length ? `image-localize-failed=${imageLocalizationErrors.length}: ${imageLocalizationErrors.slice(0, 3).join(" | ")}` : ""
      ].filter(Boolean).join("; ");
      return {
        ...record,
        metadata: {
          ...metadata,
          title: pageTitle || metadata.title || "",
          author: metadata.author || pageMeta.author || "",
          description: metadata.description || pageMeta.description || "",
          keywords: metadata.keywords || pageMeta.keywords || [],
          platform: metadata.platform || pageMeta.platform || "",
          contentCategory: metadata.contentCategory || pageMeta.contentCategory || "",
          markdown,
          conversionStatus: "success",
          conversionNote,
          ...isWechatArticleUrl(url) ? {
            imageLocalizationFailedCount: imageLocalizationErrors.length,
            imageLocalizationError: imageLocalizationErrors.slice(0, 3).join(" | ")
          } : {}
        }
      };
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (isRetryableTranscriptionError(error) || isRetryableXiaohongshuContentError(error)) {
        throw error;
      }
      if (isXiaohongshuUrl(url)) {
        throw createRetryableXiaohongshuContentError(buildXiaohongshuFailureDiagnostic({
          manifestVersion: this.manifest && this.manifest.version,
          sourceUrl: url,
          resolvedUrl: xiaohongshuResolvedUrl || url,
          responseStatus: xiaohongshuResponseStatus,
          requestError: error,
          redirectDiagnostic: xiaohongshuRedirectDiagnostic
        }));
      }
      if (isXiaoyuzhouUrl(url) || isBilibiliUrl(url) || isDouyinUrl(url)) {
        return {
          ...record,
          metadata: buildTranscriptOnlyMetadata(metadata, {
            url,
            platform: getWebpageSourcePrefix(url),
            transcription: "",
            transcriptionStatus: "failed",
            transcriptionError: error.message || String(error),
            transcriptionSource: "platform-fetch",
            conversionStatus: "failed"
          })
        };
      }
      if (isFeishuUrl(url)) {
        return {
          ...record,
          metadata: {
            ...metadata,
            title: metadata.title || "飞书链接",
            markdown: [
              "飞书链接已保存。",
              "",
              `原始链接：${url}`,
              "",
              `> 飞书正文提取失败：${error.message || String(error)}`,
              "> 如果该链接在浏览器能无登录打开，可以后续接入浏览器剪藏助手把页面 DOM 直接转成 Markdown。"
            ].join("\n"),
            conversionStatus: "link_saved",
            conversionError: error.message || String(error),
            ...webpageTransportDiagnostic ? { conversionDiagnostic: webpageTransportDiagnostic } : {}
          }
        };
      }
      return {
        ...record,
        metadata: {
          ...metadata,
          conversionStatus: "failed",
          conversionError: error.message || String(error),
          ...webpageTransportDiagnostic ? { conversionDiagnostic: webpageTransportDiagnostic } : {}
        }
      };
    }
  }
  async nextRecordTitle(dayDir, record, bindingLabel = "") {
    const label = sanitizeNoteTitlePart(bindingLabel, "");
    const baseTitle = buildRecordTitleBase(record);
    return this.nextTitle(dayDir, label ? `${label}-${baseTitle}` : baseTitle);
  }
  async findExistingRecordNotePath(record) {
    const normalizedRecordId = String(getRecordId(record) || "").trim();
    const metadata = record && record.metadata || {};
    const normalizedRecordUrl = normalizeRecordUrlForCompare(getRecordUrl(record || {}, metadata));
    if (!normalizedRecordId && !normalizedRecordUrl || !this.app || !this.app.vault || typeof this.app.vault.getMarkdownFiles !== "function") {
      return "";
    }
    const inboxDir = normalizeVaultPath(this.settings.inboxDir);
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      const filePath = normalizeVaultPath(file && file.path);
      if (!filePath || inboxDir && filePath !== inboxDir && !filePath.startsWith(`${inboxDir}/`)) {
        continue;
      }
      try {
        let markdown = "";
        if (typeof this.app.vault.cachedRead === "function") {
          markdown = await this.app.vault.cachedRead(file);
        } else if (this.app.vault.adapter && typeof this.app.vault.adapter.read === "function") {
          markdown = await this.app.vault.adapter.read(file.path);
        }
        const matchesRecordId = Boolean(normalizedRecordId && hasRecordIdInFrontmatter(markdown, normalizedRecordId));
        const matchesRecordUrl = Boolean(normalizedRecordUrl && hasRecordUrlInFrontmatter(markdown, normalizedRecordUrl));
        if (matchesRecordId || matchesRecordUrl) {
          if (!isExistingLocalNoteDeliverable(record, markdown)) {
            continue;
          }
          if (normalizedRecordUrl && isFeishuUrl(normalizedRecordUrl) && shouldRefreshFeishuMarkdownFromSource(normalizedRecordUrl, { markdown })) {
            continue;
          }
          if (shouldBypassExistingLocalNoteDedupe(record) && !matchesRecordId && matchesRecordUrl) {
            continue;
          }
          return file.path || filePath;
        }
      } catch (error) {
      }
    }
    return "";
  }
  async writeRecord(record, syncedAt, binding = null, shouldPrefixTitle = false, progress = {}) {
    const signal = progress.signal || null;
    throwIfAborted(signal);
    const dateFolder = getDateFolderName(record.createdAt);
    const rootDir = normalizeConfiguredVaultPath(this.settings.inboxDir);
    const noteDir = normalizeVaultPath(this.settings.noteSaveMode === "root" ? rootDir : `${rootDir}/${dateFolder}`);
    const bindingLabel = shouldPrefixTitle && binding ? binding.label : "";
    const progressTitle = buildRecordTitleBase(record);
    this.showSyncProgress({ ...progress, stage: "processing", title: progressTitle });
    await this.ensureFolder(rootDir);
    await this.ensureFolder(noteDir);
    let title = await this.nextRecordTitle(noteDir, record, bindingLabel);
    let recordForMarkdown = record;
    const recordType = String(record.type || "").toLowerCase();
    const linkAsWebpage = recordType === "link" && shouldHydrateLinkAsWebpage(record.metadata && record.metadata.url || record.content || "");
    const textWebpageUrl = recordType === "text" ? selectAutomaticWebpageUrlFromText([
      record.content || "",
      record.metadata && record.metadata.url || ""
    ].filter(Boolean).join("\n")) : "";
    const textAsWebpage = Boolean(textWebpageUrl);
    if (recordType === "voice") {
      recordForMarkdown = await this.writeVoiceAttachment(record, rootDir, dateFolder, title, binding, progress);
    } else if (recordType === "file") {
      recordForMarkdown = await this.writeFileAttachment(record, rootDir, dateFolder, title, binding, progress);
    } else if (recordType === "webpage" || linkAsWebpage || textAsWebpage) {
      this.showSyncProgress({ ...progress, stage: "processing", title: progressTitle });
      recordForMarkdown = await this.hydrateWebpageMarkdown(
        linkAsWebpage || textAsWebpage ? {
          ...record,
          type: "webpage",
          metadata: {
            ...record.metadata || {},
            url: textAsWebpage ? textWebpageUrl : record.metadata && record.metadata.url || record.content || "",
            ...textAsWebpage ? {
              shareText: record.metadata && record.metadata.shareText || record.content || "",
              automaticWebpageExtraction: true
            } : {},
            conversionStatus: record.metadata && record.metadata.conversionStatus || "pending"
          }
        } : record,
        rootDir,
        dateFolder,
        title,
        binding,
        { signal }
      );
      throwIfAborted(signal);
      if (textAsWebpage && !isAutomaticWebpageHydrationSuccessful(recordForMarkdown)) {
        throw createAutomaticWebpageExtractionError(textWebpageUrl);
      }
      recordForMarkdown = await this.saveSourceMediaAttachment(recordForMarkdown, rootDir, dateFolder, title);
      title = await this.nextRecordTitle(noteDir, recordForMarkdown, bindingLabel);
    }
    throwIfAborted(signal);
    if (isAudioVideoTranscriptionIncompleteRecord(recordForMarkdown)) {
      const metadata = recordForMarkdown.metadata || {};
      const status = metadata.transcriptionStatus || "pending";
      throw createRetryableTranscriptionError(metadata.transcriptionError || `audio/video transcription is ${status}`);
    }
    const lifecycleOutcomeError = getSyncLifecycleOutcomeError(recordForMarkdown);
    if (lifecycleOutcomeError) throw lifecycleOutcomeError;
    recordForMarkdown = await this.enrichRecordMetadataWithAi(recordForMarkdown, binding);
    throwIfAborted(signal);
    const noteIdentity = applyTranscriptionNoteIdentity(recordForMarkdown, {
      fallbackTitle: title,
      bindingLabel
    });
    recordForMarkdown = noteIdentity.record;
    const displayTitle = noteIdentity.displayTitle || title;
    const fileTitle = noteIdentity.titleSource ? await this.nextTitle(noteDir, noteIdentity.fileTitle) : title;
    const markdown = buildMarkdownForRecord({
      record: recordForMarkdown,
      title: displayTitle,
      syncedAt,
      propertyFields: this.settings.notePropertyFields
    });
    const filePath = normalizeVaultPath(`${noteDir}/${fileTitle}.md`);
    this.showSyncProgress({ ...progress, stage: "writing", title: fileTitle });
    const adapter = this.app.vault.adapter;
    const temporaryFilePath = normalizeVaultPath(
      `${noteDir}/.wechat-inbox-sync-${crypto.randomBytes(12).toString("hex")}.tmp`
    );
    let temporaryFileExists = false;
    try {
      throwIfAborted(signal);
      temporaryFileExists = true;
      await adapter.write(temporaryFilePath, markdown);
      throwIfAborted(signal);
      if (typeof adapter.exists === "function" && await adapter.exists(filePath)) {
        throw new Error(`笔记目标路径已存在，已停止写入以避免覆盖：${filePath}`);
      }
      if (typeof adapter.getFullPath === "function") {
        await fs.promises.copyFile(
          adapter.getFullPath(temporaryFilePath),
          adapter.getFullPath(filePath),
          fs.constants.COPYFILE_EXCL
        );
      } else if (this.app.vault && typeof this.app.vault.create === "function") {
        await this.app.vault.create(filePath, markdown);
      } else {
        throw new Error("当前 Obsidian 存储适配器不支持原子安全提交笔记");
      }
    } finally {
      if (temporaryFileExists && typeof adapter.remove === "function") {
        try {
          await adapter.remove(temporaryFilePath);
        } catch (cleanupError) {
        }
      }
    }
    return {
      recordId: getRecordId(record),
      filePath,
      title: fileTitle,
      committed: true,
      conversionWarning: getRecordConversionWarning(recordForMarkdown)
    };
  }
  async reportSyncLifecycleStatus(recordId, body, binding) {
    return await this.requestJson(
      `/records/${encodeURIComponent(recordId)}/status`,
      "POST",
      body,
      binding
    );
  }
  async persistPendingSyncLifecycleAttempts(value) {
    const pendingSyncLifecycleAttempts = normalizePendingSyncLifecycleAttempts(value);
    this.settings = {
      ...this.settings,
      pendingSyncLifecycleAttempts
    };
    if (typeof this.saveData === "function") {
      await this.saveData(this.settings);
    }
    return pendingSyncLifecycleAttempts;
  }
  async upsertPendingSyncLifecycleAttempt(binding, value = {}) {
    const bindingFingerprint = getSyncLifecycleBindingFingerprint(binding && binding.token);
    const recordId = String(value.recordId || "").trim();
    const attemptId = String(value.attemptId || "").trim();
    if (!bindingFingerprint || !recordId || !attemptId) return null;
    const current = normalizePendingSyncLifecycleAttempts(this.settings.pendingSyncLifecycleAttempts);
    const previous = current.find((item) => item.bindingFingerprint === bindingFingerprint && item.recordId === recordId);
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const next = normalizePendingSyncLifecycleAttempts([
      ...current.filter((item) => !(item.bindingFingerprint === bindingFingerprint && item.recordId === recordId)),
      {
        recordId,
        attemptId,
        bindingFingerprint,
        stage: value.stage || "processing",
        code: value.code,
        noteTitle: value.noteTitle,
        createdAt: previous && previous.createdAt ? previous.createdAt : now,
        updatedAt: now
      }
    ]);
    await this.persistPendingSyncLifecycleAttempts(next);
    return next.find((item) => item.bindingFingerprint === bindingFingerprint && item.recordId === recordId) || null;
  }
  async clearPendingSyncLifecycleAttempt(binding, recordId) {
    const bindingFingerprint = getSyncLifecycleBindingFingerprint(binding && binding.token);
    const normalizedRecordId = String(recordId || "").trim();
    if (!bindingFingerprint || !normalizedRecordId) return false;
    const current = normalizePendingSyncLifecycleAttempts(this.settings.pendingSyncLifecycleAttempts);
    const next = current.filter((item) => !(item.bindingFingerprint === bindingFingerprint && item.recordId === normalizedRecordId));
    if (next.length === current.length) return false;
    await this.persistPendingSyncLifecycleAttempts(next);
    return true;
  }
  async persistCommittedSyncLifecycleAttemptBestEffort(binding, value = {}) {
    try {
      await this.upsertPendingSyncLifecycleAttempt(binding, {
        ...value,
        stage: "committed"
      });
      return null;
    } catch (error) {
      return {
        code: "RECOVERY_MARKER_SAVE_FAILED",
        message: "local note is saved; recovery marker could not be persisted"
      };
    }
  }
  async clearPendingSyncLifecycleAttemptBestEffort(binding, recordId) {
    try {
      await this.clearPendingSyncLifecycleAttempt(binding, recordId);
      return null;
    } catch (error) {
      return {
        code: "RECOVERY_MARKER_CLEAR_FAILED",
        message: "sync completion is confirmed; stale recovery marker may be replayed safely"
      };
    }
  }
  async replayPendingSyncLifecycleAttempts(binding) {
    const bindingFingerprint = getSyncLifecycleBindingFingerprint(binding && binding.token);
    if (!bindingFingerprint) return { replayed: 0, retained: 0 };
    const attempts = normalizePendingSyncLifecycleAttempts(this.settings.pendingSyncLifecycleAttempts).filter((item) => item.bindingFingerprint === bindingFingerprint);
    let replayed = 0;
    for (const item of attempts) {
      try {
        if (item.stage === "committed") {
          await this.reportSyncRecordCompletion(item.recordId, item.noteTitle || "", binding, {
            enabled: true,
            attemptId: item.attemptId
          });
        } else {
          await this.reportSyncLifecycleStatus(item.recordId, {
            status: "failed",
            attemptId: item.attemptId,
            code: item.stage === "failed" ? item.code || "SYNC_FAILED" : "SYNC_INTERRUPTED"
          }, binding);
        }
        await this.clearPendingSyncLifecycleAttempt(binding, item.recordId);
        replayed += 1;
      } catch (error) {
        if (isRecordNotFoundError(error) || isLegacySyncLifecycleError(error) || isSyncRecordBusyError(error)) {
          try {
            await this.clearPendingSyncLifecycleAttempt(binding, item.recordId);
          } catch (clearError) {
          }
        }
      }
    }
    const retained = normalizePendingSyncLifecycleAttempts(this.settings.pendingSyncLifecycleAttempts).filter((item) => item.bindingFingerprint === bindingFingerprint).length;
    return { replayed, retained };
  }
  async claimSyncRecordProcessing(recordId, binding, lifecycleAdvertised) {
    if (!lifecycleAdvertised) return { enabled: false };
    try {
      const payload = await this.reportSyncLifecycleStatus(recordId, { status: "processing" }, binding);
      const data = payload && payload.data && typeof payload.data === "object" ? payload.data : payload && typeof payload === "object" ? payload : {};
      const attemptId = String(data.attemptId || data.syncAttemptId || "").trim();
      if (!attemptId) throw new Error("sync processing claim is missing an attempt id");
      return { enabled: true, attemptId };
    } catch (error) {
      if (isLegacySyncLifecycleError(error)) return { enabled: false, legacyFallback: true };
      if (isSyncRecordBusyError(error)) return { enabled: true, conflict: true };
      throw error;
    }
  }
  async reportSyncRecordCompletion(recordId, noteTitle, binding, lifecycle = {}) {
    const safeNoteTitle = sanitizeSyncNoteTitle(noteTitle);
    const body = lifecycle.enabled && lifecycle.attemptId ? {
      attemptId: lifecycle.attemptId,
      ...safeNoteTitle ? { noteTitle: safeNoteTitle } : {}
    } : lifecycle.legacyFallback && safeNoteTitle ? { noteTitle: safeNoteTitle } : {};
    try {
      return await this.requestJson(
        `/records/${encodeURIComponent(recordId)}/synced`,
        "POST",
        body,
        binding
      );
    } catch (error) {
      if (!lifecycle.enabled || !isLegacySyncLifecycleError(error)) throw error;
      return await this.requestJson(
        `/records/${encodeURIComponent(recordId)}/synced`,
        "POST",
        safeNoteTitle ? { noteTitle: safeNoteTitle } : {},
        binding
      );
    }
  }
  async reportSyncRecordCompletionBestEffort(recordId, noteTitle, binding, lifecycle = {}) {
    try {
      await this.reportSyncRecordCompletion(recordId, noteTitle, binding, lifecycle);
      return null;
    } catch (error) {
      if (isRecordNotFoundError(error)) return null;
      return {
        code: "COMPLETION_REPORT_FAILED",
        message: "sync completion report failed; local note is preserved"
      };
    }
  }
  async reportSyncRecordFailure(recordId, attemptId, error, binding) {
    const code = categorizeSyncFailure(error);
    return await this.reportSyncLifecycleStatus(recordId, {
      status: "failed",
      attemptId,
      code
    }, binding);
  }
  async syncBinding(binding, shouldPrefixTitle) {
    const bindingLabel = binding && (binding.label || binding.token) ? binding.label || binding.token : "";
    await this.replayPendingSyncLifecycleAttempts(binding);
    this.showSyncProgress({ bindingLabel, stage: "fetching" });
    const payload = await this.requestJson("/records?status=pending", "GET", {}, binding);
    const records = payload.data || [];
    const pendingReview = normalizePendingReviewSummary(payload && payload.meta && payload.meta.pendingReview);
    const syncSnapshot = normalizeSyncRecordDiagnosticSnapshot(payload && payload.meta && payload.meta.syncSnapshot);
    const lifecycleAdvertised = Boolean(payload && payload.meta && payload.meta.syncLifecycleStatus === true);
    const written = [];
    const failed = [];
    const skipped = [];
    const conversionWarnings = [];
    const completionWarnings = [];
    const syncedAt = (/* @__PURE__ */ new Date()).toISOString();
    if (!records.length) {
      this.showSyncProgress({ bindingLabel, stage: "empty" });
    }
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      const recordId = getRecordId(record);
      const progress = {
        bindingLabel,
        current: index + 1,
        total: records.length
      };
      let lifecycle = { enabled: false };
      let localCommitFact = null;
      if (this.settings.locallyQuarantinedRecordIds.includes(recordId)) {
        skipped.push({
          recordId,
          reason: "locally-quarantined-unrecoverable"
        });
        continue;
      }
      if (isCloudTranscriptionWaitingRecord(record)) {
        skipped.push({
          recordId,
          reason: "cloud-transcription-processing"
        });
        this.showSyncProgress({ ...progress, stage: "processing", title: `${buildRecordTitleBase(record)} 云端转写中` });
        continue;
      }
      const processingAbortController = new AbortController();
      const processingProgress = {
        ...progress,
        signal: processingAbortController.signal
      };
      this.currentProcessingAbortController = processingAbortController;
      this.currentProcessingContext = {
        recordId,
        binding: binding ? { ...binding } : null,
        title: buildRecordTitleBase(record)
      };
      this.setTranscriptionStopAvailable(true);
      try {
        throwIfAborted(processingAbortController.signal);
        lifecycle = await this.claimSyncRecordProcessing(recordId, binding, lifecycleAdvertised);
        if (lifecycle.conflict) {
          skipped.push({ recordId, reason: "record-busy" });
          continue;
        }
        if (lifecycle.enabled && lifecycle.attemptId) {
          await this.upsertPendingSyncLifecycleAttempt(binding, {
            recordId,
            attemptId: lifecycle.attemptId,
            stage: "processing"
          });
        }
        const existingFilePath = await this.findExistingRecordNotePath(record);
        if (existingFilePath) {
          localCommitFact = { recordId, filePath: existingFilePath };
          skipped.push({
            recordId,
            reason: "already-synced-local",
            filePath: existingFilePath
          });
          this.showSyncProgress({ ...progress, stage: "marking", title: buildRecordTitleBase(record) });
          const existingNoteTitle = getSyncNoteTitleFromPath(existingFilePath) || buildRecordTitleBase(record);
          let markerWarning2 = null;
          if (lifecycle.enabled && lifecycle.attemptId) {
            markerWarning2 = await this.persistCommittedSyncLifecycleAttemptBestEffort(binding, {
              recordId,
              attemptId: lifecycle.attemptId,
              noteTitle: existingNoteTitle
            });
          }
          const completionWarning2 = await this.reportSyncRecordCompletionBestEffort(
            recordId,
            existingNoteTitle,
            binding,
            lifecycle
          );
          if (completionWarning2) {
            completionWarnings.push({ recordId, ...completionWarning2 });
            if (markerWarning2) completionWarnings.push({ recordId, ...markerWarning2 });
          } else if (lifecycle.enabled && lifecycle.attemptId) {
            const clearWarning = await this.clearPendingSyncLifecycleAttemptBestEffort(binding, recordId);
            if (clearWarning) completionWarnings.push({ recordId, ...clearWarning });
          }
          continue;
        }
        const item = await this.writeRecord(record, syncedAt, binding, shouldPrefixTitle, processingProgress);
        if (processingAbortController.signal.aborted && !item.committed) {
          throw createAbortError();
        }
        localCommitFact = item;
        written.push(item);
        if (item.conversionWarning) {
          conversionWarnings.push(item.conversionWarning);
        }
        let markerWarning = null;
        if (lifecycle.enabled && lifecycle.attemptId) {
          markerWarning = await this.persistCommittedSyncLifecycleAttemptBestEffort(binding, {
            recordId: item.recordId,
            attemptId: lifecycle.attemptId,
            noteTitle: item.title
          });
        }
        this.showSyncProgress({ ...progress, stage: "marking", title: item.title });
        const completionWarning = await this.reportSyncRecordCompletionBestEffort(
          item.recordId,
          item.title,
          binding,
          lifecycle
        );
        if (completionWarning) {
          completionWarnings.push({ recordId: item.recordId, ...completionWarning });
          if (markerWarning) completionWarnings.push({ recordId: item.recordId, ...markerWarning });
        } else if (lifecycle.enabled && lifecycle.attemptId) {
          const clearWarning = await this.clearPendingSyncLifecycleAttemptBestEffort(binding, item.recordId);
          if (clearWarning) completionWarnings.push({ recordId: item.recordId, ...clearWarning });
        }
      } catch (error) {
        if (localCommitFact) {
          completionWarnings.push({
            recordId: String(localCommitFact.recordId || recordId || "").trim(),
            code: "POST_COMMIT_RECOVERY_FAILED",
            message: "local note is saved; post-commit recovery will retry without marking sync failed"
          });
          continue;
        }
        const message = error.message || String(error);
        const deletionResult = await this.consumePendingStoppedTranscriptionDelete(getRecordId(record));
        if (deletionResult && deletionResult.deleted) {
          skipped.push({
            recordId: getRecordId(record),
            reason: "deleted-current-transcription"
          });
          continue;
        }
        if (isPermanentlyExpiredXiaohongshuShortlinkRecord(record, error)) {
          try {
            const receiptPath = await this.writeExpiredXiaohongshuLinkReceipt(record);
            const expiredDeleteResult = await this.deleteCurrentTranscriptionRecord({
              recordId,
              binding
            });
            if (expiredDeleteResult && expiredDeleteResult.deleted) {
              skipped.push({
                recordId,
                reason: "deleted-expired-xhs-shortlink",
                receiptPath
              });
              continue;
            }
          } catch (deleteError) {
          }
        }
        let lifecycleReportError = null;
        if (lifecycle.enabled && lifecycle.attemptId) {
          const failureCode = categorizeSyncFailure(error);
          try {
            await this.upsertPendingSyncLifecycleAttempt(binding, {
              recordId,
              attemptId: lifecycle.attemptId,
              stage: "failed",
              code: failureCode
            });
          } catch (persistError) {
          }
          try {
            await this.reportSyncRecordFailure(recordId, lifecycle.attemptId, error, binding);
            try {
              await this.clearPendingSyncLifecycleAttempt(binding, recordId);
            } catch (clearError) {
            }
          } catch (reportError) {
            lifecycleReportError = {
              code: "STATUS_REPORT_FAILED",
              message: "status report failed; original error remains local"
            };
          }
        }
        const diagnostic = error && error.diagnostic && typeof error.diagnostic === "object" ? redactSensitiveObject(error.diagnostic) : null;
        let failedTitle = "小红书内容";
        if (!isXiaohongshuUrl(getRecordUrl(record))) {
          try {
            failedTitle = buildRecordTitleBase(record);
          } catch (titleError) {
            failedTitle = getRecordId(record) || String(record && record.type ? record.type : "unknown");
          }
        }
        this.lastSyncDiagnostic = {
          ...progress,
          status: "failed",
          stage: progress.stage || "processing",
          title: failedTitle,
          recordId: getRecordId(record),
          message: "单条内容同步失败",
          error: message,
          ...diagnostic ? { diagnostic } : {},
          ...lifecycleReportError ? { lifecycleReportError } : {},
          time: (/* @__PURE__ */ new Date()).toISOString()
        };
        writeSyncDiagnosticLog(this.lastSyncDiagnostic, this.getConfiguredLocalAsrInstallRoot());
        failed.push({
          recordId: getRecordId(record),
          message,
          ...diagnostic ? { diagnostic } : {},
          ...lifecycleReportError ? { lifecycleReportError } : {}
        });
      } finally {
        if (this.currentProcessingAbortController === processingAbortController) {
          this.currentProcessingAbortController = null;
        }
        if (this.currentProcessingContext && this.currentProcessingContext.recordId === recordId) {
          this.currentProcessingContext = null;
        }
        if (!this.currentTranscriptionAbortController && !this.currentTranscriptionProcess) {
          this.setTranscriptionStopAvailable(false);
        }
      }
    }
    return { written, failed, skipped, conversionWarnings, completionWarnings, pendingReview, syncSnapshot };
  }
  async syncInbox(showNotice = true) {
    if (this.syncInboxPromise) {
      if (showNotice) {
        new Notice("同步正在进行中，请等待当前任务完成。", 2500);
      }
      return await this.syncInboxPromise;
    }
    const syncTask = this.runSyncInboxOnce(showNotice);
    this.syncInboxPromise = syncTask;
    try {
      return await syncTask;
    } finally {
      if (this.syncInboxPromise === syncTask) {
        this.syncInboxPromise = null;
      }
    }
  }
  async runSyncInboxOnce(showNotice = true) {
    const errors = validateSettings(this.settings);
    if (errors.length) {
      new Notice(errors[0]);
      return;
    }
    try {
      const bindings = this.getActiveBindings();
      const shouldPrefixTitle = bindings.length > 1;
      const written = [];
      const failed = [];
      const skipped = [];
      const conversionWarnings = [];
      const completionWarnings = [];
      const pendingReviews = [];
      const syncSnapshots = [];
      this.syncProgressNotice = null;
      this.showSyncProgress({ stage: "fetching" });
      for (const binding of bindings) {
        try {
          const result = await this.syncBinding(binding, shouldPrefixTitle);
          written.push(...result.written);
          failed.push(...result.failed);
          if (result.skipped && result.skipped.length) {
            skipped.push(...result.skipped);
          }
          if (result.conversionWarnings && result.conversionWarnings.length) {
            conversionWarnings.push(...result.conversionWarnings);
          }
          if (result.completionWarnings && result.completionWarnings.length) {
            completionWarnings.push(...result.completionWarnings);
          }
          if (result.pendingReview && (result.pendingReview.total || result.pendingReview.audioVideoCount)) {
            pendingReviews.push(result.pendingReview);
          }
          if (result.syncSnapshot) {
            syncSnapshots.push(result.syncSnapshot);
          }
        } catch (error) {
          const message = error.message || String(error);
          if (isBindingInvalidMessage(message)) {
            const actionMessage = await this.markBindingNeedsRebind(binding, message);
            if (actionMessage) conversionWarnings.push(actionMessage);
            continue;
          }
          failed.push({
            recordId: binding.label || binding.token,
            message: `${binding.label || binding.token}：${message}`
          });
        }
      }
      let finalMessage = buildSyncResultNotice(written, skipped, conversionWarnings, failed);
      const pendingReviewNotice = buildPendingReviewNotice(mergePendingReviewSummaries(pendingReviews));
      if (!written.length && !failed.length && pendingReviewNotice) {
        finalMessage = pendingReviewNotice;
      } else if (pendingReviewNotice) {
        finalMessage += `；${pendingReviewNotice}`;
      }
      if (completionWarnings.length) {
        finalMessage += `；本地笔记已保存，但 ${completionWarnings.length} 条同步状态回报失败，请稍后再次点击同步补报状态`;
      }
      if (showNotice || written.length) {
        new Notice(finalMessage);
      }
      this.lastSyncDiagnostic = {
        status: failed.length ? "failed" : completionWarnings.length ? "warning" : "success",
        stage: "finished",
        current: written.length,
        total: written.length + failed.length + skipped.length,
        message: finalMessage,
        error: failed.length ? failed.map((item) => `${item.recordId}: ${item.message}`).join("\n") : "",
        completionWarningCount: completionWarnings.length,
        completionWarningCode: completionWarnings.length ? "COMPLETION_REPORT_FAILED" : "",
        ...failed.find((item) => item.diagnostic) ? { diagnostic: failed.find((item) => item.diagnostic).diagnostic } : {},
        ...syncSnapshots.length ? { syncSnapshots } : {},
        time: (/* @__PURE__ */ new Date()).toISOString()
      };
      writeSyncDiagnosticLog(this.lastSyncDiagnostic, this.getConfiguredLocalAsrInstallRoot());
      this.clearSyncProgressNotice();
    } catch (error) {
      this.lastSyncDiagnostic = {
        status: "failed",
        stage: "syncInbox",
        message: "同步失败",
        error: error.message || String(error),
        time: (/* @__PURE__ */ new Date()).toISOString()
      };
      writeSyncDiagnosticLog(this.lastSyncDiagnostic, this.getConfiguredLocalAsrInstallRoot());
      this.clearSyncProgressNotice();
      new Notice(`同步失败：${error.message || error}`);
    }
  }
};
__name(_WechatObsidianInboxPlugin, "WechatObsidianInboxPlugin");
var WechatObsidianInboxPlugin = _WechatObsidianInboxPlugin;
var _WechatInboxSettingTab = class _WechatInboxSettingTab extends PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  addPasswordSetting(containerEl, { name, desc, placeholder, value, onChange }) {
    new Setting(containerEl).setName(name).setDesc(desc).addText((text) => {
      text.inputEl.type = "password";
      text.setPlaceholder(placeholder).setValue(value).onChange(onChange);
    });
  }
  renderFeishuSettings(containerEl) {
    const feishuPanel = containerEl.createEl("details", { cls: "wechat-inbox-sync-advanced-panel" });
    feishuPanel.open = true;
    feishuPanel.createEl("summary", { text: "连接飞书文档" });
    const feishuOAuthStatus = this.plugin.settings.feishuOAuthStatus || {};
    feishuPanel.createDiv({
      text: feishuOAuthStatus.connected ? `已连接飞书官方 API；token 有效期至 ${feishuOAuthStatus.expiresAt || "未知"}。同步飞书链接时会优先走官方授权通道。` : "未连接飞书官方 API 时仍会使用旧解析方式转存飞书链接，但可能出现内容不全、图片缺失或结构不稳定；建议按教程连接官方 API。",
      cls: "wechat-inbox-sync-muted"
    });
    new Setting(feishuPanel).setName("飞书官方 API 连接教程").setDesc(`按教程创建飞书自建应用、配置权限和回调地址：${FEISHU_OFFICIAL_API_TUTORIAL_URL}`).addButton((button) => button.setButtonText("打开教程").onClick(async () => {
      const opened = await openExternalUrl(FEISHU_OFFICIAL_API_TUTORIAL_URL);
      if (!opened) {
        new Notice(`请复制链接到浏览器打开：${FEISHU_OFFICIAL_API_TUTORIAL_URL}`);
      }
    }));
    const feishuCallbackUrl = `${trimTrailingSlash(FEISHU_OAUTH_SYNC_API_BASE)}/feishu/oauth/callback`;
    new Setting(feishuPanel).setName("飞书回调地址").setDesc(`在飞书自建应用后台配置这个重定向 URL：${feishuCallbackUrl}`).addButton((button) => button.setButtonText("复制").onClick(async () => {
      const copied = await this.plugin.copyTextToClipboard(feishuCallbackUrl);
      new Notice(copied ? "飞书回调地址已复制" : `请手动复制：${feishuCallbackUrl}`);
    }));
    new Setting(feishuPanel).setName("飞书 App ID").setDesc("填写你自己在飞书开放平台创建的企业自建应用 App ID。").addText((text) => text.setPlaceholder("cli_xxx").setValue(this.plugin.settings.feishuAppId || "").onChange(async (value) => {
      await this.plugin.saveSettings({
        ...this.plugin.settings,
        feishuAppId: String(value || "").trim(),
        feishuOAuthStatus: null
      });
    }));
    new Setting(feishuPanel).setName("飞书 App Secret").setDesc("只保存在当前 Obsidian 插件本地；授权和提取时会通过 HTTPS 临时发送给云端使用。").addText((text) => {
      text.inputEl.type = "password";
      text.setPlaceholder("App Secret").setValue(this.plugin.settings.feishuAppSecret || "").onChange(async (value) => {
        await this.plugin.saveSettings({
          ...this.plugin.settings,
          feishuAppSecret: String(value || "").trim(),
          feishuOAuthStatus: null
        });
      });
    });
    new Setting(feishuPanel).setName(feishuOAuthStatus.connected ? "更换飞书账号" : "连接飞书官方 API").setDesc(feishuOAuthStatus.connected ? "需要切换飞书账号或重新授权时，点击后在浏览器完成授权。" : "连接后同步飞书链接会优先走官方 API，文字、图片和标题结构更稳定。").addButton((button) => button.setButtonText(feishuOAuthStatus.connected ? "重新连接" : "连接飞书").setCta().onClick(async () => {
      try {
        await this.plugin.connectFeishuCloudOAuth();
        new Notice("已打开飞书授权页，授权完成后请回到 Obsidian 点击“刷新状态”。");
      } catch (error) {
        new Notice(`打开飞书授权失败：${error.message || error}`);
      }
    })).addButton((button) => button.setButtonText("刷新状态").onClick(async () => {
      try {
        const status = await this.plugin.refreshFeishuCloudOAuthStatus();
        new Notice(status && status.connected ? "飞书连接状态已刷新：已连接" : "飞书连接状态已刷新：未连接或已过期");
        this.display();
      } catch (error) {
        new Notice(`刷新飞书授权状态失败：${error.message || error}`);
      }
    }));
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "Obsidian 内容同步助手" });
    containerEl.createEl("h3", {
      text: "使用教程",
      cls: "wechat-inbox-sync-section-heading"
    });
    new Setting(containerEl).setName("小程序名字：Obsidian 内容同步助手").setDesc("打开微信后搜索这个小程序，进入「绑定 Obsidian」页面复制绑定码。");
    new Setting(containerEl).setName("微信小程序绑定教程").setDesc(`插件安装、绑定码填写和常见问题。小程序名字：Obsidian 内容同步助手。教程链接：${FEISHU_TUTORIAL_URL}`).addButton((button) => button.setButtonText("打开教程").onClick(async () => {
      const opened = await openExternalUrl(FEISHU_TUTORIAL_URL);
      if (!opened) {
        new Notice(`请复制链接到浏览器打开：${FEISHU_TUTORIAL_URL}`);
      }
    }));
    containerEl.createEl("h3", {
      text: "绑定小程序",
      cls: "wechat-inbox-sync-section-heading"
    });
    const bindings = normalizeBindings(this.plugin.settings);
    const primaryBinding = bindings.find((item) => item.enabled !== false && item.status !== "unbound" && item.status !== "needs_rebind") || null;
    const nonPrimaryBindings = bindings.filter((item) => !primaryBinding || item.token !== primaryBinding.token);
    const needsRebindBindings = nonPrimaryBindings.filter((item) => item.status === "needs_rebind");
    const extraBindings = nonPrimaryBindings.filter((item) => item.status !== "needs_rebind");
    const renderBindingSetting = /* @__PURE__ */ __name((parentEl, binding, indexLabel) => {
      const isUnbound = binding.status === "unbound";
      const needsRebind = binding.status === "needs_rebind";
      const statusDesc = needsRebind ? binding.lastError || "绑定码已失效，请重新生成绑定码后重新绑定。" : isUnbound ? `已解除/已失效${binding.lastError ? `：${binding.lastError}` : ""}` : binding.enabled === false ? "已暂停同步" : "同步时会拉取这个微信里的收集内容";
      new Setting(parentEl).setName(`${binding.label || indexLabel}：${binding.token}`).setDesc(statusDesc).addText((text) => text.setPlaceholder(indexLabel).setValue(binding.label || "").onChange(async (value) => {
        const nextBindings = normalizeBindings(this.plugin.settings).map((item) => item.token === binding.token ? { ...item, label: value } : item);
        await this.plugin.saveSettings({ ...this.plugin.settings, bindings: nextBindings });
      })).addToggle((toggle) => {
        toggle.setValue(binding.enabled !== false).onChange(async (value) => {
          if (isUnbound || needsRebind) return;
          const nextBindings = normalizeBindings(this.plugin.settings).map((item) => item.token === binding.token ? { ...item, enabled: value, status: value ? "bound" : "paused" } : item);
          await this.plugin.saveSettings({ ...this.plugin.settings, bindings: nextBindings });
          this.display();
        });
        if (isUnbound || needsRebind) toggle.setDisabled(true);
      }).addButton((button) => {
        button.setButtonText(isUnbound ? "已解除" : "解除本机").onClick(async () => {
          if (isUnbound) return;
          await this.plugin.unbindBinding(binding.token);
          this.display();
        });
        if (isUnbound) {
          button.setDisabled(true);
        }
      });
    }, "renderBindingSetting");
    new Setting(containerEl).setName("输入绑定码").setDesc(primaryBinding ? "绑定成功。基础绑定区只保留 1 个小程序绑定码；更多绑定请到下方 Pro 高级功能里增加设备。" : "基础绑定区只保留 1 个小程序绑定码。打开微信小程序【Obsidian 内容同步助手】的「绑定 Obsidian」页面，复制小程序绑定码后粘贴到这里。").addText((text) => text.setPlaceholder("例如 ABC-123").setValue(primaryBinding ? primaryBinding.token : this.plugin.settings.pendingBindCode || "").setDisabled(Boolean(primaryBinding)).onChange(async (value) => {
      await this.plugin.saveSettings({ ...this.plugin.settings, pendingBindCode: value });
    })).addButton((button) => {
      button.setButtonText(primaryBinding ? "绑定成功" : "立即绑定").setCta().onClick(async () => {
        if (primaryBinding) return;
        await this.plugin.bindCurrentCode();
        this.display();
      });
      if (primaryBinding) {
        button.setDisabled(true);
      }
    }).addButton((button) => {
      button.setButtonText("解除本机").onClick(async () => {
        if (!primaryBinding) return;
        await this.plugin.unbindBinding(primaryBinding.token);
        this.display();
      });
      if (!primaryBinding) button.setDisabled(true);
    });
    new Setting(containerEl).setName("保存根目录").setDesc("同步笔记写入的位置；可选择是否按日期再创建子目录。").addText((text) => text.setPlaceholder("临时收集").setValue(this.plugin.settings.inboxDir).onChange(async (value) => {
      await this.plugin.saveSettings({ ...this.plugin.settings, inboxDir: value });
    }));
    new Setting(containerEl).setName("笔记保存方式").setDesc("默认按日期分类；如果想所有文章都直接进入上面的目录，选择“直接保存到根目录”。").addDropdown((dropdown) => {
      Object.entries(NOTE_SAVE_MODES).forEach(([value, label]) => {
        dropdown.addOption(value, label);
      });
      dropdown.setValue(this.plugin.settings.noteSaveMode || DEFAULT_SETTINGS.noteSaveMode).onChange(async (value) => {
        await this.plugin.saveSettings({
          ...this.plugin.settings,
          noteSaveMode: normalizeNoteSaveMode(value)
        });
        this.display();
      });
    });
    new Setting(containerEl).setName("立即同步").setDesc("手动拉取云端收集箱，并写入当前 vault。").addButton((button) => button.setButtonText("同步").setCta().onClick(() => this.plugin.syncInbox()));
    new Setting(containerEl).setName("同步/安装失败诊断").setDesc("同步失败、转写失败、下载卡住时，点这里复制诊断信息发给开发者张张（微信：heyhmjx）。里面包含最近同步阶段、转写日志和安装日志。").addButton((button) => button.setButtonText("复制诊断信息").onClick(async () => {
      try {
        await this.plugin.copySyncDiagnosticText();
        new Notice("诊断信息已复制");
      } catch (error) {
        new Notice(`复制诊断信息失败：${error.message || error}`);
      }
    }));
    containerEl.createEl("h3", {
      text: "登录设置",
      cls: "wechat-inbox-sync-section-heading"
    });
    this.renderFeishuSettings(containerEl);
    containerEl.createDiv({ cls: "wechat-inbox-sync-section-spacer" });
    containerEl.createEl("h3", {
      text: "Pro 高级功能",
      cls: "wechat-inbox-sync-section-heading"
    });
    const renderedProStatusFingerprint = getProEntitlementStatusFingerprint(
      this.plugin.settings.localTranscriptionEntitlementStatus
    );
    const proStatusText = buildLocalTranscriptionEntitlementText(this.plugin.settings.localTranscriptionEntitlementStatus);
    const proPanel = containerEl.createEl("details", { cls: "wechat-inbox-sync-advanced-panel" });
    proPanel.open = true;
    proPanel.createEl("summary", { text: "Pro 状态" });
    proPanel.createDiv({
      text: `插件会通过已绑定的小程序绑定码自动识别 Pro 权限；开通 Pro 后点击刷新即可更新有效期和本地组件状态。${proStatusText}`,
      cls: "wechat-inbox-sync-muted"
    });
    new Setting(proPanel).setName("刷新 Pro 权限").setDesc(this.plugin.settings.pendingRedeemCode ? `兑换码：${this.plugin.settings.pendingRedeemCode}` : "兑换码会在成功识别 Pro 后自动显示；普通使用只需要绑定小程序并开通 Pro。").addButton((button) => button.setButtonText("刷新权限").setCta().onClick(async () => {
      try {
        const status2 = await this.plugin.refreshProAndMaybePromptLocalComponentInstall({
          reason: "manual-refresh",
          force: true
        });
        if (status2.hasAccess) {
          const proAccessNotice = `Pro 权限有效${status2.expiresAt ? `，有效期至 ${formatEntitlementExpiresAt(status2.expiresAt)}` : ""}`;
          if (status2.localComponentInstallError) {
            new Notice(`${proAccessNotice}；但本地转写组件安装/修复失败，请按弹窗提示处理后重试。`, 8e3);
          } else {
            new Notice(proAccessNotice);
          }
        } else if (status2.status === "missing_redeem_code") {
          new Notice("未识别到 Pro，请确认已绑定小程序并在小程序里开通 Pro。");
        } else {
          new Notice(status2.message || "Pro 未开通或已过期，请在小程序开通/续费后刷新。");
        }
        this.display();
      } catch (error) {
        new Notice(`权限查询失败：${error.message || error}`);
      }
    }));
    new Setting(proPanel).setName("保存原始音视频到本地").setDesc("Pro 功能。默认关闭；开启后，新同步且可下载的音频或视频会保存到“音视频附件/日期”目录，并在笔记中插入本地链接；无法下载时仍会保留转写结果。").addToggle((toggle) => toggle.setValue(this.plugin.settings.saveOriginalMediaEnabled === true).onChange(async (value) => {
      if (!value) {
        await this.plugin.saveSettings({
          ...this.plugin.settings,
          saveOriginalMediaEnabled: false
        });
        return;
      }
      try {
        await this.plugin.ensureProFeatureAccess("保存原始音视频到本地", { forceRefresh: true });
        await this.plugin.saveSettings({
          ...this.plugin.settings,
          saveOriginalMediaEnabled: true
        });
      } catch (error) {
        await this.plugin.saveSettings({
          ...this.plugin.settings,
          saveOriginalMediaEnabled: false
        });
        new Notice(error.message || String(error));
        this.display();
      }
    }));
    new Setting(proPanel).setName("启用小红书图片 OCR").setDesc("Pro 功能，默认关闭。开启后，后续同步的小红书图文会识别图片中的文字；关闭时仍会保存正文和图片，不会启动 OCR。").addToggle((toggle) => toggle.setValue(this.plugin.settings.xiaohongshuImageOcrEnabled === true).onChange(async (value) => {
      if (!value) {
        await this.plugin.saveSettings({
          ...this.plugin.settings,
          xiaohongshuImageOcrEnabled: false,
          xiaohongshuImageOcrConsentVersion: 1
        });
        return;
      }
      try {
        await this.plugin.ensureProFeatureAccess("小红书图片 OCR", { forceRefresh: true });
        await this.plugin.saveSettings({
          ...this.plugin.settings,
          xiaohongshuImageOcrEnabled: true,
          xiaohongshuImageOcrConsentVersion: 1
        });
      } catch (error) {
        await this.plugin.saveSettings({
          ...this.plugin.settings,
          xiaohongshuImageOcrEnabled: false,
          xiaohongshuImageOcrConsentVersion: 1
        });
        new Notice(error.message || String(error));
        this.display();
      }
    }));
    proPanel.createDiv({
      text: "AI 简介与关键词自动生成：已默认开启。小红书图片 OCR 默认关闭，按需手动开启。",
      cls: "wechat-inbox-sync-muted"
    });
    const proComponentReadiness = this.plugin.getLocalTranscriptionComponentReadiness();
    const proComponentStatusText = this.plugin.localComponentInstallPromise ? "准备中" : proComponentReadiness.ready ? "已安装" : `需修复：${proComponentReadiness.missingComponents.join("、")}`;
    proPanel.createDiv({
      text: `本地转写组件：${proComponentStatusText}；当前系统：${proComponentReadiness.platformName || "自动识别"}`,
      cls: "wechat-inbox-sync-muted"
    });
    const extraBindingsPanel = containerEl.createEl("details", { cls: "wechat-inbox-sync-advanced-panel" });
    extraBindingsPanel.createEl("summary", { text: "额外绑定设备" });
    extraBindingsPanel.createDiv({
      text: "Pro 功能。免费版只保留 1 个基础绑定码；Pro 有效期内可以继续绑定第 2、3 个小程序绑定码。",
      cls: "wechat-inbox-sync-muted"
    });
    extraBindings.forEach((binding, index) => {
      renderBindingSetting(extraBindingsPanel, binding, `额外绑定微信 ${index + 2}`);
    });
    needsRebindBindings.forEach((binding, index) => {
      renderBindingSetting(extraBindingsPanel, binding, `需重新绑定微信 ${index + 1}`);
    });
    const canAcceptExtraBinding = bindings.length < MAX_PLUGIN_BINDINGS || bindings.some((item) => item.status === "needs_rebind");
    new Setting(extraBindingsPanel).setName("绑定额外设备").setDesc(!canAcceptExtraBinding ? `已达到上限：最多绑定 ${MAX_PLUGIN_BINDINGS} 个小程序码。` : "先确认 Pro 仍在有效期内，再把新的小程序绑定码绑定到当前插件。").addText((text) => text.setPlaceholder("例如 ABC-123").setValue(this.plugin.settings.pendingBindCode || "").setDisabled(!canAcceptExtraBinding).onChange(async (value) => {
      await this.plugin.saveSettings({ ...this.plugin.settings, pendingBindCode: value });
    })).addButton((button) => {
      button.setButtonText("绑定额外设备").onClick(async () => {
        try {
          await this.plugin.ensureProFeatureAccess("额外绑定设备");
          await this.plugin.bindCurrentCode();
          this.display();
        } catch (error) {
          new Notice(`绑定额外设备失败：${error.message || error}`);
        }
      });
      if (bindings.length >= MAX_PLUGIN_BINDINGS) {
        button.setDisabled(true);
      }
    });
    const socialPanel = containerEl.createEl("details", { cls: "wechat-inbox-sync-advanced-panel" });
    socialPanel.createEl("summary", { text: "登录小红书评论区" });
    socialPanel.createDiv({
      text: "Pro 功能。同步小红书图文时保留可解析到的评论区内容；如果评论区提取失败，请先登录小红书。",
      cls: "wechat-inbox-sync-muted"
    });
    const xiaohongshuLoginBtn = new Setting(socialPanel).setName("登录小红书").setDesc("小红书评论区可能需要网页登录状态；登录后插件会复用该状态提取评论区。").addButton((button) => button.setButtonText("打开小红书登录").onClick(async () => {
      xiaohongshuLoginBtn.setDesc("正在打开小红书登录窗口...");
      await this.plugin.loginXiaohongshu();
      this.display();
    })).addButton((button) => button.setButtonText("检测登录状态").onClick(async () => {
      xiaohongshuLoginBtn.setDesc("正在检测小红书登录状态...");
      const loggedIn = await this.plugin.checkXiaohongshuLogin();
      if (loggedIn) {
        xiaohongshuLoginBtn.setDesc("小红书登录状态正常；同步小红书图文时会复用该状态提取评论区。");
        new Notice("小红书登录状态正常");
      } else {
        xiaohongshuLoginBtn.setDesc("未检测到小红书登录状态，或登录状态已过期；如需提取评论区，请重新登录小红书。");
        new Notice("未检测到小红书登录状态，或登录状态已过期");
      }
    }));
    this.plugin.checkXiaohongshuLogin().then((loggedIn) => {
      if (loggedIn) {
        xiaohongshuLoginBtn.setDesc("已保存小红书登录状态；同步小红书图文时会复用该状态提取评论区。");
      }
    });
    const status = containerEl.createDiv({ cls: "wechat-inbox-sync-status" });
    status.setText(this.plugin.settings.noteSaveMode === "root" ? "同步后会生成：临时收集/文本-示例.md、临时收集/公众号-示例.md。语音附件仍会放入临时收集/语音附件/YYYY-MM-DD/。" : "同步后会生成：临时收集/YYYY-MM-DD/文本-示例.md、公众号-示例.md。语音附件会放入临时收集/语音附件/YYYY-MM-DD/。");
    this.plugin.refreshProAndMaybePromptLocalComponentInstall({ reason: "settings-open" }).then(() => {
      const currentProStatusFingerprint = getProEntitlementStatusFingerprint(
        this.plugin.settings.localTranscriptionEntitlementStatus
      );
      if (currentProStatusFingerprint !== renderedProStatusFingerprint) {
        this.display();
      }
    }).catch((error) => {
      new Notice(`Pro 自动能力检查失败：${error.message || error}`);
    });
  }
};
__name(_WechatInboxSettingTab, "WechatInboxSettingTab");
var WechatInboxSettingTab = _WechatInboxSettingTab;
WechatObsidianInboxPlugin.__test = {
  buildDouyinFallbackMarkdown,
  buildXiaohongshuFallbackMarkdown,
  buildWechatChannelsUnavailableMarkdown,
  categorizeSyncFailure,
  getSyncLifecycleBindingFingerprint,
  getSyncLifecycleOutcomeError,
  isExistingLocalNoteDeliverable,
  normalizePendingSyncLifecycleAttempts,
  sanitizeSyncNoteTitle,
  XIAOHONGSHU_TOTAL_COMMENT_LIMIT,
  XIAOHONGSHU_COMMENT_TIMEOUT_MS,
  FEISHU_TUTORIAL_URL,
  FEISHU_OFFICIAL_API_TUTORIAL_URL,
  MAX_PLUGIN_BINDINGS,
  LOCAL_TRANSCRIPTION_PLAN,
  LOCAL_OCR_WINDOWS_INSTALLER_SHA256,
  LOCAL_OCR_MACOS_INSTALLER_SHA256,
  LOCAL_ASR_INSTALLER_URL,
  LOCAL_ASR_MACOS_INSTALLER_URL,
  LOCAL_OCR_INSTALLER_URL,
  LOCAL_OCR_MACOS_INSTALLER_URL,
  LOCAL_OCR_BATCH_RUNNER_VERSION,
  LOCAL_OCR_BATCH_RUNNER_SOURCE,
  isLocalAsrInstallerCurrent,
  isLocalOcrInstallerCurrent,
  isTrustedLocalOcrInstallerSource,
  completePendingLocalOcrSwitch,
  LOCAL_ASR_PLATFORM_NAMES,
  NOTE_PROPERTY_FIELD_KEYS,
  NOTE_SAVE_MODES,
  canAddPluginBinding,
  getLocalAsrPlatform,
  normalizeLocalAsrPlatform,
  normalizeLocalAsrInstallMode,
  normalizeNotePropertyFields,
  normalizeNoteSaveMode,
  normalizeCloudPreTranscriptionThresholdMinutes,
  isAsciiPath,
  extractLocalAsrInstallRootFromCommand,
  hasLocalAsrNativeCrash,
  getLocalAsrRepairAction,
  resolveLocalAsrPlatform,
  getLocalAsrPlatformMismatchMessage,
  formatRedeemAccessError,
  formatLocalComponentInstallFailureReason,
  isCachedProStatusActiveForCode,
  getProEntitlementStatusFingerprint,
  buildAliyunVoiceRequest,
  buildDoubaoAsrRequest,
  buildDoubaoAsrQueryRequest,
  buildTencentCreateRecTaskBody,
  buildTencentRequest,
  parseAliyunTranscriptionResult,
  parseDoubaoAsrResult,
  parseDoubaoAsrTaskState,
  formatHttpError,
  parseTencentCreateTaskResponse,
  parseTencentTaskStatusResponse,
  buildRecordTitleBase,
  hasRecordIdInFrontmatter,
  extractXiaohongshuMarkdownFromHtml,
  getXiaohongshuTargetNoteId,
  isGenericXiaohongshuLandingExtraction,
  hasReadableXiaohongshuGraphicContent,
  shouldStopWaitingForXiaohongshuContent,
  rememberXiaohongshuObservedIdentity,
  installXiaohongshuIdentityObserver,
  selectXiaohongshuBrowserSnapshot,
  extractSocialCommentsFromHtml,
  collectXiaohongshuCommentPages,
  mergeXiaohongshuReplyPages,
  mergeXiaohongshuCapturedCommentPayloads,
  mergeXiaohongshuCommentSources,
  preserveXiaohongshuPrimaryCommentTree,
  finalizeXiaohongshuComments,
  didXiaohongshuRootCollectionProgress,
  getXiaohongshuCommentBudgetState,
  buildXiaohongshuCommentDiagnostic,
  appendXiaohongshuCommentDiagnostic,
  getXiaohongshuCommentPaginationScript,
  buildSocialCommentsMarkdown,
  getSocialCommentTreeStats,
  limitSocialCommentTreeTotal,
  getSocialCommentMarkdownStats,
  getXiaohongshuCapturedRequestBody,
  getXiaohongshuCapturedResponseText,
  isXiaohongshuCommentApiUrl,
  isXiaohongshuSubCommentApiUrl,
  classifyXiaohongshuCommentRequestIdentity,
  collectXiaohongshuNoteImageUrls,
  appendXiaohongshuOcrMarkdown,
  buildXiaohongshuOcrMarkdown,
  isXiaohongshuTextDominantOcrItem,
  isLikelyImageTextNote,
  mergeXiaohongshuOcrText,
  normalizeXiaohongshuOcrMetrics,
  normalizeXiaohongshuOcrItems,
  XIAOHONGSHU_OCR_TEXT_DOMINANCE_THRESHOLDS,
  buildWebpageMarkdownBody,
  buildFileMarkdownBody,
  buildSourceMediaAttachmentMarkdown,
  buildMarkdownForRecord,
  buildNoteOutputPlan,
  enrichExtractedWebpageMetadata,
  extractSocialVideoMarkdownFromHtml,
  extractPodcastAudioUrlFromHtml,
  extractSocialMediaUrlsFromHtml,
  extractSocialMediaUrlFromHtml,
  WECHAT_CHANNELS_FEED_INFO_URL,
  isWechatChannelsUrl,
  extractWechatChannelsRequestPayload,
  normalizeWechatChannelsFeedPayload,
  extractWechatChannelsProfilesFromText,
  generateWechatChannelsDecryptorBytes,
  decryptWechatChannelsMediaBuffer,
  extractDouyinAwemeId,
  buildDouyinDomIdentityExtractorScript,
  selectPrimaryDouyinDomMediaUrls,
  selectIdentityBoundDouyinBrowserMedia,
  normalizeDouyinTargetUrl,
  getDouyinMobileSharePageUrls,
  extractDouyinMediaUrlsFromShareHtml,
  extractDouyinMediaUrlsFromDetailPayload,
  extractDouyinMediaUrlsForAweme,
  fetchDouyinMediaResolutionWithSession,
  fetchDouyinMediaUrlsWithSession,
  buildDouyinStructuredContent,
  isUnavailableXiaohongshuPage,
  normalizeBrowserCapturedMediaUrls,
  shouldBlockExternalAppUrl,
  installDouyinExternalProtocolHandlers,
  installExternalAppNavigationGuards,
  isAllowedXiaohongshuBrowserNavigationUrl,
  shouldBlockXiaohongshuBrowserNavigationRequest,
  installXiaohongshuNavigationGuards,
  installXiaohongshuLoginWindowGuards,
  trackXiaohongshuBrowserWindow,
  bindBrowserWindowToAbortSignal,
  closeActiveXiaohongshuBrowserWindows,
  enableDebuggerNetworkCapture,
  beginBestEffortBrowserLoad,
  waitForBrowserTasksWithin,
  runBrowserTaskWithTimeout,
  sortMediaUrlsForTranscription,
  cleanDisplayUrl,
  isWechatMpArticleUrl,
  shouldHydrateLinkAsWebpage,
  selectAutomaticWebpageUrlFromText,
  requestPublicWebpageText,
  getSafeRedirectRequestHeaders,
  normalizeConfiguredVaultPath,
  shouldPersistNormalizedInboxDir,
  shouldPersistAutoLocalAsrPlatform,
  extractBilibiliSubtitleUrlsFromHtml,
  parseBilibiliSubtitlePayload,
  extractBilibiliAudioUrlFromPlayurlPayload,
  extractBilibiliProgressiveVideoUrlFromPlayurlPayload,
  hasVideoTrackInMediaBuffer,
  cleanTrailingTranscriptionHallucinations,
  buildAudioTranscriptMarkdown,
  buildTranscriptPropertyMetadata,
  buildTranscriptOnlyMetadata,
  buildSyncProgressMessage,
  buildSyncDiagnosticLogText,
  buildSyncResultNotice,
  buildSkippedSyncNotice,
  getRecordConversionWarning,
  buildConversionWarningsNotice,
  parseLocalAsrProgressLog,
  buildLocalAsrProgressKey,
  getTranscriptionQualityIssue,
  createTranscriptionQualityError,
  assertUsableTranscription,
  createRetryableTranscriptionError,
  isRetryableTranscriptionError,
  shouldBypassExistingLocalNoteDedupe,
  getPluginRuntimeIdentity,
  getSafeUrlDiagnostic,
  getTransportErrorDiagnostic,
  buildWebpageTransportDiagnostic,
  buildDouyinMediaResolutionDiagnostic,
  getXiaohongshuCapabilityMatrix,
  runWithXiaohongshuBrowserSessionLock,
  getXiaohongshuBrowserCandidates,
  scoreXiaohongshuExtraction,
  mergeXiaohongshuExtractions,
  buildXiaohongshuBrowserAttemptDiagnostic,
  isXiaohongshuShareBoilerplateOnly,
  classifyXiaohongshuPage,
  buildXiaohongshuFailureDiagnostic,
  createRetryableXiaohongshuContentError,
  isRetryableXiaohongshuContentError,
  isPermanentlyExpiredXiaohongshuShortlinkRecord,
  isRemoteAsrDownloadFailure,
  getDoubaoTaskKey,
  getDefaultLocalTranscriptionCommand,
  getSafeLocalAsrInstallRoot,
  getLocalAsrInstallRoot,
  getLocalAsrInstallStatus,
  getLocalOcrInstallRoot,
  getLocalOcrInstallStatus,
  getLocalOcrPythonPath,
  getLocalOcrScriptPath,
  getLocalAsrScriptVersionStatus,
  explainLocalAsrExitCode,
  getLocalAsrRunLogPath,
  buildLocalAsrRunLogText,
  appendLocalAsrRunLog,
  readLocalAsrRunLog,
  buildLocalAsrInstallCommand,
  buildLocalOcrInstallCommand,
  downloadTextViaNode,
  normalizeInstallerScriptText,
  getSocialRequestHeaders,
  buildXiaohongshuLoginPageConfig,
  isAbortedBrowserNavigationError,
  isXiaohongshuUrl,
  isTrustedXiaohongshuCookieUrl,
  isTrustedXiaohongshuTransportUrl,
  hasXiaohongshuLoginCookies,
  getXiaohongshuCookieHeader,
  getXiaohongshuRequestHeaders,
  checkXiaohongshuLoginStatus,
  shouldResolveMediaDownloadUrl,
  openExternalUrl,
  extractPdfMarkdown,
  cleanPdfExtractedText,
  htmlToMarkdown,
  extractWebpageMetadataFromHtml,
  normalizeSyncRecordDiagnosticSnapshot,
  extractFeishuMarkdownFromHtml,
  extractFeishuMarkdownFromClientVars,
  mergeFeishuRenderedAndClientVarsMarkdown,
  shouldRefreshFeishuMarkdownFromSource,
  extractFeishuDocumentTokenFromUrl,
  buildFeishuClientVarsApiUrl,
  extractFeishuOpenApiUrlInfo,
  extractFeishuMarkdownFromOpenApiBlocks,
  fetchFeishuOpenApiMarkdownFromUrl,
  normalizeGeneratedKeywords,
  parseGeneratedMetadataResponse,
  extractAiMetadataInputText,
  cleanMarkdownForStorage,
  resolveRedirectUrlWithDiagnostics,
  resolveRedirectUrl,
  isRequestUrlTransportError,
  requestJsonViaNode,
  isBindingInvalidMessage,
  validateSettings,
  mergeSettings,
  normalizeBindings,
  normalizeLocallyQuarantinedRecordIds,
  normalizeApiBase,
  normalizeBindCodeInput,
  pad2,
  getChinaTimeParts,
  getDateFolderName,
  formatCreatedTime,
  getTitleTimePart
};
module.exports = WechatObsidianInboxPlugin;
