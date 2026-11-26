'use strict';
const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const load = Module._load;
Module._load = function(name, parent, main) {
  if (name === 'obsidian') return {Plugin:class {}, PluginSettingTab:class {}, Modal:class {}, Setting:class {}, Notice:class {},
    normalizePath:p=>p, requestUrl:async()=>({status:200,text:'<html><body></body></html>'})};
  if (/\.(ps1|sh|py)$/.test(name)) return '';
  return load.call(this,name,parent,main);
};
const Plugin = require('../obsidian-plugin/wechat-inbox-sync/src/main');
Module._load = load;
async function check(createdAt, expected) {
  const p = new Plugin();
  p.settings = {inboxDir:'Inbox',noteSaveMode:'root',notePropertyFields:[],aiProvider:'off'};
  p.app = {vault:{adapter:{exists:async()=>false,getFullPath:()=>path.resolve('fixture-missing')}}};
  p.showSyncProgress = p.ensureFolder = () => {};
  p.nextRecordTitle = async () => 'fixture';
  p.saveSourceMediaAttachment = async record => record;
  p.getConfiguredLocalAsrInstallRoot = () => '';
  p.getActiveBindings = () => [];
  p.checkDouyinLogin = async () => false;
  p.queueSyncDiagnosticEvent = event => event;
  const url = 'https://www.douyin.com/note/1234567890123456789';
  await assert.rejects(p.writeRecord({_id:'fixture-note',type:'webpage',createdAt,content:url,
    metadata:{url,webpageMediaType:'audio_video'}},createdAt), error => {
    assert.equal(error.code,'TRANSCRIPTION_PENDING');
    assert.equal(error.retryable,true);
    const event = p.queueSyncDiagnosticFailure({recordId:'fixture-note',attemptId:'fixture-attempt',binding:{token:'fixture'},error});
    assert.equal(event.errorCode,expected);
    return true;
  });
}
(async()=>{
  await check('2026-11-25T00:00:00Z','TRANSCRIPTION_FAILED');
  await check('2026-11-27T00:00:00Z','DOUYIN_LOGIN_REQUIRED');
  console.log('PASS Douyin login report on new and historical records');
})().catch(e=>{console.error(e);process.exitCode=1});
