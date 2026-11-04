'use strict';
const assert=require('node:assert/strict'),Module=require('node:module');
const entries=[];
class Element {
  constructor(tag='div', options={}, parent=null){this.tag=tag;this.options=options;this.parent=parent;this.children=[];this.attributes={...(options.attr||{})};this.listeners={};this.classList={toggle(){}};}
  createEl(tag,options={}){const el=new Element(tag,options,this);this.children.push(el);return el;}
  createDiv(options){return this.createEl('div',options);}setText(text){this.options.text=text;}empty(){this.children=[];}setAttribute(k,v){this.attributes[k]=v;}addEventListener(k,fn){this.listeners[k]=fn;}
}
class Setting {
  constructor(parent){this.parent=parent;this.controls=[];entries.push(this);}setName(v){this.name=v;return this;}setDesc(v){this.desc=v;return this;}
  add(callback){const c={inputEl:new Element('input'),selectEl:new Element('select'),options:[],setPlaceholder(){return c;},setValue(v){c.value=v;return c;},setDisabled(){return c;},setCta(){return c;},setButtonText(v){c.label=v;return c;},addOption(k,v){c.options.push([k,v]);return c;},onChange(fn){c.change=fn;return c;},onClick(fn){c.click=fn;return c;}};this.controls.push(c);callback(c);return this;}
  addText(fn){return this.add(fn);}addDropdown(fn){return this.add(fn);}addToggle(fn){return this.add(fn);}addButton(fn){return this.add(fn);}
}
const load=Module._load;Module._load=function(name,...args){if(name==='obsidian')return {Plugin:class{},PluginSettingTab:class{},Setting,Modal:class{},Notice:class{}};return load.call(this,name,...args);};
const Plugin=require('../obsidian-plugin/wechat-inbox-sync/main');Module._load=load;
async function main(){
  let saves=0;
  const plugin={settings:Plugin.__test.mergeSettings({}),getActiveBindings:()=>[],getLocalTranscriptionComponentReadiness:()=>({ready:true,missingComponents:[],platformName:'Windows'}),refreshProAndMaybePromptLocalComponentInstall:async()=>{},checkDouyinLogin:async()=>false,checkXiaohongshuLogin:async()=>false,saveSettings:async function(next){saves++;if(next)this.settings=next;}};
  const tab=Object.create(Plugin.__test.WechatInboxSettingTab.prototype);tab.plugin=plugin;tab.containerEl=new Element();
  const before=JSON.stringify(plugin.settings);tab.display();await Promise.resolve();await Promise.resolve();
  assert.equal(typeof tab.createSettingsNavigation,'function','the accepted settings category menu must remain available');
  const settingsNav=tab.containerEl.children.find(e=>e.attributes&&e.attributes.role==='tablist');
  assert.ok(settingsNav);assert.deepEqual(settingsNav.children.map(e=>e.options.text),['绑定与保存','服务与高级功能','AI 功能']);
  for(const name of ['输入绑定码','保存地址设置','笔记保存方式','图文图片保存方式','立即同步','微信小程序绑定教程','飞书官方 API 连接教程','诊断信息','飞书 App ID','本地转写组件','绑定额外设备','抖音登录状态','登录小红书','API 模型','API Key','API 地址','多语言翻译','AI 总结','本地转写语言'])assert.ok(entries.some(e=>e.name===name),name);
  assert.ok(!entries.some(e=>/分段转写时间戳|播放器截图/.test(e.name||'')));
  const ai=entries.find(e=>e.name==='AI 总结').parent;assert.equal(ai.tag,'details');assert.ok(!ai.open);assert.equal(ai.children[0].options.text,'AI 高级功能');
  assert.deepEqual(entries.find(e=>e.name==='连接').controls.map(c=>c.label),['测试','教程']);
  assert.deepEqual(entries.find(e=>e.name==='诊断信息').controls.map(c=>c.label),['复制诊断']);
  assert.deepEqual(entries.find(e=>e.name==='本地转写语言').controls[0].options,[['zh','简体中文'],['en','English']]);
  assert.equal(saves,0);assert.equal(JSON.stringify(plugin.settings),before);
  await entries.find(e=>e.name==='本地转写语言').controls[0].change('en');assert.equal(plugin.settings.transcriptionLanguage,'en');
  assert.equal(plugin.settings.xTranslationEnabled,false);assert.equal(plugin.settings.xSummaryEnabled,false);
  console.log('single-page settings: binding/save/tutorial/service retained; AI collapsed and off; one diagnosis action; zh/en language selection passed');
}
main().catch(e=>{console.error(e);process.exitCode=1;});
