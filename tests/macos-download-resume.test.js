'use strict';
const assert=require('node:assert/strict'),fs=require('fs'),path=require('path'),os=require('os'),http=require('http'),crypto=require('crypto');
const {spawn,execFileSync}=require('child_process');
const scriptPath=path.resolve(__dirname,'../obsidian-plugin/wechat-inbox-sync/local-asr/install-local-asr-macos.sh');
const source=fs.readFileSync(scriptPath,'utf8').replace(/\r\n/g,'\n');
const bash=process.platform==='win32'?'C:/Program Files/Git/bin/bash.exe':'bash';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'mac-asr-resume-test-'));
const unix=p=>p.replace(/\\/g,'/').replace(/^([A-Za-z]):/,(_,d)=>'/'+d.toLowerCase());
const quote=s=>"'"+String(s).replace(/'/g,"'\\''")+"'";
const data=Buffer.alloc(256*1024);for(let i=0;i<data.length;i++)data[i]=i%251;
const sha=crypto.createHash('sha256').update(data).digest('hex').toUpperCase();
function func(name){const start=source.indexOf(name+'() {');assert(start>=0,name);return source.slice(start,source.indexOf('\n}',start)+2);}
const names=['file_sha256','verify_sha256','content_sha256_from_url','download_verified_file','download_file','download_model','detect_uv_arch','python_runtime_sha256','install_portable_python'];
const harness=path.join(temp,'harness.sh');
const setup=`set -euo pipefail\nexport PATH="/usr/bin:/mingw64/bin:$PATH"\n`+
 (process.platform==='win32'?`shasum() { sha256sum "$3"; }\n`:'')+
 `DOWNLOAD_LOW_SPEED_LIMIT=1\nDOWNLOAD_LOW_SPEED_TIME=5\n`+
 `INSTALL_ROOT=${quote(unix(temp))}\nCACHE_ROOT="$INSTALL_ROOT/cache"\nTEMP_ROOT="$INSTALL_ROOT/tmp"\nmkdir -p "$CACHE_ROOT" "$TEMP_ROOT"\n`+
 names.map(func).join('\n');
fs.writeFileSync(harness,setup+'\n');
const requests=[];const counts=new Map();let port;
const server=http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  const kind=pathname.split('/')[1];const n=(counts.get(kind)||0)+1;counts.set(kind,n);
  const range=req.headers.range||''; requests.push({kind,range});
  if(['403','404','500'].includes(kind)){res.writeHead(Number(kind));res.end('error body is not an asset');return;}
  const offset=range?Number(range.match(/bytes=(\d+)-/)[1]):0;
  if(kind==='drop'&&n===1){res.writeHead(200,{'Content-Length':data.length});res.write(data.subarray(0,65536));setTimeout(()=>res.destroy(),20);return;}
  const body=kind==='bad'||(kind==='repair'&&n===1)?Buffer.alloc(data.length,42):data;
  if(kind==='ignore-range'){res.writeHead(200,{'Content-Length':body.length});res.end(body);return;}
  if(offset){res.writeHead(206,{'Content-Length':body.length-offset,'Content-Range':`bytes ${offset}-${body.length-1}/${body.length}`});res.end(body.subarray(offset));}
  else {res.writeHead(200,{'Content-Length':body.length});res.end(body);}
});
function url(kind,signature='one'){return `http://127.0.0.1:${port}/${kind}/by-sha256/${sha.toLowerCase()}/asset?sign=${signature}`;}
async function run(command){
  const p=spawn(bash,['-c',`source ${quote(unix(harness))}\n${command}`],{env:{...process.env},windowsHide:true});
  let output='';p.stdout.on('data',b=>output+=b);p.stderr.on('data',b=>output+=b);
  const code=await new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',resolve);});
  return {code,output};
}
const out=name=>path.join(temp,name);
const verified=(kind,name='asset',signature='one')=>`download_verified_file ${quote(url(kind,signature))} ${quote(unix(out(name)))} ${quote(sha)}`;
function prefix(name,identity=sha,bytes=data.subarray(0,65536)) {fs.writeFileSync(out(name)+'.part',bytes);fs.writeFileSync(out(name)+'.part.sha256',identity+'\n');}
function valid(name){assert.deepEqual(fs.readFileSync(out(name)),data);}
async function main(){
  await new Promise(r=>server.listen(0,'127.0.0.1',r));port=server.address().port;
  execFileSync(bash,['-n',scriptPath]);
  const first=await run(verified('drop'));assert.notEqual(first.code,0);assert(fs.existsSync(out('asset')+'.part'),first.output);assert.equal(fs.statSync(out('asset')+'.part').size,65536);
  const second=await run(verified('drop','asset','renewed'));assert.equal(second.code,0,second.output);valid('asset');
  assert.deepEqual(requests.filter(x=>x.kind==='drop').map(x=>x.range),['','bytes=65536-']);
  const hits=requests.length;assert.equal((await run(verified('drop'))).code,0);assert.equal(requests.length,hits,'complete cache avoids HTTP');
  assert(!fs.existsSync(out('asset')+'.part.sha256'));
  prefix('new-identity','B'.repeat(64));assert.equal((await run(verified('identity','new-identity'))).code,0);assert.equal(requests.find(x=>x.kind==='identity').range,'');
  for(const kind of ['403','404','500']) {prefix(kind);const result=await run(verified(kind,kind));assert.notEqual(result.code,0);assert(!fs.existsSync(out(kind)));assert.deepEqual(fs.readFileSync(out(kind)+'.part'),data.subarray(0,65536));assert.equal(fs.readFileSync(out(kind)+'.part.sha256','utf8').trim(),sha);}
  prefix('range');assert.equal((await run(verified('ignore-range','range'))).code,0);valid('range');assert.deepEqual(requests.filter(x=>x.kind==='ignore-range').map(x=>x.range),['bytes=65536-','']);
  const repaired=await run(verified('repair','repair'));assert.equal(repaired.code,0,repaired.output);assert.equal(counts.get('repair'),2);valid('repair');
  const bad=await run(verified('bad','bad'));assert.notEqual(bad.code,0);assert.equal(counts.get('bad'),2);assert(!fs.existsSync(out('bad')));assert(!fs.existsSync(out('bad')+'.part'));
  prefix('unknown');const beforeUnknown=requests.length;assert.notEqual((await run(`download_verified_file ${quote(url('unknown'))} ${quote(unix(out('unknown')))} ''`)).code,0);assert.equal(requests.length,beforeUnknown);
  // Actual model wrapper: a small hash-correct fixture is accepted, proving
  // this path uses content validation instead of its old 400MB size heuristic.
  const modelCommand=`AUTHORIZED_MODEL_URL=${quote(url('model'))}\nMODEL_URLS=("$AUTHORIZED_MODEL_URL")\ndownload_model ${quote(unix(out('model')))}\n`;
  prefix('model');const model=await run(modelCommand);assert.equal(model.code,0,model.output);valid('model');assert.equal(requests.find(x=>x.kind==='model').range,'bytes=65536-');
  // Unknown identity stays in TEMP_ROOT and never becomes a persistent prefix.
  const unknownModel=await run(`AUTHORIZED_MODEL_URL=''\nMODEL_URLS=(${quote(`http://127.0.0.1:${port}/unknown-model/file`)})\ndownload_model ${quote(unix(out('unknown-model')))}\n`);
  assert.notEqual(unknownModel.code,0);assert(!fs.existsSync(out('unknown-model')+'.part'));assert(!fs.existsSync(out('unknown-model')));
  // Exercise the real Python download/staging call flow. Tiny HTTP fixture;
  // tar and usability are isolated stubs, not a claim of a native Mac install.
  for(const arch of ['arm64','x86_64']) {
    const name=`cpython-3.12.13+20260623-${arch==='arm64'?'aarch64':'x86_64'}-apple-darwin-install_only.tar.gz`;
    const archive=path.join(temp,'cache',name);fs.mkdirSync(path.dirname(archive),{recursive:true});fs.writeFileSync(archive+'.part',data.subarray(0,65536));fs.writeFileSync(archive+'.part.sha256',sha+'\n');
    const command=`uname() { echo ${quote(arch)}; }\nPYTHON_BUILD_STANDALONE_VERSION='3.12.13+20260623'\nPYTHON_BUILD_STANDALONE_BUILD=20260623\nPYTHON_RUNTIME_VERSION=3.12.13\nPYTHON_RUNTIME_SHA256_ARM64=${quote(sha)}\nPYTHON_RUNTIME_SHA256_X64=${quote(sha)}\nPYTHON_RUNTIME_DIR="$INSTALL_ROOT/runtime-${arch}"\nPORTABLE_PYTHON="$PYTHON_RUNTIME_DIR/python/bin/python"\nAUTHORIZED_PYTHON_RUNTIME_URL=${quote(url('python-'+arch))}\nGITHUB_PYTHON_DOWNLOAD_BASE='http://127.0.0.1:1/unused'\nportable_python_is_usable() { [ -f "$1" ]; }\ntar() { mkdir -p "$4/python/bin"; printf fixture > "$4/python/bin/python"; }\ninstall_portable_python\n`;
    const result=await run(command);assert.equal(result.code,0,result.output);assert.equal(requests.find(x=>x.kind==='python-'+arch).range,'bytes=65536-');assert.deepEqual(fs.readFileSync(archive),data);
  }
  const destination=path.resolve(__dirname,'../.artifacts/resource-cost-macos-20261016');fs.mkdirSync(destination,{recursive:true});
  const evidence={passed:true,requests:requests.length,resume:{firstBytes:65536,nextOffset:65536,assetBytes:data.length},completeCacheRequests:0,rangeFallbackRequests:2,corruptRetryRequests:2,pythonArchitectures:['arm64','x86_64'],nativeMacInstall:false,realAssetsDownloaded:false,fixtureDirectory:temp};
  fs.writeFileSync(path.join(destination,'test-results.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>server.close());
