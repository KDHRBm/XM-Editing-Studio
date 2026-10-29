import http from 'node:http';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
let received=false,cancelled=false;
const server=http.createServer(async(req,res)=>{
  let raw='';for await(const b of req)raw+=b;
  const data=JSON.parse(raw);received ||= data.messages?.[0]?.content==='中文与西语：Sr. López...';
  if(data.model==='slow') { res.on('close',()=>{cancelled=true});return; }
  res.writeHead(200,{'content-type':'application/json'});
  res.end(JSON.stringify({choices:[{message:{content:'配乐测试通过'}}]}));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try {
  const script=`const provider={protocol:'openai',apiKey:'local-test',baseUrl:'http://127.0.0.1:${server.address().port}/v1'};const messages=[{role:'user',content:'中文与西语：Sr. López...'}];
  const success=await fetch('/api/chat',{method:'POST',body:JSON.stringify({provider,model:'test',messages})});
  const controller=new AbortController();const pending=fetch('/api/chat',{method:'POST',signal:controller.signal,body:JSON.stringify({provider,model:'slow',messages})});
  setTimeout(()=>controller.abort(),250);let aborted=false;try{await pending}catch(e){aborted=e.name==='AbortError'}
  return {status:success.status,result:await success.json(),aborted};`;
  const result=await new Promise((resolve,reject)=>{const p=spawn(process.execPath,['scripts/native-qa.mjs',script],{windowsHide:true});let data='';p.stdout.on('data',b=>data+=b);p.on('error',reject);p.on('exit',code=>code?reject(Error(data)):resolve(JSON.parse(data)));});
  assert.equal(result.result.status,200);assert.equal(result.result.result.text,'配乐测试通过');assert.equal(result.result.aborted,true);
  await new Promise(r=>setTimeout(r,300));assert.equal(received,true);assert.equal(cancelled,true);
  console.log('PASS: native provider HTTP, Chinese/Spanish payload and response, abort closes request.');
}finally{server.closeAllConnections();server.close();}
