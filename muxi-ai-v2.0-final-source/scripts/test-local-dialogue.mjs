import assert from "node:assert/strict";
import { AIClient } from "../js/ai-client.js";
import { extractMemories } from "../js/storage.js";

const settings={assistantName:"暮曦",userName:"",remoteAI:false};
const client=new AIClient(()=>settings);

assert.equal(client.detectLocalIntent("我叫什么名字"),"userNameRecall");
assert.deepEqual(extractMemories("我叫什么名字"),[]);
assert.deepEqual(extractMemories("你记得我叫什么名字吗"),[]);
assert.deepEqual(extractMemories("我叫南宫远"),[
  {content:"我的称呼是南宫远",type:"identity"}
]);

const unknownReply=client.localReply("我叫什么名字",[],settings,[
  {role:"user",content:"我叫什么名字"}
]);
assert.match(unknownReply,/还没有告诉|还不知道|没有你的名字/);

const rememberedReply=client.localReply("我叫什么名字",[
  {type:"identity",content:"我的称呼是南宫远"}
],settings,[
  {role:"user",content:"我叫南宫远"},
  {role:"assistant",content:"好，我记住了。"},
  {role:"user",content:"我叫什么名字"}
]);
assert.match(rememberedReply,/南宫远/);

const configuredReply=client.localReply("我叫什么名字",[],{
  ...settings,
  userName:"小南"
},[
  {role:"user",content:"我叫什么名字"}
]);
assert.match(configuredReply,/小南/);

const invalidMemoryReply=client.localReply("我叫什么名字",[
  {type:"identity",content:"我的称呼是什么名字"}
],settings,[
  {role:"user",content:"我叫什么名字"}
]);
assert.doesNotMatch(invalidMemoryReply,/你叫(?:什么|什么名字)/);

console.log(JSON.stringify({
  suite:"local-dialogue",
  cases:8,
  status:"passed"
},null,2));
