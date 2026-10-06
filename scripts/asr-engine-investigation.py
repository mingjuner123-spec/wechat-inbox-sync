#!/usr/bin/env python3
"""Isolated whisper.cpp comparison. Local audio/model paths are never uploaded."""
import argparse, datetime as dt, hashlib, json, os, platform, re, shutil, signal, subprocess, sys, time
from pathlib import Path
EXPECTED='ask not what your country can do for you'
def sha(path):
 h=hashlib.sha256()
 with Path(path).open('rb') as f:
  for b in iter(lambda:f.read(1024*1024),b''): h.update(b)
 return h.hexdigest()
def cmd_for(engine,audio,model,prefix,variant,threads,extra,language='en'):
 c=[engine,'-m',str(model),'-f',str(audio),'-l',language,'-nt','-otxt','-of',str(prefix)]
 if variant=='no-gpu': c+=['--no-gpu']
 if threads is not None: c+=['-t',str(threads)]
 return c+extra
def save(path,value): Path(path).write_text(value or '',encoding='utf-8',errors='replace')
def sanitized_command(command,audio,model,prefix):
 return [Path(command[0]).name if i==0 else ('<audio>' if x==str(audio) else '<model>' if x==str(model) else '<output-prefix>' if x==str(prefix) else x) for i,x in enumerate(command)]
def collect_symbols(engine,out,label):
 if sys.platform!='darwin' or not Path(engine).is_file(): return
 for tool,args in [('dwarfdump',['--uuid',engine]),('nm',['-n',engine]),('otool',['-tvV',engine])]:
  exe=shutil.which(tool)
  if exe:
   try:
    z=subprocess.run([exe,*args],capture_output=True,text=True,timeout=30); save(out/f'{label}-{tool}.txt',z.stdout+z.stderr)
   except (OSError,subprocess.TimeoutExpired) as e: save(out/f'{label}-{tool}.txt',f'collection failed: {type(e).__name__}')
def time_parse(value):
 try: return dt.datetime.fromisoformat(value.replace('Z','+00:00')).timestamp()
 except (ValueError,AttributeError): return None
def ips_matches(raw,pid,engine,start,end):
 try:
  source=raw.decode("utf-8"); decoder=json.JSONDecoder(); objects=[]; offset=0
  while offset<len(source):
   while offset<len(source) and source[offset].isspace(): offset+=1
   if offset>=len(source): break
   obj,offset=decoder.raw_decode(source,offset); objects.append(obj)
  info={}
  for obj in objects:
   if isinstance(obj,dict): info.update(obj)
  if int(info.get("pid",-1))!=pid: return False
  stamp=time_parse(info.get("captureTime"))
  if stamp is None or stamp<start-5 or stamp>end+120: return False
  procpath=info.get("procPath") or info.get("processPath")
  return bool(procpath) and os.path.normcase(os.path.realpath(procpath))==os.path.normcase(os.path.realpath(engine))
 except (UnicodeDecodeError,ValueError,TypeError):
  return False
def collect_ips(pid,engine,start,end,out,label,wait):
 if sys.platform!="darwin": return
 report_dir=Path.home()/"Library/Logs/DiagnosticReports"; deadline=time.monotonic()+wait; total_read=0; max_total=30*1024*1024
 while time.monotonic()<deadline:
  if report_dir.exists():
   candidates=sorted(report_dir.glob("*.ips"),key=lambda f:f.stat().st_mtime,reverse=True)[:40]
   for path in candidates:
    try:
     size=path.stat().st_size
     if size>5*1024*1024 or total_read+size>max_total: continue
     raw=path.read_bytes(); total_read+=len(raw)
     if ips_matches(raw,pid,engine,start,end):
      (out/f"{label}-system.ips").write_bytes(raw); return
    except OSError: pass
  time.sleep(2)
 save(out/f"{label}-system-ips-not-found.txt","No IPS matched child PID, capture time, and exact executable path within collection window.\n")
def lldb_backtrace(command,out,timeout):
 exe=shutil.which("lldb")
 if not exe: return
 proc=None
 try:
  proc=subprocess.Popen([exe,"--batch","-o","run","-o","thread backtrace all","--",*command],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding="utf-8",errors="replace",start_new_session=(os.name=="posix"))
  try: stdout,stderr=proc.communicate(timeout=timeout)
  except subprocess.TimeoutExpired:
   if os.name=="posix": os.killpg(proc.pid,signal.SIGKILL)
   else: proc.kill()
   stdout,stderr=proc.communicate()
   save(out,"LLDB rerun timed out and its process group was terminated.\n"+stdout+stderr); return
  save(out,stdout+stderr)
 except OSError as exc: save(out,f"LLDB failed: {type(exc).__name__}: {exc}\n")
