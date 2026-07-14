import { chatRepository } from "./repository/ChatRepository.js";

const KEYS={settings:"muxi.settings.v1",memories:"muxi.memories.v1",messages:"muxi.messages.v1"};
const DEFAULT_SETTINGS={
  userName:"",
  assistantName:"暮曦",
  autoSpeak:false,
  autoMemory:true,
  remoteAI:false,
  apiEndpoint:"",
  aiBaseURL:"",
  aiApiKey:"",
  aiModel:"",
  aiTemperature:0.8,
  aiMaxTokens:1024,
  aiStream:false,
  contextLimit:20
};
function readJSON(key,fallback){try{const value=localStorage.getItem(key);return value?JSON.parse(value):fallback}catch{return fallback}}
function writeJSON(key,value){localStorage.setItem(key,JSON.stringify(value));window.dispatchEvent(new CustomEvent("muxi:data-change",{detail:{key}}))}
export const Store={
  getSettings(){return{...DEFAULT_SETTINGS,...readJSON(KEYS.settings,{})}},
  saveSettings(partial){const settings={...this.getSettings(),...partial};writeJSON(KEYS.settings,settings);return settings},
  getMemories(){return readJSON(KEYS.memories,[]).filter(item=>item?.content&&item?.id)},
  addMemory(content,type="note",source="manual"){const clean=String(content).trim().replace(/\s+/g," ").slice(0,200);if(!clean)return null;const items=this.getMemories();if(items.some(item=>item.content.toLowerCase()===clean.toLowerCase()))return null;const now=new Date().toISOString();const memory={id:crypto.randomUUID?.()||`${Date.now()}-${Math.random()}`,content:clean,type,source,createdAt:now,updatedAt:now};items.unshift(memory);writeJSON(KEYS.memories,items.slice(0,300));return memory},
  deleteMemory(id){writeJSON(KEYS.memories,this.getMemories().filter(item=>item.id!==id))},
  getMessages(){return chatRepository.getAll()},
  addMessage(role,content,metadata={}){return chatRepository.add(role,content,metadata)},
  deleteMessage(id){return chatRepository.delete(id)},
  clearMessages(){chatRepository.newChat()},
  clearAll(){Object.values(KEYS).forEach(key=>localStorage.removeItem(key));window.dispatchEvent(new CustomEvent("muxi:data-change",{detail:{key:"all"}}))},
  exportData(){return{app:"暮曦 AI",version:2,exportedAt:new Date().toISOString(),settings:this.getSettings(),memories:this.getMemories(),messages:this.getMessages()}},
  importData(data){if(!data||typeof data!=="object")throw new Error("备份文件格式不正确");if(data.settings)writeJSON(KEYS.settings,{...DEFAULT_SETTINGS,...data.settings});if(Array.isArray(data.memories))writeJSON(KEYS.memories,data.memories.slice(0,300));if(Array.isArray(data.messages))chatRepository.replaceAll(data.messages.slice(-200))}
};
export function extractMemories(text){const value=String(text).trim(),candidates=[];const rules=[{regex:/(?:请)?记住(?:一下)?[，,：:\s]*(.{2,100})/i,type:"note",format:v=>v},{regex:/(?:我叫|以后叫我)[\s：:]*(.{1,20})/i,type:"identity",format:v=>`我的称呼是${v}`},{regex:/我不喜欢[\s：:]*(.{1,60})/i,type:"preference",format:v=>`我不喜欢${v}`},{regex:/我喜欢[\s：:]*(.{1,60})/i,type:"preference",format:v=>`我喜欢${v}`}];for(const rule of rules){const match=value.match(rule.regex);if(match?.[1]){const captured=match[1].replace(/[。！？!?]+$/g,"").trim();if(captured)candidates.push({content:rule.format(captured),type:rule.type})}}return candidates.slice(0,2)}
export function relevantMemories(text,limit=8){const query=String(text).toLowerCase(),chars=new Set([...query].filter(char=>/[\p{L}\p{N}]/u.test(char)));return Store.getMemories().map(item=>({item,score:[...chars].reduce((sum,char)=>sum+(item.content.toLowerCase().includes(char)?1:0),0)+(item.type==="identity"?2:0)})).sort((a,b)=>b.score-a.score||new Date(b.item.updatedAt)-new Date(a.item.updatedAt)).slice(0,limit).map(({item})=>item)}
