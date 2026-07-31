'use strict';

const CHINA_TIME_OFFSET_MS = 8 * 60 * 60 * 1000;

function pad2(value) {
  return String(value).padStart(2, '0');
}

function getChinaTimeParts(createdAt, now = Date.now()) {
  const parsed = new Date(createdAt);
  const date = Number.isNaN(parsed.getTime()) ? new Date(now) : parsed;
  const shifted = new Date(date.getTime() + CHINA_TIME_OFFSET_MS);

  return {
    year: shifted.getUTCFullYear(),
    month: pad2(shifted.getUTCMonth() + 1),
    day: pad2(shifted.getUTCDate()),
    hour: pad2(shifted.getUTCHours()),
    minute: pad2(shifted.getUTCMinutes()),
    second: pad2(shifted.getUTCSeconds()),
  };
}

function getDateFolderName(createdAt) {
  const parts = getChinaTimeParts(createdAt);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function formatCreatedTime(createdAt) {
  const parts = getChinaTimeParts(createdAt);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function getTitleTimePart(createdAt) {
  const parts = getChinaTimeParts(createdAt);
  return `${parts.hour}${parts.minute}${parts.second}`;
}

module.exports = {
  formatCreatedTime,
  getChinaTimeParts,
  getDateFolderName,
  getTitleTimePart,
  pad2,
};
