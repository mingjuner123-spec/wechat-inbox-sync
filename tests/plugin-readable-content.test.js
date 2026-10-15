'use strict';
const assert=require('node:assert/strict'),Module=require('node:module');
const {cleanTranscriptionTail,formatTranscriptForReading,hasOnlySoundAnnotations,prepareBrowserArticleImages}=require('../obsidian-plugin/wechat-inbox-sync/src/readable-content-utils');
const {createNoSpeechTranscriptionError}=require('../obsidian-plugin/wechat-inbox-sync/src/transcription-quality-utils');
const speech='如果你在使用上有任何问题或者建议都可以联系我们。\n以上就是我们今天的全部内容，我们下条视频再见。';
const noisy=speech+'\n(音乐)\n.\n'+Array(15).fill('(音乐).').join('\n')+'\n(CC字幕制作:贝尔)';
assert.equal(cleanTranscriptionTail(noisy),speech);
assert.equal(cleanTranscriptionTail(cleanTranscriptionTail(noisy)),speech);
for(const value of ['这段音乐很好听。','字幕制作是今天课程的重点。','今天介绍CC字幕制作:贝尔的方法。','短句\n(音乐)\n(音乐).','完整的句子。\n完整的句子。\n完整的句子。',speech+'\n(音乐)',speech+'\n(音乐)\n(音乐)\n新的口播内容。'])assert.equal(cleanTranscriptionTail(value),value);
assert.ok(hasOnlySoundAnnotations('(音乐).\n.\n（音乐）。\n(CC字幕制作:贝尔)'));
assert.equal(createNoSpeechTranscriptionError('(音乐).\n（静音）。').code,'TRANSCRIPTION_NO_SPEECH');
assert.equal(createNoSpeechTranscriptionError(noisy),null);
assert.equal(createNoSpeechTranscriptionError('音乐创作非常有趣。'),null);
const text='这是第一个完整的中文句子，没有删减任何内容。'.repeat(40);
const reading=formatTranscriptForReading(text);
assert.ok(reading.includes('\n\n'));
assert.equal(reading.replace(/\s/g,''),text);
assert.equal(formatTranscriptForReading(reading),reading);
const en='This is a complete sentence with decimal 3.14 and normal English words. '.repeat(20).trim();
assert.equal(formatTranscriptForReading(en).replace(/\s/g,''),en.replace(/\s/g,''));
assert.ok(formatTranscriptForReading(en).includes('\n\n'));
assert.equal(formatTranscriptForReading('hello\nworld'),'hello world');
assert.equal(formatTranscriptForReading('你好\n世界'),'你好世界');
const noPunctuation=Array(80).fill('这里是一个原有的短语').join(' ');
assert.ok(formatTranscriptForReading(noPunctuation).includes('\n\n'));
assert.equal(formatTranscriptForReading(noPunctuation).replace(/\s/g,''),noPunctuation.replace(/\s/g,''));
for(const structured of ['## 标题\n\n'+text,'- 列表\n- 列表二','```js\nconsole.log(1)\n```','[01:20] 第一段\n[01:30] 第二段','链接 [原视频](https://example.com)'])assert.equal(formatTranscriptForReading(structured),structured);
const load=Module._load;Module._load=function(name,...args){if(name==='obsidian')return {Plugin:class{},PluginSettingTab:class{},Setting:class{},Notice:class{},TFile:class{},normalizePath:x=>x};return load.call(this,name,...args);};
try{
 const Plugin=require('../obsidian-plugin/wechat-inbox-sync/main.js'),h=Plugin.__test;
 const images=[{'data-src':'//mmbiz.qpic.cn/a.jpg',src:'data:image/gif;base64,AA',alt:'图一'},{'data-original':'/asset/b.jpg',alt:'图二'},{src:'javascript:void(0)'}].map(attrs=>({attrs,removed:false,currentSrc:'',getAttribute(k){return this.attrs[k]||'';},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];},remove(){this.removed=true;}}));
 const assets=prepareBrowserArticleImages({querySelectorAll:()=>images},'https://mp.weixin.qq.com/s/example');
 assert.deepEqual(assets.map(x=>x.src),['https://mmbiz.qpic.cn/a.jpg','https://mp.weixin.qq.com/asset/b.jpg']);
 assert.equal(images[2].removed,true);
 const imageHtml=images.filter(x=>!x.removed).map(x=>'<img '+Object.entries(x.attrs).map(([k,v])=>k+'="'+v+'"').join(' ')+'>').join('');
 const imageMd=h.htmlToMarkdown('<div id="js_content"><p>正文图片需要保持同一顺序及完整地址。</p>'+imageHtml+'</div>');
 for(const asset of assets){assert.ok(imageMd.includes('('+asset.src+')'));assert.ok(!imageHtml.includes('data-src'));}
 assert.ok(imageMd.indexOf(assets[0].src)<imageMd.indexOf(assets[1].src));
 const html='<div id="js_content"><section><section><strong>01 章节标题</strong></section><section><span>第一段需要独立显示，并保留全部文本内容。</span></section><section><span>第二段有<strong>重点</strong>和<em>强调</em>。</span></section></section><blockquote><p>这是引用原文。</p><p>引用第二段。</p></blockquote><ol><li>第一项</li><li>第二项</li></ol><p><img data-src="https://example.com/1.jpg"></p><p><img data-src="https://example.com/2.jpg"></p></div>';
 const md=h.htmlToMarkdown(html);
 assert.ok(md.includes('**01 章节标题**\n\n第一段'));
 assert.ok(md.includes('**重点**')&&md.includes('*强调*'));
 assert.ok(md.includes('> 这是引用原文。'));
 assert.ok(md.includes('1. 第一项')&&md.includes('2. 第二项'));
 assert.ok(md.indexOf('1.jpg')<md.indexOf('2.jpg'));
 const list=h.htmlToMarkdown('<div id="js_content"><h2>标题保留</h2><p>前言文字长度足够用于解析测试。</p><ul><li>项目一<ul><li>嵌套项目二</li></ul></li></ul><pre><code>const x = "&lt;section&gt;";</code></pre></div>');
 assert.ok(list.includes('## 标题保留'));
 assert.ok(list.includes('  - 嵌套项目二'));
 assert.ok(list.includes('```'));
 const styled=h.htmlToMarkdown('<div id="js_content"><section><strong><span style="font-weight: bold"><strong>标题不要重复星号</strong></span></strong></section><strong><br></strong><ul><li><section><span>嵌套段落的列表文字</span></section></li></ul><p>English<strong> word </strong>spacing remains.</p></div>');
 assert.ok(styled.includes('**标题不要重复星号**'));
 assert.ok(!styled.includes('****')&&!/^\*\*$/m.test(styled));
 assert.ok(styled.includes('- 嵌套段落的列表文字'));
 assert.ok(styled.includes('English **word** spacing remains.'));
 const emptyHeadings=h.htmlToMarkdown('<div id="js_content"><h1><span><br></span></h1><h2>&nbsp;</h2><p>这一段正文必须保持不变，不应该出现空白标题。</p></div>');
 assert.ok(!/^#{1,6}\s*$/m.test(emptyHeadings));
 const blankStyles=h.htmlToMarkdown('<div id="js_content"><p><em>&nbsp;</em></p><strong>&nbsp;</strong><strong><br></strong><p>正常的文章内容必须完整保留，且不会产生空白强调标记。</p></div>');
 assert.ok(!blankStyles.includes('*'));
 const comments=h.htmlToMarkdown('<body><p>这是正常文章的正文内容，长度足够并且应该完整保留。</p><div id="js_cmt_area">评论区域不能当正文保存。</div></body>');
 assert.ok(!comments.includes('评论区域'));
 const chapter='<section style="text-align:center"><section><span style="font-size:36px"><strong>01</strong></span></section>\n<p><strong><span style="font-size:17px">章节标题内容</span></strong></p></section>';
 const headings=h.htmlToMarkdown('<div id="js_content">'+chapter+'<p>这一段是正常正文，保持文字和顺序不变。</p></div>');
 assert.ok(headings.includes('## 01 章节标题内容'));
 assert.equal((headings.match(/^## /gm)||[]).length,1);
 const semantic=h.htmlToMarkdown('<div id="js_content"><h1>文章标题</h1><h3>第三层标题</h3><div role="heading" aria-level="4">第四层标题</div><p role="heading" aria-level="9">默认标题</p></div>');
 assert.ok(semantic.includes('# 文章标题')&&semantic.includes('### 第三层标题')&&semantic.includes('#### 第四层标题')&&semantic.includes('## 默认标题'));
 const unquoted=h.htmlToMarkdown('<div id="js_content"><div role=heading aria-level=4>无引号属性标题</div><p>保留合法HTML中的无引号属性及正常文章正文。</p></div>');
 assert.ok(unquoted.includes('#### 无引号属性标题'));
 for(const body of [
  '<p style="text-align:center;font-size:15px"><strong>点击查看详情</strong></p>',
  '<p style="text-align:center;font-size:20px"><strong>只有部分</strong>内容加粗</p>',
  '<p style="text-align:left;font-size:20px"><strong>普通粗体正文</strong></p>',
  '<p style="text-align:center;font-size:36px"><strong>99</strong></p>',
  '<p style="text-align:center;font-size:20px"><strong>2026-10-16</strong></p>',
  '<p style="text-align:center;font-size:20px"><strong>图片说明<img src="https://example.com/a.png"></strong></p>',
  '<ul><li>'+chapter+'</li></ul>', '<blockquote>'+chapter+'</blockquote>', '<pre><code>'+chapter+'</code></pre>', '<table><tr><td>'+chapter+'</td></tr></table>',
  '<p style="text-align:center;font-size:20px;font-weight:bold">强调里的<span style="font-weight:normal">普通文字</span></p>',
  '<p style="text-align:center;font-size:20px;font-weight:bold">大字和<span style="font-size:15px">正常小字</span></p>',
 ]){const converted=h.htmlToMarkdown('<div id="js_content">'+body+'<p>这是用于验证排版的普通正文，必须保持正常段落。</p></div>');assert.ok(!/^#{1,6} /m.test(converted),body);}
 const siblings=h.htmlToMarkdown('<div id="js_content"><section style="text-align:center"><section><p style="font-size:36px"><strong>01</strong></p></section><section><p style="font-size:20px"><strong>另一个容器的标题</strong></p></section></section><p>正常正文，两个独立容器不能跨容器合并。</p></div>');
 assert.ok(!siblings.includes('## 01 '));
 for(const platform of ['抖音','视频号','B站','小红书','小宇宙']){
   const metadata=h.buildTranscriptOnlyMetadata({}, {platform,transcription:noisy,transcriptionStatus:'success'});
   assert.equal(metadata.transcription,speech);
   const body=h.buildAudioTranscriptMarkdown({transcription:noisy,transcriptionStatus:'success'});
   assert.ok(!body.includes('(音乐)')&&!body.includes('CC字幕'));
 }
 const metadata=h.buildTranscriptPropertyMetadata({transcription:noisy,title:'课程'});
 assert.ok(!JSON.stringify(metadata).includes('CC字幕'));
 const voice=h.buildMarkdownForRecord({record:{id:'readable-voice',type:'voice',metadata:{transcription:noisy,transcriptionStatus:'success'}},title:'录音',syncedAt:'2026-10-16'});
 assert.ok(!voice.includes('(音乐)')&&voice.includes('我们下条视频再见'));
 const file=h.buildFileMarkdownBody({type:'file',metadata:{transcription:noisy,transcriptionStatus:'success',fileName:'video.mp4'}},'video');
 assert.ok(!file.includes('(音乐)')&&file.includes('我们下条视频再见'));
 console.log('Readable content regressions passed');
}finally{Module._load=load;}