def run_case(a,variant):
 audio,model=Path(a.audio).resolve(),Path(a.model).resolve(); engine=shutil.which(a.engine) or a.engine
 out=Path(a.output_dir).resolve(); out.mkdir(parents=True,exist_ok=True); stem=f'{a.label}-{variant}'
 case_dir=out/stem; case_dir.mkdir(exist_ok=False); prefix=case_dir/'transcript'
 command=cmd_for(engine,audio,model,prefix,variant,a.threads,a.engine_arg,a.language); start=time.time(); began=time.monotonic(); timed=False; stdout=stderr=''; code=sig=pid=None
 try:
  proc=subprocess.Popen(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,encoding='utf-8',errors='replace',start_new_session=(os.name=='posix'))
  pid=proc.pid
  try: stdout,stderr=proc.communicate(timeout=a.timeout); code=proc.returncode
  except subprocess.TimeoutExpired:
   timed=True
   if os.name=='posix': os.killpg(proc.pid,signal.SIGKILL)
   else: proc.kill()
   stdout,stderr=proc.communicate(); code=proc.returncode
  if code is not None and code<0: sig=signal.Signals(-code).name
 except OSError as exc:
  stderr=f'process launch failed: {type(exc).__name__}: {exc}'; code=127
 end=time.time(); elapsed=round(time.monotonic()-began,3)
 save(case_dir/'stdout.txt',stdout); save(case_dir/'stderr.txt',stderr)
 transcript=prefix.with_suffix('.txt'); text=transcript.read_text(encoding='utf-8',errors='replace') if transcript.is_file() else stdout
 normalized=re.sub(r'\s+',' ',text).strip().lower(); found=a.expected_text.lower() in normalized
 passed=not timed and code==0 and bool(normalized) and found
 rec={'label':a.label,'variant':variant,'engine':Path(engine).name,'engine_sha256':sha(engine) if Path(engine).is_file() else None,'audio_name':audio.name,'audio_sha256':sha(audio),'model_name':model.name,'model_sha256':sha(model),'os':platform.platform(),'machine':platform.machine(),'pid':pid,'started_epoch':start,'ended_epoch':end,'command':sanitized_command(command,audio,model,prefix),'exit_code':code,'signal':sig,'timed_out':timed,'elapsed_seconds':elapsed,'transcript_nonempty':bool(normalized),'expected_text_found':found,'passed':passed,'stdout_file':f'{stem}/stdout.txt','stderr_file':f'{stem}/stderr.txt'}
 if a.symbol_report: collect_symbols(engine,out,a.label)
 if timed or sig:
  if sys.platform=='darwin' and shutil.which('lldb'):
   ll_prefix=case_dir/'lldb-transcript'; llcmd=cmd_for(engine,audio,model,ll_prefix,variant,a.threads,a.engine_arg,a.language)
   lldb_backtrace(llcmd,case_dir/'lldb-crash-backtrace.txt',min(a.timeout+30,180))
  collect_ips(pid,engine,start,end,out,stem,a.ips_wait) if pid else None
 return rec
def main():
 global EXPECTED
 p=argparse.ArgumentParser(description=__doc__)
 p.add_argument('--audio',required=True); p.add_argument('--model',required=True); p.add_argument('--engine',required=True); p.add_argument('--engine-arg',action='append',default=[]); p.add_argument('--language',default='en'); p.add_argument('--label',default='engine'); p.add_argument('--output-dir',required=True); p.add_argument('--timeout',type=float,default=180); p.add_argument('--threads',type=int); p.add_argument('--variants',default='default,no-gpu'); p.add_argument('--expected-text',default=EXPECTED); p.add_argument('--symbol-report',action='store_true'); p.add_argument('--ips-wait',type=int,default=60)
 a=p.parse_args(); EXPECTED=a.expected_text.lower(); engine=shutil.which(a.engine) or a.engine
 if not Path(a.audio).is_file() or not Path(a.model).is_file(): p.error('--audio and --model must exist')
 if not Path(engine).is_file(): p.error('--engine executable not found')
 out=Path(a.output_dir).resolve(); out.mkdir(parents=True,exist_ok=True)
 report={'started_utc':dt.datetime.now(dt.timezone.utc).isoformat(),'machine':platform.machine(),'os':platform.platform(),'audio_sha256':sha(a.audio),'model_sha256':sha(a.model),'cases':[]}
 for variant in (v.strip() for v in a.variants.split(',') if v.strip()):
  if variant not in ('default','no-gpu'): p.error(f'unsupported variant: {variant}')
  report['cases'].append(run_case(a,variant))
 report['passed']=bool(report['cases']) and all(c['passed'] for c in report['cases']); (out/f'{a.label}-report.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
 for c in report['cases']: print(f"{c['label']} {c['variant']}: {'PASS' if c['passed'] else 'FAIL'} exit={c['exit_code']} signal={c['signal']} timeout={c['timed_out']} audio_sha256={c['audio_sha256']} model_sha256={c['model_sha256']}")
 return 0 if report['passed'] else 1
if __name__=='__main__': raise SystemExit(main())
