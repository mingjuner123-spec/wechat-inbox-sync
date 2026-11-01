'use strict';
const assert = require('node:assert/strict');
const article = require('../obsidian-plugin/wechat-inbox-sync/src/platform-article-utils');
const lifecycle = require('../obsidian-plugin/wechat-inbox-sync/src/sync-lifecycle-utils');
const target = '2047272282221961889';
const url = `https://www.zhihu.com/question/321759446/answer/${target}`;
const content = '目标回答的实际正文，用来验证正确选择文章以及独立于页面导航的正文验收。'.repeat(3);
const script = (id, data) => `<script id="${id}">${JSON.stringify(data)}</script>`;
const zhihu = script('js-initialData', {initialState:{entities:{answers:{
  111:{content:'推荐回答'.repeat(200),question:{title:'错误答案'}},
  [target]:{content,question:{title:'目标问题'}}
}}}});
assert.equal(article.extractPlatformArticleFromHtml(zhihu,'zhihu',url).contentHtml,content);
assert.equal(article.extractPlatformArticleFromHtml(zhihu,'zhihu','https://www.zhihu.com/answer/999'),null);
assert.equal(article.extractPlatformArticleFromHtml(zhihu,'zhihu','https://www.zhihu.com/question/321759446'),null);
const ttUrl = 'https://www.toutiao.com/article/7123456789012345678/';
const tt = script('RENDER_DATA',{recommend:{id:'999',title:'推荐',content:'错误'.repeat(300)},articleInfo:{group_id:'7123456789012345678',title:'正文',content}});
assert.equal(article.extractPlatformArticleFromHtml(tt,'toutiao',ttUrl).contentText,content);
assert.equal(article.extractPlatformArticleFromHtml(tt,'toutiao','https://www.toutiao.com/article/333/'),null);
// A share URL without a parseable identity may recover only through the
// dedicated article container plus a canonical article on the same platform.
assert.equal(article.extractPlatformArticleFromHtml(zhihu,'zhihu','https://www.zhihu.com/question/321759446'),null);
const fallbackSelect=Function('return ('+article.selectPlatformArticleBody.toString()+')')();
const fallbackBody={id:'fallback-body'};
const fallbackDoc={
  querySelector:selector=>['.QuestionRichText','.Post-RichText'].includes(selector)?fallbackBody:null,
  querySelectorAll:()=>[{getAttribute:()=> 'https://www.zhihu.com/question/321759446'}],
};
assert.equal(fallbackSelect(fallbackDoc,'zhihu',null),fallbackBody);
assert.equal(article.hasMatchingPlatformArticleDocumentIdentity(fallbackDoc,'https://www.zhihu.com/question/share-link'),true);
assert.equal(fallbackSelect({...fallbackDoc,querySelectorAll:()=>[]},'zhihu',null),null);
assert.equal(fallbackSelect({...fallbackDoc,querySelectorAll:()=>[{getAttribute:()=> 'https://evil.example/answer/1'}]},'zhihu',null),null);
// Large numeric IDs cannot silently compare after IEEE-754 rounding.
assert.equal(article.extractPlatformArticleFromHtml(script('RENDER_DATA',{id:7123456789012345678,title:'错误',content}),'toutiao',ttUrl),null);
for (const bad of ['', '# 这个标题长度已经足够超过旧的阈值\n原始链接：'+url,'首页\n热点\n登录\n注册\n关于我们','[这是很长很长的标题链接文字但是没有任何正文]('+url+')',
  '> 知乎正文未能自动提取。\n> 原始链接已写入笔记属性，可稍后重新同步。\n原始链接：'+url,
  '> 今日头条页面需要登录后才能读取正文。\n> 原始链接已写入笔记属性，可稍后重新同步。\n原始链接：'+ttUrl]) {
  assert.equal(article.hasPlatformArticleBody(bad),false,bad);
  for (const sourceUrl of [url,ttUrl]) {
    const record={type:'webpage',content:sourceUrl,metadata:{markdown:bad,conversionStatus:'success'}};
    assert.equal(lifecycle.getSyncLifecycleOutcomeError(record).code,'EXTRACTION_FAILED');
    assert.equal(lifecycle.isExistingLocalNoteDeliverable(record,bad),false);
  }
}
assert.equal(article.hasPlatformArticleBody(content),true);
const record={type:'webpage',content:url,metadata:{markdown:content,conversionStatus:'success'}};
assert.equal(lifecycle.getSyncLifecycleOutcomeError(record),null);
assert.equal(lifecycle.isExistingLocalNoteDeliverable(record,content),true);
const error=lifecycle.getSyncLifecycleOutcomeError({...record,metadata:{conversionStatus:'link_saved',conversionDiagnostic:{source:'platform-article',platform:'zhihu',stage:'hidden-browser',http:{status:403,transport:'node-http'},hiddenBrowser:{needsLogin:true,blocked:true,bodyTextChars:0,error:'secret-credential'},reason:'secret-credential'}}});
assert.equal(error.diagnostic.http.status,403);
assert.equal(error.diagnostic.hiddenBrowser.blocked,true);
assert.ok(!JSON.stringify(article.sanitizePlatformArticleDiagnostic(error.diagnostic)).includes('secret-credential'));
// Matching target DOM among recommendations; works in the browser without module closures.
const body={id:'target-body'};
const answer=(id,node)=>({getAttribute:()=>JSON.stringify({itemId:id}),querySelectorAll:()=>[],querySelector:()=>node});
const doc={querySelectorAll:()=>[answer('111',{}),answer(target,body)]};
const select=Function('return ('+article.selectPlatformArticleBody.toString()+')')();
assert.equal(select(doc,'zhihu',article.getPlatformArticleIdentity(url)),body);
assert.equal(select(doc,'zhihu',{type:'answer',id:'missing'}),null);
const identify=Function('return ('+article.getPlatformArticleIdentity.toString()+')')();
assert.equal(identify(url).id,target);
assert.equal(identify('https://zhihu.com.evil.example/answer/'+target),null);
const canonicalDoc=value=>({querySelectorAll:()=>value?[{getAttribute:()=>value}]:[]});
assert.equal(article.hasMatchingPlatformArticleDocumentIdentity(canonicalDoc('https://www.zhihu.com/answer/777'), 'https://www.zhihu.com/question/share-link'),true);
assert.equal(article.hasMatchingPlatformArticleDocumentIdentity(canonicalDoc('https://www.toutiao.com/article/777'), 'https://www.zhihu.com/question/share-link'),false);
assert.equal(article.hasMatchingPlatformArticleDocumentIdentity(canonicalDoc(url),url),true);
assert.equal(article.hasMatchingPlatformArticleDocumentIdentity(canonicalDoc(url+'/other'),url),false);
assert.equal(article.hasMatchingPlatformArticleDocumentIdentity(canonicalDoc('https://www.zhihu.com/answer/333'),url),false);
assert.equal(article.hasMatchingPlatformArticleDocumentIdentity(canonicalDoc(''),url),false);
console.log('platform article recovery tests passed');
