'use strict';
const assert = require('node:assert/strict');
const Module = require('node:module');
const article = require('../obsidian-plugin/wechat-inbox-sync/src/wechat-article-utils');
const { runWechatArticlePipeline } = require('../obsidian-plugin/wechat-inbox-sync/src/wechat-article-pipeline');
const originalLoad = Module._load;
let Plugin;
try { Module._load=function(name,...args){ if(name==='obsidian') return {Plugin:class{},PluginSettingTab:class{},Modal:class{},Setting:class{},Notice:class{}}; return originalLoad.call(this,name,...args); }; Plugin=require('../obsidian-plugin/wechat-inbox-sync/main.js'); }
finally { Module._load=originalLoad; }
const {htmlToMarkdown}=Plugin.__test;
const url='https://mp.weixin.qq.com/s/layout-fixture';
const image1='https://mmbiz.qpic.cn/mmbiz_png/layout-1/640';
const image2='https://mmbiz.qpic.cn/mmbiz_png/layout-2/640';
const prose='这是图文教程的正常段落，图片应保留在当前步骤之后，下一步骤之前。'.repeat(3);
const html='<div id="js_content"><h2>安装插件</h2><p>'+prose+'</p><img data-src="'+image1+'"><h3>绑定账号</h3><p>'+prose+'</p><img data-src="'+image2+'"><p>结束标记</p></div>';
function assertLayout(markdown){const tokens=['## 安装插件',image1,'### 绑定账号',image2,'结束标记'];const positions=tokens.map(token=>markdown.indexOf(token));assert.ok(positions.every((position,i)=>position>=0&&(!i||position>positions[i-1])),markdown);}
async function run(){
 const headings=htmlToMarkdown('<h1><span><br></span></h1><h2>&nbsp;</h2><h4>四级标题</h4><h5>五级标题</h5><h6>六级标题</h6><p>足够长的正文，空标题不能生成多余井号。</p>');
 assert.doesNotMatch(headings,/^#{1,6}\s*$/m); for(const [level,title] of [[4,'四级标题'],[5,'五级标题'],[6,'六级标题']]) assert.ok(headings.includes('#'.repeat(level)+' '+title));
 const markdown=htmlToMarkdown(html); assertLayout(markdown);
 for(const query of ['', '?t=pages/image_detail']) { const result=await runWechatArticlePipeline({url:url+query,fetchStatic:async()=>html,renderBrowser:async()=>{throw Error('normal article must not require browser fallback');}}); assert.equal(result.kind,'article'); assert.equal(result.state,'complete'); assertLayout(htmlToMarkdown(result.html)); }
 assert.equal(article.classifyWechatArticleHtml(html),'article');
 console.log('PASS: WeChat public article inline image ordering and headings');
}
run().catch(error=>{console.error(error);process.exitCode=1;});
