import importlib.util, tempfile, unittest, subprocess
from pathlib import Path
from unittest import mock
SCRIPT=Path(__file__).parents[1]/'scripts'/'asr-engine-investigation.py'
spec=importlib.util.spec_from_file_location('runner',SCRIPT); runner=importlib.util.module_from_spec(spec); spec.loader.exec_module(runner)
class FakeProcess:
 pid=12345
 def __init__(self,out='',timeout=False,code=0): self.stdout=out; self.stderr=''; self.timeout=timeout; self.returncode=code; self.killed=False
 def communicate(self,timeout=None):
  if self.timeout:
   self.timeout=False
   raise subprocess.TimeoutExpired('mock-engine',timeout)
  return self.stdout,self.stderr
 def kill(self): self.killed=True
class Tests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(); d=Path(self.tmp.name); self.audio=d/'fixture.wav'; self.model=d/'ggml-small.bin'; self.engine=d/'mock-engine'; self.audio.write_bytes(b'public-fixture'); self.model.write_bytes(b'mock-model'); self.engine.write_bytes(b'mock')
  self.args=runner.argparse.Namespace(audio=str(self.audio),model=str(self.model),engine=str(self.engine),engine_arg=[],label='mock',output_dir=str(d/'evidence'),timeout=1,threads=1,language='en',expected_text=runner.EXPECTED,symbol_report=False,ips_wait=0)
 def tearDown(self): self.tmp.cleanup()
 @mock.patch.object(runner.platform,'platform',return_value='mock-os')
 @mock.patch.object(runner.platform,'machine',return_value='mock-cpu')
 @mock.patch.object(runner.subprocess,'Popen')
 def test_valid_output_passes_without_exposing_private_paths(self,popen,machine_mock,platform_mock):
  popen.return_value=FakeProcess('Ask not what your country can do for you.')
  result=runner.run_case(self.args,'default'); self.assertTrue(result['passed']); self.assertNotIn(str(self.audio),str(result['command'])); self.assertIn('-t',result['command'])
 @mock.patch.object(runner.platform,'platform',return_value='mock-os')
 @mock.patch.object(runner.platform,'machine',return_value='mock-cpu')
 @mock.patch.object(runner.subprocess,'Popen')
 def test_empty_transcript_fails_on_zero_exit(self,popen,machine_mock,platform_mock):
  popen.return_value=FakeProcess(''); result=runner.run_case(self.args,'default'); self.assertFalse(result['passed']); self.assertFalse(result['transcript_nonempty'])
 @mock.patch.object(runner.platform,'platform',return_value='mock-os')
 @mock.patch.object(runner.platform,'machine',return_value='mock-cpu')
 @mock.patch.object(runner.subprocess,'Popen')
 def test_signal_fails_and_no_gpu_variant_is_recorded(self,popen,machine_mock,platform_mock):
  popen.return_value=FakeProcess('Ask not what your country can do for you.',code=-11); result=runner.run_case(self.args,'no-gpu'); self.assertFalse(result['passed']); self.assertEqual(result['signal'],'SIGSEGV'); self.assertIn('--no-gpu',result['command'])
 @mock.patch.object(runner.platform,'platform',return_value='mock-os')
 @mock.patch.object(runner.platform,'machine',return_value='mock-cpu')
 @mock.patch.object(runner.subprocess,'Popen')
 def test_timeout_fails_and_kills_child(self,popen,machine_mock,platform_mock):
  proc=FakeProcess(timeout=True); popen.return_value=proc
  result=runner.run_case(self.args,'default')
  self.assertTrue(result['timed_out']); self.assertFalse(result['passed']); self.assertTrue(proc.killed)
 @mock.patch.object(runner.platform,'platform',return_value='mock-os')
 def test_ips_requires_exact_pid_time_and_path(self,platform_mock):
  import json, time
  now=time.time(); payload=(json.dumps({'bug_type':'309'})+'\n'+json.dumps({'pid':321,'captureTime':__import__('datetime').datetime.fromtimestamp(now,__import__('datetime').timezone.utc).isoformat(),'procPath':str(self.engine)},indent=2)).encode()
  self.assertTrue(runner.ips_matches(payload,321,str(self.engine),now-1,now+1))
  self.assertFalse(runner.ips_matches(payload,322,str(self.engine),now-1,now+1))
  wrong=(json.dumps({'bug_type':'309'})+'\n'+json.dumps({'pid':321,'captureTime':__import__('datetime').datetime.fromtimestamp(now,__import__('datetime').timezone.utc).isoformat(),'procPath':str(self.model)},indent=2)).encode()
  self.assertFalse(runner.ips_matches(wrong,321,str(self.engine),now-1,now+1))
if __name__=='__main__': unittest.main()
